// UserController
const userService = require('../services/user.service');
const { logAudit } = require('../services/audit.service');

function handleError(res, error) {
    const statusCode = error.statusCode || 500;
    if (statusCode === 500) console.error(error);
    return res.status(statusCode).json({ error: statusCode === 500 ? 'Erro interno no servidor.' : error.message });
}

class UserController {
    async register(req, res) {
        try {
            const { name, email, password, cargo, company_name } = req.body || {};
            if (!name || !email || !password) {
                return res.status(400).json({ error: 'Nome, Email e Senha são obrigatórios.' });
            }
            const newUser = await userService.registerUser({ name, email, password, cargo, company_name });
            return res.status(201).json({ success: true, message: 'Conta criada com sucesso!', data: newUser });
        } catch (error) {
            return handleError(res, error);
        }
    }

    async login(req, res) {
        try {
            const { email, password } = req.body || {};
            if (!email || !password) {
                return res.status(400).json({ error: 'Email e Senha são obrigatórios.' });
            }
            const authData = await userService.login(email, password);
            await logAudit({ user: authData.user, ip: req.ip }, {
                action: 'login', entity: 'users', entityId: authData.user.id, summary: 'Login realizado'
            });
            return res.status(200).json({ success: true, message: 'Login bem sucedido.', data: authData });
        } catch (error) {
            return handleError(res, error);
        }
    }

    async getProfile(req, res) {
        try {
            const user = await userService.getProfile(req.userId);
            return res.status(200).json({ success: true, data: user });
        } catch (error) {
            return handleError(res, error);
        }
    }

    async updateProfile(req, res) {
        try {
            const user = await userService.updateProfile(req.userId, req.body || {});
            await logAudit(req, { action: 'update', entity: 'users', entityId: req.userId, before: req.user, after: { name: user.name, cargo: user.cargo }, summary: 'Perfil atualizado' });
            return res.status(200).json({ success: true, message: 'Perfil atualizado.', data: user });
        } catch (error) {
            return handleError(res, error);
        }
    }

    async changePassword(req, res) {
        try {
            const { currentPassword, newPassword } = req.body || {};
            await userService.changePassword(req.userId, currentPassword, newPassword);
            await logAudit(req, { action: 'update', entity: 'users', entityId: req.userId, before: {}, after: { password_hash: 'alterada' }, summary: 'Senha alterada' });
            return res.status(200).json({ success: true, message: 'Senha alterada com sucesso.' });
        } catch (error) {
            return handleError(res, error);
        }
    }
}

module.exports = new UserController();
