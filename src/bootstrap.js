/**
 * src/bootstrap.js
 * Preparação executada uma única vez por instância da aplicação:
 * cria/atualiza o esquema do banco e, se SEED_DEMO=true, carrega os dados de
 * demonstração (a carga é idempotente: só acontece se a empresa demo não existir).
 */
const db = require('./config/db');

const GLOBAL_KEY = '__nexusfleet_bootstrap__';
const SEED_LOCK_ID = 728301456;

function bootstrap() {
    const store = globalThis[GLOBAL_KEY] || (globalThis[GLOBAL_KEY] = {});

    if (!store.promise) {
        store.promise = db.ensureReady()
            .then(async () => {
                if (process.env.SEED_DEMO !== 'true') return;
                const { seedDemo } = require('./database/seed');
                await db.withAdvisoryLock(SEED_LOCK_ID, () => seedDemo());
            })
            .catch(err => {
                store.promise = null; // nova tentativa na próxima requisição
                throw err;
            });
    }

    return store.promise;
}

module.exports = { bootstrap };
