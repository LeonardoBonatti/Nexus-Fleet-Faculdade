// RF14 — Controle de acesso por perfil
const ROLES = ['admin', 'gestor', 'motorista', 'financeiro'];

const ROLE_LABELS = {
    admin: 'Administrador',
    gestor: 'Gestor de Frota',
    motorista: 'Motorista',
    financeiro: 'Financeiro / Diretoria'
};

function authorize(...roles) {
    return (req, res, next) => {
        if (req.user && roles.includes(req.user.role)) return next();
        return res.status(403).json({ error: 'Seu perfil de acesso não permite esta ação.' });
    };
}

module.exports = { ROLES, ROLE_LABELS, authorize };
