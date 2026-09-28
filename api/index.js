/**
 * api/index.js
 * Ponto de entrada da aplicação na Vercel (função serverless).
 *
 * O vercel.json encaminha TODAS as rotas para este arquivo: a própria aplicação
 * Express serve os arquivos estáticos de /frontend e a API em /api, exatamente
 * como no servidor local.
 *
 * A instância do Express é guardada em globalThis para ser reaproveitada entre
 * invocações "quentes" (sem recriar rotas nem o pool do banco).
 */
require('dotenv').config();

const { createApp } = require('../src/app');

const GLOBAL_KEY = '__nexusfleet_express_app__';
const app = globalThis[GLOBAL_KEY] || (globalThis[GLOBAL_KEY] = createApp());

// Em ambiente serverless um erro em promessa não deve derrubar a instância.
process.on('unhandledRejection', err => console.error('❌ Promessa rejeitada sem tratamento:', err));

module.exports = app;
module.exports.default = app;
