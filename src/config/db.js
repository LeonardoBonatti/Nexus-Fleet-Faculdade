/**
 * src/config/db.js
 * Conexão e esquema do banco PostgreSQL (Neon / Vercel Postgres).
 *
 * O restante do sistema continua escrevendo SQL no dialeto usado originalmente
 * (placeholders "?", datetime('now'), INSERT OR IGNORE, IFNULL, COLLATE NOCASE).
 * Este módulo traduz tudo para PostgreSQL antes de enviar a consulta, o que
 * mantém as centenas de consultas do projeto funcionando sem reescrita.
 *
 * Datas continuam armazenadas como TEXTO em UTC no formato "AAAA-MM-DD HH:MM:SS",
 * exatamente como antes, para que toda a lógica de comparação e o frontend
 * continuem válidos.
 */
const { Pool, types } = require('pg');

// ==========================================================================
// Conexão
// ==========================================================================
const CONNECTION_STRING =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.DATABASE_POSTGRES_URL ||
    '';

if (!CONNECTION_STRING) {
    console.error('❌ Variável DATABASE_URL (ou POSTGRES_URL) não definida. Configure o banco Neon/Postgres.');
}

// node-postgres devolve BIGINT e NUMERIC como texto; o sistema espera números
// (COUNT(*), SUM(...), MAX(...) são usados em cálculos).
types.setTypeParser(20, value => (value === null ? null : parseInt(value, 10)));   // int8
types.setTypeParser(1700, value => (value === null ? null : parseFloat(value)));   // numeric

const isLocal = /@(localhost|127\.0\.0\.1)/.test(CONNECTION_STRING);

// Em ambiente serverless o módulo é recarregado a cada "cold start"; guardar o
// pool em globalThis evita abrir conexões novas a cada invocação reaproveitada.
const GLOBAL_KEY = '__nexusfleet_pg_store__';
const store = globalThis[GLOBAL_KEY] || (globalThis[GLOBAL_KEY] = {});

if (!store.pool) {
    store.pool = new Pool({
        connectionString: CONNECTION_STRING,
        ssl: isLocal ? false : { rejectUnauthorized: false },
        max: parseInt(process.env.PG_POOL_MAX, 10) || 3,
        idleTimeoutMillis: 10000,
        connectionTimeoutMillis: 15000,
        allowExitOnIdle: true
    });
    store.pool.on('error', err => console.error('Erro inesperado no pool do Postgres:', err.message));
}

const pool = store.pool;

// ==========================================================================
// Tradução do dialeto SQLite → PostgreSQL
// ==========================================================================
const UTC_NOW = `to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')`;

// Tabelas sem coluna "id" (não podem receber RETURNING id)
const TABLES_WITHOUT_ID = new Set(['driver_vehicles', 'system_heartbeats']);

function translate(sql) {
    let s = String(sql);

    // datetime('now', ?) e datetime('now', '-90 days') → agora + intervalo
    s = s.replace(/datetime\(\s*'now'\s*,\s*\?\s*\)/gi,
        `to_char((now() AT TIME ZONE 'UTC') + CAST(? AS interval), 'YYYY-MM-DD HH24:MI:SS')`);
    s = s.replace(/datetime\(\s*'now'\s*,\s*'([^']*)'\s*\)/gi,
        (m, interval) => `to_char((now() AT TIME ZONE 'UTC') + INTERVAL '${interval}', 'YYYY-MM-DD HH24:MI:SS')`);
    s = s.replace(/datetime\(\s*'now'\s*\)/gi, UTC_NOW);

    s = s.replace(/\bIFNULL\s*\(/gi, 'COALESCE(');
    s = s.replace(/([A-Za-z_][\w.]*)\s+COLLATE\s+NOCASE/gi, 'lower($1)');
    // No SQLite LIKE ignora maiúsculas/minúsculas; no Postgres o equivalente é ILIKE
    s = s.replace(/\bLIKE\b/gi, 'ILIKE');

    return s;
}

// Converte "?" em "$1, $2, ..." ignorando o que está dentro de textos entre aspas
function toPlaceholders(sql) {
    let out = '';
    let index = 0;
    let inSingle = false;
    let inDouble = false;

    for (let i = 0; i < sql.length; i++) {
        const c = sql[i];
        if (inSingle) {
            out += c;
            if (c === "'") {
                if (sql[i + 1] === "'") { out += "'"; i++; }
                else inSingle = false;
            }
            continue;
        }
        if (inDouble) {
            out += c;
            if (c === '"') inDouble = false;
            continue;
        }
        if (c === "'") { inSingle = true; out += c; continue; }
        if (c === '"') { inDouble = true; out += c; continue; }
        if (c === '?') { index += 1; out += `$${index}`; continue; }
        out += c;
    }
    return out;
}

// PRAGMA table_info(x) → catálogo do PostgreSQL
const PRAGMA_RE = /^\s*PRAGMA\s+table_info\s*\(\s*"?([A-Za-z_][\w]*)"?\s*\)\s*;?\s*$/i;

function prepare(sql, params) {
    const pragma = String(sql).match(PRAGMA_RE);
    if (pragma) {
        return {
            text: `SELECT column_name AS name FROM information_schema.columns
                   WHERE table_schema = current_schema() AND table_name = $1
                   ORDER BY ordinal_position`,
            values: [pragma[1].toLowerCase()],
            insertTable: null
        };
    }

    let text = String(sql);
    let ignoreConflict = false;

    if (/^\s*INSERT\s+OR\s+IGNORE\s+INTO\b/i.test(text)) {
        text = text.replace(/^(\s*)INSERT\s+OR\s+IGNORE\s+INTO\b/i, '$1INSERT INTO');
        ignoreConflict = true;
    } else if (/^\s*INSERT\s+OR\s+REPLACE\s+INTO\b/i.test(text)) {
        text = text.replace(/^(\s*)INSERT\s+OR\s+REPLACE\s+INTO\b/i, '$1INSERT INTO');
        ignoreConflict = true;
    }

    text = toPlaceholders(translate(text));

    if (ignoreConflict && !/\bON\s+CONFLICT\b/i.test(text)) text += ' ON CONFLICT DO NOTHING';

    const insert = text.match(/^\s*INSERT\s+INTO\s+"?([A-Za-z_][\w]*)"?/i);
    const insertTable = insert ? insert[1].toLowerCase() : null;

    if (insertTable && !TABLES_WITHOUT_ID.has(insertTable) && !/\bRETURNING\b/i.test(text)) {
        text += ' RETURNING id';
    }

    return { text, values: params, insertTable };
}

async function execute(sql, params = [], client = null) {
    const { text, values } = prepare(sql, params);
    const runner = client || pool;
    try {
        return await runner.query(text, values);
    } catch (err) {
        err.sqlText = text;
        throw err;
    }
}

// ==========================================================================
// API usada pelo restante do sistema
// ==========================================================================
async function run(sql, params = [], client = null) {
    const result = await execute(sql, params, client);
    const first = result.rows && result.rows[0];
    return {
        lastID: first && first.id !== undefined ? first.id : null,
        changes: result.rowCount || 0,
        rows: result.rows || []
    };
}

async function get(sql, params = [], client = null) {
    const result = await execute(sql, params, client);
    return (result.rows && result.rows[0]) || undefined;
}

async function all(sql, params = [], client = null) {
    const result = await execute(sql, params, client);
    return result.rows || [];
}

// ==========================================================================
// Esquema
// ==========================================================================
const SCHEMA = [
    `CREATE TABLE IF NOT EXISTS companies (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
    )`,

    // RF14 — perfis: admin, gestor, motorista, financeiro
    `CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        company_id INTEGER,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT DEFAULT 'gestor',
        cargo TEXT DEFAULT 'Colaborador',
        active INTEGER DEFAULT 1,
        last_login_at TEXT,
        created_at TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
    )`,

    // RF01 — veículos
    `CREATE TABLE IF NOT EXISTS vehicles (
        id SERIAL PRIMARY KEY,
        company_id INTEGER,
        user_id INTEGER NOT NULL,
        plate TEXT NOT NULL,
        model TEXT NOT NULL,
        brand TEXT NOT NULL,
        year INTEGER,
        vehicle_type TEXT DEFAULT 'carro',
        load_capacity_kg DOUBLE PRECISION DEFAULT 0,
        fuel_type TEXT DEFAULT 'Flex',
        capacity DOUBLE PRECISION DEFAULT 0,
        current_odometer DOUBLE PRECISION DEFAULT 0,
        status TEXT DEFAULT 'available',
        maintenance_interval_km DOUBLE PRECISION DEFAULT 10000,
        maintenance_interval_days INTEGER DEFAULT 180,
        last_lat DOUBLE PRECISION,
        last_lng DOUBLE PRECISION,
        last_speed DOUBLE PRECISION,
        last_position_at TEXT,
        created_at TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
    )`,

    // RF02 — motoristas (CPF e CNH criptografados — RNF03)
    `CREATE TABLE IF NOT EXISTS drivers (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL,
        user_id INTEGER,
        linked_user_id INTEGER,
        name TEXT NOT NULL,
        cpf_enc TEXT,
        cpf_hash TEXT,
        cpf_last TEXT,
        cnh_enc TEXT,
        cnh_hash TEXT,
        cnh_last TEXT,
        cnh_category TEXT NOT NULL,
        cnh_expiry TEXT NOT NULL,
        phone TEXT,
        email TEXT,
        status TEXT DEFAULT 'active',
        created_at TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
    )`,

    `CREATE TABLE IF NOT EXISTS driver_vehicles (
        driver_id INTEGER NOT NULL,
        vehicle_id INTEGER NOT NULL,
        PRIMARY KEY (driver_id, vehicle_id)
    )`,

    // RF10 / RF11 — viagens (rota, motorista, veículo)
    `CREATE TABLE IF NOT EXISTS trips (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL,
        user_id INTEGER,
        vehicle_id INTEGER NOT NULL,
        driver_id INTEGER NOT NULL,
        origin_name TEXT NOT NULL,
        origin_lat DOUBLE PRECISION,
        origin_lng DOUBLE PRECISION,
        destination_name TEXT NOT NULL,
        destination_lat DOUBLE PRECISION,
        destination_lng DOUBLE PRECISION,
        stops TEXT DEFAULT '[]',
        distance_km DOUBLE PRECISION,
        duration_min DOUBLE PRECISION,
        planned_start TEXT NOT NULL,
        planned_end TEXT NOT NULL,
        actual_start TEXT,
        actual_end TEXT,
        start_odometer DOUBLE PRECISION,
        end_odometer DOUBLE PRECISION,
        toll_cost DOUBLE PRECISION DEFAULT 0,
        status TEXT DEFAULT 'planned',
        notes TEXT,
        created_at TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
    )`,

    // RF12 — checklist antes/depois da viagem
    `CREATE TABLE IF NOT EXISTS checklists (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL,
        trip_id INTEGER NOT NULL,
        vehicle_id INTEGER NOT NULL,
        driver_id INTEGER,
        user_id INTEGER NOT NULL,
        user_name TEXT,
        type TEXT NOT NULL,
        items TEXT NOT NULL,
        has_issues INTEGER DEFAULT 0,
        odometer DOUBLE PRECISION,
        notes TEXT,
        created_at TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
    )`,

    // RF07 — posições GPS
    `CREATE TABLE IF NOT EXISTS vehicle_positions (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL,
        vehicle_id INTEGER NOT NULL,
        trip_id INTEGER,
        driver_id INTEGER,
        lat DOUBLE PRECISION NOT NULL,
        lng DOUBLE PRECISION NOT NULL,
        speed DOUBLE PRECISION,
        accuracy DOUBLE PRECISION,
        recorded_at TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
    )`,

    // RF06 — abastecimentos
    `CREATE TABLE IF NOT EXISTS fuels (
        id SERIAL PRIMARY KEY,
        company_id INTEGER,
        user_id INTEGER NOT NULL,
        vehicle_id INTEGER,
        driver_id INTEGER,
        trip_id INTEGER,
        vehicle TEXT,
        fuel_type TEXT DEFAULT 'Gasolina Comum',
        liters DOUBLE PRECISION DEFAULT 0,
        price_per_liter DOUBLE PRECISION DEFAULT 0,
        cost DOUBLE PRECISION NOT NULL,
        odometer DOUBLE PRECISION DEFAULT 0,
        horimeter DOUBLE PRECISION DEFAULT 0,
        km_per_liter DOUBLE PRECISION,
        date TEXT NOT NULL,
        created_at TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
    )`,

    // RF04 — manutenções preventivas/corretivas com agendamento
    `CREATE TABLE IF NOT EXISTS maintenances (
        id SERIAL PRIMARY KEY,
        company_id INTEGER,
        user_id INTEGER NOT NULL,
        vehicle_id INTEGER,
        vehicle TEXT,
        kind TEXT DEFAULT 'corretiva',
        status TEXT DEFAULT 'completed',
        scheduled_date TEXT,
        service TEXT NOT NULL,
        workshop TEXT,
        notes TEXT,
        cost DOUBLE PRECISION NOT NULL,
        odometer DOUBLE PRECISION DEFAULT 0,
        horimeter DOUBLE PRECISION DEFAULT 0,
        date TEXT NOT NULL,
        completed_at TEXT,
        created_at TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
    )`,

    // RF09 — multas
    `CREATE TABLE IF NOT EXISTS fines (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL,
        user_id INTEGER,
        vehicle_id INTEGER NOT NULL,
        driver_id INTEGER,
        trip_id INTEGER,
        driver_auto INTEGER DEFAULT 0,
        infraction_date TEXT NOT NULL,
        infraction_time TEXT,
        code TEXT,
        description TEXT NOT NULL,
        severity TEXT DEFAULT 'media',
        points INTEGER DEFAULT 4,
        amount DOUBLE PRECISION NOT NULL,
        due_date TEXT,
        location TEXT,
        status TEXT DEFAULT 'pending',
        paid_at TEXT,
        notes TEXT,
        created_at TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
    )`,

    // RF13 — documentos do veículo
    `CREATE TABLE IF NOT EXISTS vehicle_documents (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL,
        user_id INTEGER,
        vehicle_id INTEGER NOT NULL,
        doc_type TEXT NOT NULL,
        number TEXT,
        issuer TEXT,
        expiry_date TEXT NOT NULL,
        cost DOUBLE PRECISION DEFAULT 0,
        notes TEXT,
        created_at TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
    )`,

    // Ocorrências reportadas pelos motoristas
    `CREATE TABLE IF NOT EXISTS occurrences (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL,
        user_id INTEGER,
        user_name TEXT,
        vehicle_id INTEGER NOT NULL,
        driver_id INTEGER,
        trip_id INTEGER,
        type TEXT NOT NULL,
        severity TEXT DEFAULT 'media',
        description TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        status TEXT DEFAULT 'open',
        resolution TEXT,
        resolved_at TEXT,
        created_at TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
    )`,

    `CREATE TABLE IF NOT EXISTS reminders (
        id SERIAL PRIMARY KEY,
        company_id INTEGER,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        date TEXT NOT NULL,
        description TEXT,
        completed INTEGER DEFAULT 0,
        completed_at TEXT,
        created_at TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
    )`,

    `CREATE TABLE IF NOT EXISTS stations (
        id SERIAL PRIMARY KEY,
        company_id INTEGER,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        lat DOUBLE PRECISION NOT NULL,
        lng DOUBLE PRECISION NOT NULL,
        price_gas DOUBLE PRECISION,
        price_gas_ad DOUBLE PRECISION,
        price_alcool DOUBLE PRECISION,
        price_diesel DOUBLE PRECISION,
        price_gnv DOUBLE PRECISION,
        created_at TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
    )`,

    `CREATE TABLE IF NOT EXISTS trash (
        id SERIAL PRIMARY KEY,
        company_id INTEGER,
        user_id INTEGER NOT NULL,
        original_id INTEGER,
        original_type TEXT,
        data TEXT,
        deleted_at TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
    )`,

    // RF05 / RF13 — notificações automáticas
    `CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL,
        user_id INTEGER,
        type TEXT NOT NULL,
        severity TEXT DEFAULT 'info',
        title TEXT NOT NULL,
        message TEXT,
        entity TEXT,
        entity_id INTEGER,
        link_page TEXT,
        dedupe_key TEXT,
        read_at TEXT,
        created_at TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
    )`,

    // RNF05 — log de alterações
    `CREATE TABLE IF NOT EXISTS audit_logs (
        id SERIAL PRIMARY KEY,
        company_id INTEGER,
        user_id INTEGER,
        user_name TEXT,
        action TEXT NOT NULL,
        entity TEXT NOT NULL,
        entity_id INTEGER,
        summary TEXT,
        changes TEXT,
        ip TEXT,
        created_at TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
    )`,

    // RNF02 — batimentos para medir disponibilidade
    `CREATE TABLE IF NOT EXISTS system_heartbeats (
        minute TEXT PRIMARY KEY
    )`
];

// Colunas adicionadas depois da primeira versão
const LEGACY_COLUMNS = {
    users: [['company_id', 'INTEGER'], ['cargo', "TEXT DEFAULT 'Colaborador'"], ['active', 'INTEGER DEFAULT 1'], ['last_login_at', 'TEXT']],
    vehicles: [
        ['company_id', 'INTEGER'], ['year', 'INTEGER'], ['vehicle_type', 'TEXT'], ['load_capacity_kg', 'DOUBLE PRECISION DEFAULT 0'],
        ['fuel_type', "TEXT DEFAULT 'Flex'"], ['capacity', 'DOUBLE PRECISION DEFAULT 0'], ['current_odometer', 'DOUBLE PRECISION DEFAULT 0'],
        ['maintenance_interval_km', 'DOUBLE PRECISION DEFAULT 10000'], ['maintenance_interval_days', 'INTEGER DEFAULT 180'],
        ['last_lat', 'DOUBLE PRECISION'], ['last_lng', 'DOUBLE PRECISION'], ['last_speed', 'DOUBLE PRECISION'], ['last_position_at', 'TEXT']
    ],
    fuels: [
        ['company_id', 'INTEGER'], ['driver_id', 'INTEGER'], ['trip_id', 'INTEGER'], ['fuel_type', "TEXT DEFAULT 'Gasolina Comum'"],
        ['liters', 'DOUBLE PRECISION DEFAULT 0'], ['price_per_liter', 'DOUBLE PRECISION DEFAULT 0'], ['odometer', 'DOUBLE PRECISION DEFAULT 0'],
        ['horimeter', 'DOUBLE PRECISION DEFAULT 0'], ['km_per_liter', 'DOUBLE PRECISION']
    ],
    maintenances: [
        ['company_id', 'INTEGER'], ['kind', 'TEXT'], ['status', 'TEXT'], ['scheduled_date', 'TEXT'], ['workshop', 'TEXT'],
        ['notes', 'TEXT'], ['odometer', 'DOUBLE PRECISION DEFAULT 0'], ['horimeter', 'DOUBLE PRECISION DEFAULT 0'], ['completed_at', 'TEXT']
    ],
    reminders: [['company_id', 'INTEGER']],
    stations: [['company_id', 'INTEGER']],
    trash: [['company_id', 'INTEGER']]
};

const INDEXES = [
    `CREATE UNIQUE INDEX IF NOT EXISTS ux_vehicles_company_plate ON vehicles(company_id, plate)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS ux_drivers_company_cpf ON drivers(company_id, cpf_hash)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS ux_drivers_company_cnh ON drivers(company_id, cnh_hash)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS ux_checklists_trip_type ON checklists(trip_id, type)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS ux_notifications_dedupe ON notifications(company_id, dedupe_key)`,
    `CREATE INDEX IF NOT EXISTS ix_users_company ON users(company_id)`,
    `CREATE INDEX IF NOT EXISTS ix_vehicles_company ON vehicles(company_id)`,
    `CREATE INDEX IF NOT EXISTS ix_drivers_company ON drivers(company_id)`,
    `CREATE INDEX IF NOT EXISTS ix_trips_company ON trips(company_id, status)`,
    `CREATE INDEX IF NOT EXISTS ix_trips_vehicle ON trips(vehicle_id, planned_start)`,
    `CREATE INDEX IF NOT EXISTS ix_trips_driver ON trips(driver_id, planned_start)`,
    `CREATE INDEX IF NOT EXISTS ix_fuels_company ON fuels(company_id, vehicle_id)`,
    `CREATE INDEX IF NOT EXISTS ix_maint_company ON maintenances(company_id, vehicle_id)`,
    `CREATE INDEX IF NOT EXISTS ix_fines_company ON fines(company_id, vehicle_id)`,
    `CREATE INDEX IF NOT EXISTS ix_docs_company ON vehicle_documents(company_id, vehicle_id)`,
    `CREATE INDEX IF NOT EXISTS ix_occ_company ON occurrences(company_id)`,
    `CREATE INDEX IF NOT EXISTS ix_positions_vehicle ON vehicle_positions(vehicle_id, recorded_at)`,
    `CREATE INDEX IF NOT EXISTS ix_positions_trip ON vehicle_positions(trip_id)`,
    `CREATE INDEX IF NOT EXISTS ix_notifications_company ON notifications(company_id, read_at)`,
    `CREATE INDEX IF NOT EXISTS ix_audit_company ON audit_logs(company_id, created_at)`
];

// Converte bancos da versão anterior (dados por usuário) para o modelo por empresa
async function migrateLegacyData(client) {
    const orphans = await all(`SELECT id, name FROM users WHERE company_id IS NULL`, [], client);
    for (const u of orphans) {
        const company = await run(`INSERT INTO companies (name) VALUES (?)`, [`Frota de ${u.name}`], client);
        await run(`UPDATE users SET company_id = ?, role = 'admin' WHERE id = ?`, [company.lastID, u.id], client);
    }

    for (const table of ['vehicles', 'fuels', 'maintenances', 'reminders', 'stations', 'trash']) {
        await run(
            `UPDATE ${table} SET company_id = (SELECT company_id FROM users WHERE users.id = ${table}.user_id) WHERE company_id IS NULL`,
            [], client
        );
    }

    await run(`UPDATE users SET role = 'gestor' WHERE role NOT IN ('admin', 'gestor', 'motorista', 'financeiro')`, [], client);
    await run(`UPDATE vehicles SET status = 'available' WHERE status IS NULL OR status = 'active'`, [], client);
    await run(`UPDATE vehicles SET vehicle_type = 'carro' WHERE vehicle_type IS NULL`, [], client);
    await run(`UPDATE vehicles SET current_odometer = GREATEST(
        COALESCE((SELECT MAX(odometer) FROM fuels WHERE fuels.vehicle_id = vehicles.id), 0),
        COALESCE((SELECT MAX(odometer) FROM maintenances WHERE maintenances.vehicle_id = vehicles.id), 0)
    ) WHERE current_odometer IS NULL OR current_odometer = 0`, [], client);
    await run(`UPDATE maintenances SET status = 'completed' WHERE status IS NULL`, [], client);
    await run(`UPDATE maintenances SET kind = CASE
        WHEN service ILIKE '%leo%' OR service ILIKE '%Revis%' OR service ILIKE '%Alinhamento%' OR service ILIKE '%Correia%' THEN 'preventiva'
        ELSE 'corretiva' END WHERE kind IS NULL`, [], client);
}

// Identificador do bloqueio consultivo: impede que dois "cold starts" simultâneos
// criem o esquema ao mesmo tempo.
const LOCK_ID = 728301455;

async function initDb() {
    if (!CONNECTION_STRING) {
        throw new Error('DATABASE_URL não configurada. Crie o banco Postgres (Neon) e defina a variável de ambiente.');
    }

    const client = await pool.connect();
    try {
        await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);

        for (const statement of SCHEMA) await client.query(statement);

        for (const [table, columns] of Object.entries(LEGACY_COLUMNS)) {
            for (const [name, definition] of columns) {
                await client.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${name} ${definition}`);
            }
        }

        await migrateLegacyData(client);

        for (const statement of INDEXES) await client.query(statement);

        console.log('🐘 Banco PostgreSQL pronto.');
    } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
        client.release();
    }
}

/**
 * Garante que o esquema existe. A promessa fica guardada em globalThis: o custo
 * acontece apenas no primeiro acesso de cada instância (cold start).
 */
function ensureReady() {
    if (!store.ready) {
        store.ready = initDb().catch(err => {
            store.ready = null; // permite nova tentativa na próxima requisição
            console.error('❌ Falha ao inicializar o banco de dados:', err.message);
            throw err;
        });
    }
    return store.ready;
}

/**
 * Realinha a sequência da coluna "id" com o maior valor existente na tabela.
 * Necessário quando um registro é inserido com o id explícito (ex.: restauração
 * da lixeira): nesse caso o PostgreSQL não avança a sequência sozinho e o
 * próximo INSERT automático tentaria reutilizar um id já ocupado.
 */
async function syncSequence(table) {
    await execute(
        `SELECT setval(
            pg_get_serial_sequence('${table}', 'id'),
            GREATEST(COALESCE((SELECT MAX(id) FROM ${table}), 0), 1),
            true
         )`
    );
}

/**
 * Executa uma rotina segurando um bloqueio consultivo do PostgreSQL.
 * Evita que duas instâncias simultâneas façam a mesma carga (ex.: dados demo).
 */
async function withAdvisoryLock(id, fn) {
    const client = await pool.connect();
    try {
        await client.query('SELECT pg_advisory_lock($1)', [id]);
        return await fn();
    } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [id]).catch(() => {});
        client.release();
    }
}

async function close() {
    if (store.pool) {
        const current = store.pool;
        store.pool = null;
        store.ready = null;
        await current.end().catch(() => {});
    }
}

module.exports = {
    pool,
    run,
    get,
    all,
    ensureReady,
    syncSequence,
    withAdvisoryLock,
    close,
    translate,
    toPlaceholders,
    get ready() { return ensureReady(); }
};
