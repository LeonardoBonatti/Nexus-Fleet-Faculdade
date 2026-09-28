// CRUD genérico dos cadastros: /api/data/:recurso
// Cada recurso (src/resources) define permissões por perfil, validação e regras de negócio.
const express = require('express');
const router = express.Router();
const authRequired = require('../middlewares/auth.middleware');
const ErrorResponse = require('../utils/errorResponse');
const { get, all, run, insertRow, updateRow } = require('../database/query');
const { logAudit } = require('../services/audit.service');
const RESOURCES = require('../resources');

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function contextOf(req) {
    return { req, user: req.user, companyId: req.companyId, role: req.user.role, driverId: req.user.driverId };
}

function getResource(name, action, ctx) {
    const resource = RESOURCES[name];
    if (!resource) throw new ErrorResponse('Recurso inválido.', 404);
    const allowed = resource.roles[action];
    if (!allowed || !allowed.includes(ctx.role)) {
        throw new ErrorResponse('Seu perfil de acesso não permite esta ação.', 403);
    }
    return resource;
}

function scopeOf(resource, ctx) {
    return (resource.scope && resource.scope(ctx)) || { sql: '', params: [] };
}

async function prepare(resource, rows, ctx, opts = {}) {
    let out = rows;
    if (resource.enrich) out = await resource.enrich(out, ctx);
    if (resource.present) out = out.map(row => resource.present(row, ctx, opts));
    return out;
}

async function loadOne(resource, id, ctx) {
    const scope = scopeOf(resource, ctx);
    const row = await get(
        `SELECT * FROM ${resource.table} WHERE id = ? AND company_id = ? ${scope.sql}`,
        [id, ctx.companyId, ...scope.params]
    );
    if (!row) throw new ErrorResponse(`${resource.label} não encontrado(a).`, 404);
    return row;
}

// Chaves iniciadas com "_" não são colunas: são repassadas ao afterWrite
function splitExtras(data) {
    const clean = {};
    const extras = {};
    Object.entries(data).forEach(([key, value]) => {
        if (key.startsWith('_')) extras[key] = value;
        else clean[key] = value;
    });
    return { clean, extras };
}

router.use(authRequired);

// Listagem (RNF01: consultas indexadas por empresa)
router.get('/:resource', asyncHandler(async (req, res) => {
    const ctx = contextOf(req);
    const resource = getResource(req.params.resource, 'read', ctx);
    const scope = scopeOf(resource, ctx);
    const rows = await all(
        `SELECT * FROM ${resource.table} WHERE company_id = ? ${scope.sql} ORDER BY ${resource.orderBy || 'id DESC'}`,
        [ctx.companyId, ...scope.params]
    );
    res.json(await prepare(resource, rows, ctx));
}));

router.get('/:resource/:id', asyncHandler(async (req, res) => {
    const ctx = contextOf(req);
    const resource = getResource(req.params.resource, 'read', ctx);
    const row = await loadOne(resource, req.params.id, ctx);
    const [prepared] = await prepare(resource, [row], ctx, { reveal: req.query.reveal === '1' });
    res.json(prepared);
}));

router.post('/:resource', asyncHandler(async (req, res) => {
    const ctx = contextOf(req);
    const resource = getResource(req.params.resource, 'create', ctx);
    const { clean, extras } = splitExtras(await resource.build(req.body || {}, null, ctx));

    clean.company_id = ctx.companyId;
    if (clean.user_id === undefined) clean.user_id = ctx.user.id;

    const id = await insertRow(resource.table, clean);
    const row = await get(`SELECT * FROM ${resource.table} WHERE id = ?`, [id]);
    if (resource.afterWrite) await resource.afterWrite('create', row, ctx, extras, null);

    await logAudit(req, {
        action: 'create', entity: req.params.resource, entityId: id, after: row,
        summary: resource.describe ? resource.describe(row) : null
    });

    const [prepared] = await prepare(resource, [row], ctx);
    res.status(201).json({ success: true, id, data: prepared });
}));

router.put('/:resource/:id', asyncHandler(async (req, res) => {
    const ctx = contextOf(req);
    const resource = getResource(req.params.resource, 'update', ctx);
    const current = await loadOne(resource, req.params.id, ctx);
    const { clean, extras } = splitExtras(await resource.build(req.body || {}, current, ctx));
    delete clean.company_id;
    delete clean.user_id;

    await updateRow(resource.table, current.id, clean, ctx.companyId);
    const row = await get(`SELECT * FROM ${resource.table} WHERE id = ?`, [current.id]);
    if (resource.afterWrite) await resource.afterWrite('update', row, ctx, extras, current);

    await logAudit(req, {
        action: 'update', entity: req.params.resource, entityId: current.id, before: current, after: clean,
        summary: resource.describe ? resource.describe(row) : null
    });

    const [prepared] = await prepare(resource, [row], ctx);
    res.json({ success: true, data: prepared });
}));

router.delete('/:resource/:id', asyncHandler(async (req, res) => {
    const ctx = contextOf(req);
    const resource = getResource(req.params.resource, 'delete', ctx);
    const current = await loadOne(resource, req.params.id, ctx);
    if (resource.beforeDelete) await resource.beforeDelete(current, ctx);

    if (resource.trash) {
        await run(
            `INSERT INTO trash (company_id, user_id, original_id, original_type, data) VALUES (?, ?, ?, ?, ?)`,
            [ctx.companyId, ctx.user.id, current.id, req.params.resource, JSON.stringify(current)]
        );
    }
    await run(`DELETE FROM ${resource.table} WHERE id = ? AND company_id = ?`, [current.id, ctx.companyId]);
    if (resource.afterDelete) await resource.afterDelete(current, ctx);

    await logAudit(req, {
        action: 'delete', entity: req.params.resource, entityId: current.id, before: current,
        summary: resource.describe ? resource.describe(current) : null
    });

    res.json({ success: true, trashed: !!resource.trash });
}));

module.exports = router;
module.exports.RESOURCES = RESOURCES;
