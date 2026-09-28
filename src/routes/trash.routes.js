// Lixeira: listar, restaurar e excluir definitivamente
const express = require('express');
const router = express.Router();
const authRequired = require('../middlewares/auth.middleware');
const { authorize } = require('../middlewares/permission.middleware');
const ErrorResponse = require('../utils/errorResponse');
const { get, all, run, insertRow, tableColumns } = require('../database/query');
const { logAudit } = require('../services/audit.service');
const RESOURCES = require('../resources');

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.use(authRequired, authorize('admin', 'gestor'));

router.get('/', asyncHandler(async (req, res) => {
    const rows = await all(
        `SELECT t.*, u.name AS deleted_by FROM trash t LEFT JOIN users u ON u.id = t.user_id
         WHERE t.company_id = ? ORDER BY t.deleted_at DESC, t.id DESC`,
        [req.companyId]
    );
    res.json(rows.map(row => {
        let data = {};
        try { data = JSON.parse(row.data); } catch (e) { data = {}; }
        const resource = RESOURCES[row.original_type];
        // Dados sensíveis nunca saem da lixeira
        ['cpf_enc', 'cpf_hash', 'cnh_enc', 'cnh_hash'].forEach(k => delete data[k]);
        return {
            ...row,
            data,
            label: resource ? resource.label : 'Registro',
            summary: resource && resource.describe ? resource.describe(data) : `#${row.original_id}`
        };
    }));
}));

router.post('/:id/restore', asyncHandler(async (req, res) => {
    const item = await get(`SELECT * FROM trash WHERE id = ? AND company_id = ?`, [req.params.id, req.companyId]);
    if (!item) throw new ErrorResponse('Item não encontrado na lixeira.', 404);

    const resource = RESOURCES[item.original_type];
    if (!resource) throw new ErrorResponse('Tipo de registro inválido.', 400);

    const data = JSON.parse(item.data);
    const columns = await tableColumns(resource.table);
    const row = {};
    columns.forEach(col => { if (data[col] !== undefined) row[col] = data[col]; });
    row.company_id = req.companyId;
    if (row.user_id === undefined || row.user_id === null) row.user_id = req.user.id;

    // Conflitos de unicidade
    if (resource.table === 'vehicles') {
        const dup = await get(`SELECT id FROM vehicles WHERE company_id = ? AND plate = ?`, [req.companyId, row.plate]);
        if (dup) throw new ErrorResponse(`Já existe um veículo com a placa ${row.plate}. Altere-o antes de restaurar.`, 409);
        if (row.status === 'in_trip') row.status = 'available';
    }
    if (resource.table === 'drivers') {
        const dup = await get(
            `SELECT id FROM drivers WHERE company_id = ? AND (cpf_hash = ? OR cnh_hash = ?)`,
            [req.companyId, row.cpf_hash, row.cnh_hash]
        );
        if (dup) throw new ErrorResponse('Já existe um motorista com o mesmo CPF ou CNH.', 409);
    }

    // Reaproveita o ID original quando livre (mantém vínculos com outros registros)
    const taken = await get(`SELECT id FROM ${resource.table} WHERE id = ?`, [row.id]);
    if (taken) delete row.id;

    const id = await insertRow(resource.table, row);
    await run(`DELETE FROM trash WHERE id = ?`, [item.id]);

    await logAudit(req, {
        action: 'restore', entity: item.original_type, entityId: id, after: row,
        summary: resource.describe ? resource.describe(row) : null
    });
    res.json({ success: true, id });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
    const item = await get(`SELECT * FROM trash WHERE id = ? AND company_id = ?`, [req.params.id, req.companyId]);
    if (!item) throw new ErrorResponse('Item não encontrado na lixeira.', 404);
    await run(`DELETE FROM trash WHERE id = ?`, [item.id]);
    await logAudit(req, { action: 'purge', entity: item.original_type, entityId: item.original_id, summary: 'Exclusão definitiva' });
    res.json({ success: true });
}));

router.delete('/', asyncHandler(async (req, res) => {
    const result = await run(`DELETE FROM trash WHERE company_id = ?`, [req.companyId]);
    await logAudit(req, { action: 'purge', entity: 'trash', summary: `Lixeira esvaziada (${result.changes} item(ns))` });
    res.json({ success: true, removed: result.changes });
}));

module.exports = router;
