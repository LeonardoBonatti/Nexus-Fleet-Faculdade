// Compatibilidade: o banco do projeto migrou de SQLite para PostgreSQL (Neon/Vercel).
// A implementação atual fica em src/config/db.js — este arquivo apenas reencaminha
// para não quebrar imports antigos.
module.exports = require('./db');
