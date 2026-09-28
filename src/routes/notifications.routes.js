// Central de notificações do usuário
const express = require('express');
const router = express.Router();
const authRequired = require('../middlewares/auth.middleware');
const { authorize } = require('../middlewares/permission.middleware');
const { get, all, run } = require('../database/query');
const { checkCompany } = require('../services/notification.service');

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Notificações sem destinatário específico vão para administradores e gestores
const AUDIENCE = `company_id = ? AND (user_id = ? OR (user_id IS NULL AND ? = 1))`;
const audienceParams = req => [req.companyId, req.user.id, ['admin', 'gestor'].includes(req.user.role) ? 1 : 0];

router.use(authRequired);

router.get('/', asyncHandler(async (req, res) => {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 30));
    const items = await all(
        `SELECT * FROM notifications WHERE ${AUDIENCE}
         ORDER BY read_at IS NOT NULL, created_at DESC, id DESC LIMIT ?`,
        [...audienceParams(req), limit]
    );
    const unread = await get(`SELECT COUNT(*) AS n FROM notifications WHERE ${AUDIENCE} AND read_at IS NULL`, audienceParams(req));
    res.json({ items, unread: unread.n });
}));

router.post('/read-all', asyncHandler(async (req, res) => {
    const result = await run(`UPDATE notifications SET read_at = datetime('now') WHERE ${AUDIENCE} AND read_at IS NULL`, audienceParams(req));
    res.json({ success: true, updated: result.changes });
}));

router.post('/check', authorize('admin', 'gestor'), asyncHandler(async (req, res) => {
    await checkCompany(req.companyId);
    res.json({ success: true });
}));

router.post('/:id/read', asyncHandler(async (req, res) => {
    await run(
        `UPDATE notifications SET read_at = COALESCE(read_at, datetime('now')) WHERE id = ? AND ${AUDIENCE}`,
        [req.params.id, ...audienceParams(req)]
    );
    res.json({ success: true });
}));

module.exports = router;
