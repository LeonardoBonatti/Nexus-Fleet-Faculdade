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
                // A empresa de demonstração é ADICIONADA ao banco, numa empresa
                // própria: ela não toca nos dados de quem já usa o sistema. E
                // seedDemo() tem guarda própria — se a empresa já existir, não
                // faz nada. Por isso pode ser chamada sempre.
                // SEED_DEMO=false desliga, para depois da apresentação.
                if (process.env.SEED_DEMO === 'false') return;

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
