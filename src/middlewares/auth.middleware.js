const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/auth');
const { get } = require('../database/query');

// Valida o JWT e carrega o usuário do banco a cada requisição, garantindo que
// mudanças de perfil ou desativação da conta valham imediatamente (RF14).
module.exports = async function authRequired(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ error: 'Token não fornecido.' });
    }

    const [scheme, token] = authHeader.split(' ');
    if (!/^Bearer$/i.test(scheme || '') || !token) {
        return res.status(401).json({ error: 'Token mal formatado.' });
    }

    let decoded;
    try {
        decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
        return res.status(401).json({ error: 'Sessão inválida ou expirada.' });
    }

    try {
        const user = await get(
            `SELECT id, company_id, name, email, role, cargo, active FROM users WHERE id = ?`,
            [decoded.id]
        );
        if (!user || !user.active || !user.company_id) {
            return res.status(401).json({ error: 'Usuário inativo ou inexistente.' });
        }

        let driverId = null;
        if (user.role === 'motorista') {
            const driver = await get(`SELECT id FROM drivers WHERE linked_user_id = ? AND company_id = ?`, [user.id, user.company_id]);
            driverId = driver ? driver.id : null;
        }

        req.user = { ...user, driverId };
        req.userId = user.id;
        req.userRole = user.role;
        req.companyId = user.company_id;
        return next();
    } catch (err) {
        return next(err);
    }
};
