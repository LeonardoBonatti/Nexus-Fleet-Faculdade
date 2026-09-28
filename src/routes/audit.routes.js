// RNF05 — Consulta do histórico de alterações
const express = require('express');
const router = express.Router();
const authRequired = require('../middlewares/auth.middleware');
const { authorize } = require('../middlewares/permission.middleware');
const { get, all } = require('../database/query');
const v = require('../utils/validators');
const { RETENTION_MONTHS } = require('../services/audit.service');

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.use(authRequired, authorize('admin'));

router.get('/', asyncHandler(async (req, res) => {
    const where = ['company_id = ?'];
    const params = [req.companyId];

    if (req.query.entity) { where.push('entity = ?'); params.push(String(req.query.entity)); }
    if (req.query.action) { where.push('action = ?'); params.push(String(req.query.action)); }
    if (req.query.user_id) { where.push('user_id = ?'); params.push(v.requireId(req.query.user_id, 'Usuário')); }
    if (req.query.start) { where.push('created_at >= ?'); params.push(`${v.parseDateISO(req.query.start, 'Data inicial')} 00:00:00`); }
    if (req.query.end) { where.push('created_at <= ?'); params.push(`${v.parseDateISO(req.query.end, 'Data final')} 23:59:59`); }
    if (req.query.q) { where.push('(summary LIKE ? OR user_name LIKE ?)'); params.push(`%${req.query.q}%`, `%${req.query.q}%`); }

    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const clause = where.join(' AND ');

    const rows = await all(`SELECT * FROM audit_logs WHERE ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
    const total = await get(`SELECT COUNT(*) AS n FROM audit_logs WHERE ${clause}`, params);
    const oldest = await get(`SELECT MIN(created_at) AS d FROM audit_logs WHERE company_id = ?`, [req.companyId]);

    res.json({
        items: rows.map(r => {
            let changes = null;
            try { changes = r.changes ? JSON.parse(r.changes) : null; } catch (e) { changes = null; }
            return { ...r, changes };
        }),
        total: total.n,
        limit,
        offset,
        retention_months: RETENTION_MONTHS,
        oldest_record: oldest.d
    });
}));

module.exports = router;
