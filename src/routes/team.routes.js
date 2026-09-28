// RF14 — Administração de usuários e perfis de acesso
const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const authRequired = require('../middlewares/auth.middleware');
const { authorize, ROLES } = require('../middlewares/permission.middleware');
const ErrorResponse = require('../utils/errorResponse');
const { get, all, run, insertRow, updateRow } = require('../database/query');
const v = require('../utils/validators');
const { logAudit } = require('../services/audit.service');

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

router.use(authRequired, authorize('admin'));

async function linkDriver(companyId, userId, driverId) {
    await run(`UPDATE drivers SET linked_user_id = NULL WHERE linked_user_id = ? AND company_id = ?`, [userId, companyId]);
    if (!driverId) return;
    const driver = await get(`SELECT id, linked_user_id FROM drivers WHERE id = ? AND company_id = ?`, [driverId, companyId]);
    if (!driver) throw new ErrorResponse('Motorista não encontrado.', 404);
    if (driver.linked_user_id && driver.linked_user_id !== userId) {
        throw new ErrorResponse('Este motorista já está vinculado a outro usuário.', 409);
    }
    await run(`UPDATE drivers SET linked_user_id = ? WHERE id = ?`, [userId, driverId]);
}

router.get('/', asyncHandler(async (req, res) => {
    const users = await all(
        `SELECT u.id, u.name, u.email, u.role, u.cargo, u.active, u.last_login_at, u.created_at,
                d.id AS driver_id, d.name AS driver_name
         FROM users u LEFT JOIN drivers d ON d.linked_user_id = u.id AND d.company_id = u.company_id
         WHERE u.company_id = ? ORDER BY u.name COLLATE NOCASE`,
        [req.companyId]
    );
    res.json(users.map(u => ({ ...u, active: !!u.active })));
}));

router.post('/', asyncHandler(async (req, res) => {
    const body = req.body || {};
    const email = String(body.email || '').trim().toLowerCase();
    if (!EMAIL_REGEX.test(email)) throw new ErrorResponse('E-mail inválido.', 400);
    if (await get(`SELECT id FROM users WHERE email = ?`, [email])) throw new ErrorResponse('E-mail já está em uso.', 409);
    if (String(body.password || '').length < 8) throw new ErrorResponse('A senha inicial deve ter no mínimo 8 caracteres.', 400);

    const role = v.oneOf(body.role, ROLES, 'Perfil de acesso');
    const data = {
        company_id: req.companyId,
        name: v.requireText(body.name, 'Nome', { min: 2, max: 100 }),
        email,
        role,
        cargo: v.optionalText(body.cargo, 'Cargo', 100) || 'Colaborador',
        password_hash: await bcrypt.hash(String(body.password), 10),
        active: 1
    };

    const id = await insertRow('users', data);
    if (role === 'motorista' && body.driver_id) await linkDriver(req.companyId, id, v.requireId(body.driver_id, 'Motorista'));

    await logAudit(req, { action: 'create', entity: 'users', entityId: id, after: data, summary: `Usuário ${data.name} (${role})` });
    res.status(201).json({ success: true, id });
}));

router.put('/:id', asyncHandler(async (req, res) => {
    const body = req.body || {};
    const current = await get(`SELECT * FROM users WHERE id = ? AND company_id = ?`, [req.params.id, req.companyId]);
    if (!current) throw new ErrorResponse('Usuário não encontrado.', 404);

    const role = v.oneOf(body.role !== undefined ? body.role : current.role, ROLES, 'Perfil de acesso');
    const active = body.active !== undefined ? (body.active === true || body.active === 1 || body.active === 'true' ? 1 : 0) : current.active;
    const data = {
        name: v.requireText(body.name !== undefined ? body.name : current.name, 'Nome', { min: 2, max: 100 }),
        cargo: v.optionalText(body.cargo !== undefined ? body.cargo : current.cargo, 'Cargo', 100) || 'Colaborador',
        role,
        active
    };

    if (current.id === req.user.id && (role !== current.role || !active)) {
        throw new ErrorResponse('Você não pode alterar o próprio perfil de acesso nem desativar a própria conta.', 400);
    }
    if (current.role === 'admin' && current.active && (role !== 'admin' || !active)) {
        const admins = await get(`SELECT COUNT(*) AS n FROM users WHERE company_id = ? AND role = 'admin' AND active = 1 AND id <> ?`, [req.companyId, current.id]);
        if (!admins.n) throw new ErrorResponse('A empresa precisa de pelo menos um administrador ativo.', 400);
    }

    await updateRow('users', current.id, data, req.companyId);
    if (role !== 'motorista') {
        await run(`UPDATE drivers SET linked_user_id = NULL WHERE linked_user_id = ? AND company_id = ?`, [current.id, req.companyId]);
    } else if (body.driver_id !== undefined) {
        await linkDriver(req.companyId, current.id, body.driver_id ? v.requireId(body.driver_id, 'Motorista') : null);
    }

    await logAudit(req, { action: 'update', entity: 'users', entityId: current.id, before: current, after: data, summary: `Usuário ${data.name}` });
    res.json({ success: true });
}));

router.post('/:id/reset-password', asyncHandler(async (req, res) => {
    const user = await get(`SELECT id, name FROM users WHERE id = ? AND company_id = ?`, [req.params.id, req.companyId]);
    if (!user) throw new ErrorResponse('Usuário não encontrado.', 404);
    const password = String((req.body || {}).password || '');
    if (password.length < 8) throw new ErrorResponse('A nova senha deve ter no mínimo 8 caracteres.', 400);

    await run(`UPDATE users SET password_hash = ? WHERE id = ?`, [await bcrypt.hash(password, 10), user.id]);
    await logAudit(req, { action: 'update', entity: 'users', entityId: user.id, summary: `Senha redefinida para ${user.name}`, before: {}, after: { password_hash: 'alterada' } });
    res.json({ success: true });
}));

module.exports = router;
