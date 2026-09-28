// RNF01 / RNF02 / RNF03 — Saúde e status do sistema
const express = require('express');
const router = express.Router();
const authRequired = require('../middlewares/auth.middleware');
const { authorize } = require('../middlewares/permission.middleware');
const { get } = require('../database/query');
const metrics = require('../services/metrics.service');
const { RETENTION_MONTHS } = require('../services/audit.service');

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Identifica o banco sem expor usuário e senha da connection string
function databaseLabel() {
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
    if (!url) return null;
    try {
        const parsed = new URL(url);
        return `${parsed.hostname}${parsed.pathname}`;
    } catch (e) {
        return 'postgres';
    }
}

// Endpoint público para monitoramento externo (ex.: UptimeRobot)
router.get('/health', asyncHandler(async (req, res) => {
    try {
        await get('SELECT 1 AS ok');
        res.json({
            status: 'ok',
            uptime_seconds: Math.round(process.uptime()),
            started_at: metrics.startedAt.toISOString(),
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        res.status(503).json({ status: 'error', error: 'Banco de dados indisponível.' });
    }
}));

router.get('/status', authRequired, authorize('admin'), asyncHandler(async (req, res) => {
    const count = async table => (await get(`SELECT COUNT(*) AS n FROM ${table} WHERE company_id = ?`, [req.companyId])).n;
    let dbSize = null;
    try {
        const row = await get(`SELECT pg_database_size(current_database()) AS bytes`);
        dbSize = row ? Number(row.bytes) : null;
    } catch (e) { dbSize = null; }

    res.json({
        started_at: metrics.startedAt.toISOString(),
        uptime_seconds: Math.round(process.uptime()),
        node_version: process.version,
        runtime: process.env.VERCEL ? 'Vercel (serverless)' : 'Node.js (servidor dedicado)',
        database: databaseLabel(),
        database_engine: 'PostgreSQL',
        availability_30d: await metrics.availability(30),
        response_times: metrics.responseStats(),
        counts: {
            vehicles: await count('vehicles'),
            drivers: await count('drivers'),
            trips: await count('trips'),
            users: await count('users')
        },
        database_size_bytes: dbSize,
        audit_retention_months: RETENTION_MONTHS,
        security: {
            encryption: 'AES-256-GCM (CPF e CNH)',
            dedicated_key: !!process.env.DATA_ENCRYPTION_KEY,
            https: req.secure,
            password_hash: 'bcrypt'
        }
    });
}));

module.exports = router;
