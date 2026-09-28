/**
 * src/handler.js
 * Instância única da aplicação Express usada pelas funções serverless da Vercel.
 *
 * Guardada em globalThis para ser reaproveitada entre invocações "quentes"
 * (sem recriar rotas nem o pool de conexões do banco).
 */
require('dotenv').config();

const { createApp } = require('./app');

const GLOBAL_KEY = '__nexusfleet_express_app__';
const app = globalThis[GLOBAL_KEY] || (globalThis[GLOBAL_KEY] = createApp());

// Em ambiente serverless um erro em promessa não deve derrubar a instância.
if (!globalThis.__nexusfleet_handlers_registered__) {
    globalThis.__nexusfleet_handlers_registered__ = true;
    process.on('unhandledRejection', err => console.error('❌ Promessa rejeitada sem tratamento:', err));
}

module.exports = app;
