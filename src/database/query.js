// Helpers de acesso ao banco (PostgreSQL / Neon).
// A API é a mesma usada desde a primeira versão do projeto: run/get/all com
// placeholders "?" — a tradução para o dialeto do PostgreSQL fica em src/config/db.js.
const db = require('../config/db');

const { run, get, all } = db;

// Monta INSERT/UPDATE a partir de um objeto cujas chaves já foram validadas
async function insertRow(table, data) {
    const keys = Object.keys(data);
    const result = await run(
        `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
        keys.map(k => data[k])
    );
    // Quando o id vem explícito (restauração da lixeira), a sequência precisa ser
    // realinhada para que o próximo cadastro automático não tente reutilizá-lo.
    if (data.id !== undefined && data.id !== null) {
        await db.syncSequence(table).catch(err => console.error('Falha ao sincronizar sequência:', err.message));
    }
    return result.lastID;
}

async function updateRow(table, id, data, companyId) {
    const keys = Object.keys(data);
    if (!keys.length) return 0;
    const result = await run(
        `UPDATE ${table} SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ? AND company_id = ?`,
        [...keys.map(k => data[k]), id, companyId]
    );
    return result.changes;
}

async function tableColumns(table) {
    return (await all(`PRAGMA table_info(${table})`)).map(c => c.name);
}

module.exports = { db, run, get, all, insertRow, updateRow, tableColumns };
