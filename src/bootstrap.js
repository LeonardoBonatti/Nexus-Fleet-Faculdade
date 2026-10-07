/**
 * src/bootstrap.js
 * Preparação executada uma única vez por instância da aplicação:
 * cria/atualiza o esquema do banco e, se SEED_DEMO=true, carrega os dados de
 * demonstração (a carga é idempotente: só acontece se a empresa demo não existir).
 */
const db = require('./config/db');

const GLOBAL_KEY = '__nexusfleet_bootstrap__';
const SEED_LOCK_ID = 728301456;

// Banco sem nenhum usuário = publicação nova, ainda não utilizada.
// Na dúvida devolve false: é melhor não carregar nada do que escrever
// por cima de um banco em uso.
async function isDatabaseEmpty() {
    try {
        const { get } = require('./database/query');
        const row = await get(`SELECT COUNT(*) AS n FROM users`);
        return Boolean(row) && Number(row.n) === 0;
    } catch (err) {
        return false;
    }
}

function bootstrap() {
    const store = globalThis[GLOBAL_KEY] || (globalThis[GLOBAL_KEY] = {});

    if (!store.promise) {
        store.promise = db.ensureReady()
            .then(async () => {
                // A carga de demonstração roda quando SEED_DEMO=true OU quando o
                // banco ainda está vazio (primeira publicação). Assim um deploy
                // novo já nasce utilizável, sem depender de variável de ambiente.
                // SEED_DEMO=false desliga de vez.
                if (process.env.SEED_DEMO === 'false') return;
                if (process.env.SEED_DEMO !== 'true' && !(await isDatabaseEmpty())) return;

                try {
                    const { seedDemo } = require('./database/seed');
                    await db.withAdvisoryLock(SEED_LOCK_ID, () => seedDemo());
                } catch (err) {
                    // A carga de demonstração é opcional. Se ela falhar, o sistema
                    // segue funcionando (vazio) em vez de derrubar toda a API.
                    console.error('❌ Falha ao carregar os dados de demonstração:', err.message);
                    if (err.sqlText) console.error('   SQL:', err.sqlText);
                }
            })
            .catch(err => {
                store.promise = null; // nova tentativa na próxima requisição
                throw err;
            });
    }

    return store.promise;
}

module.exports = { bootstrap };
