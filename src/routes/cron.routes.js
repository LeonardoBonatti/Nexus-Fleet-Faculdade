/**
 * RF05 / RF13 / RNF02 / RNF05 — Rotina automática diária.
 *
 * Em um servidor permanente estas tarefas rodavam com setInterval. No modelo
 * serverless da Vercel não existe processo em execução contínua, então a mesma
 * rotina é disparada pelo Vercel Cron (configurado em vercel.json) chamando
 * GET /api/cron uma vez por dia.
 *
 * Proteção: a Vercel envia o cabeçalho "Authorization: Bearer <CRON_SECRET>"
 * quando a variável CRON_SECRET está definida no projeto.
 */
const express = require('express');
const router = express.Router();
const { runAllChecks } = require('../services/notification.service');
const { purgeOldAuditLogs } = require('../services/audit.service');
const metrics = require('../services/metrics.service');

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function authorized(req) {
    const secret = process.env.CRON_SECRET;
    if (secret) {
        const header = req.headers.authorization || '';
        if (header === `Bearer ${secret}`) return true;
        if (req.query.secret === secret) return true;
        return false;
    }
    // Sem segredo configurado, aceita apenas a chamada interna do agendador da Vercel
    return Boolean(req.headers['x-vercel-cron']);
}

router.all('/', asyncHandler(async (req, res) => {
    if (!authorized(req)) {
        return res.status(401).json({ error: 'Não autorizado.' });
    }

    const startedAt = Date.now();
    const result = { checks: 'ok', audit_purge: 'ok', heartbeat: 'ok' };

    try {
        await metrics.recordHeartbeat();
    } catch (err) {
        result.heartbeat = `erro: ${err.message}`;
    }

    try {
        await runAllChecks();
    } catch (err) {
        result.checks = `erro: ${err.message}`;
    }

    try {
        await purgeOldAuditLogs();
    } catch (err) {
        result.audit_purge = `erro: ${err.message}`;
    }

    res.json({ success: true, ran_at: new Date().toISOString(), duration_ms: Date.now() - startedAt, ...result });
}));

module.exports = router;
