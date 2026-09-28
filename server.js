/**
 * server.js
 * Execução como servidor permanente (desenvolvimento local ou hospedagem tradicional).
 *
 * Na Vercel o ponto de entrada é api/index.js — este arquivo não é usado lá.
 * Em ambos os casos a aplicação Express é a mesma (src/app.js) e o banco é o
 * mesmo PostgreSQL (Neon), definido em DATABASE_URL.
 */
require('dotenv').config();

const { createApp } = require('./src/app');
const { bootstrap } = require('./src/bootstrap');
const db = require('./src/config/db');
const metrics = require('./src/services/metrics.service');
const { scheduleChecks } = require('./src/services/notification.service');
const { purgeOldAuditLogs } = require('./src/services/audit.service');

const app = createApp();
const isProduction = process.env.NODE_ENV === 'production';
const PORT = parseInt(process.env.PORT, 10) || 3000;

// RNF02 — erros inesperados são registrados; em falha grave o processo encerra para a plataforma reiniciar
process.on('unhandledRejection', (err) => console.error('❌ Promessa rejeitada sem tratamento:', err));
process.on('uncaughtException', (err) => {
    console.error('❌ Exceção não tratada:', err);
    process.exit(1);
});

function startServer(port) {
    const server = app.listen(port, '0.0.0.0', () => {
        console.log(`🚀 Servidor rodando em http://localhost:${port}`);
    });

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE' && !isProduction) {
            console.warn(`⚠️  Porta ${port} ocupada. Tentando a porta ${port + 1}...`);
            startServer(port + 1);
        } else {
            console.error('❌ Erro fatal no servidor:', err);
            process.exit(1);
        }
    });

    const shutdown = () => {
        console.log('Encerrando servidor...');
        server.close(() => db.close().finally(() => process.exit(0)));
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
}

bootstrap()
    .then(() => {
        // Tarefas periódicas: aqui existe processo permanente, então usamos timers.
        // Na Vercel as mesmas tarefas rodam por /api/cron (Vercel Cron).
        scheduleChecks();
        metrics.startHeartbeat();
        purgeOldAuditLogs().catch(err => console.error('Falha ao limpar auditoria:', err.message));
        setInterval(() => purgeOldAuditLogs().catch(() => {}), 24 * 60 * 60 * 1000).unref();
        startServer(PORT);
    })
    .catch((err) => {
        console.error('❌ Não foi possível iniciar a aplicação:', err.message);
        console.error('   Verifique a variável DATABASE_URL (banco Postgres/Neon).');
        process.exit(1);
    });
