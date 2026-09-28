const userRepository = require('../repositories/user.repository');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const ErrorResponse = require('../utils/errorResponse');
const User = require('../models/User');
const { JWT_SECRET, JWT_EXPIRATION } = require('../config/auth');
const { ROLE_LABELS } = require('../middlewares/permission.middleware');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MIN_PASSWORD = 8;

function toPublicUser(user) {
    return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        role_label: ROLE_LABELS[user.role] || user.role,
        cargo: user.cargo,
        company_id: user.company_id,
        company_name: user.company_name || null,
        driver_id: user.driver_id || null,
        created_at: user.created_at
    };
}

class UserService {
    // Cadastro público: cria a empresa e o primeiro usuário como Administrador
    async registerUser(data) {
        const name = String(data.name || '').trim();
        const email = String(data.email || '').trim().toLowerCase();
        const password = String(data.password || '');
        const cargo = String(data.cargo || '').trim() || 'Administrador';
        const companyName = String(data.company_name || '').trim() || `Frota de ${name}`;

        if (name.length < 2 || name.length > 100) throw new ErrorResponse('Nome deve ter entre 2 e 100 caracteres.', 400);
        if (companyName.length > 120) throw new ErrorResponse('Nome da empresa muito longo.', 400);
        if (!EMAIL_REGEX.test(email)) throw new ErrorResponse('E-mail inválido.', 400);
        if (password.length < MIN_PASSWORD) throw new ErrorResponse(`A senha deve ter no mínimo ${MIN_PASSWORD} caracteres.`, 400);

        if (await userRepository.findByEmail(email)) throw new ErrorResponse('Email já está em uso.', 409);

        const companyId = await userRepository.createCompany(companyName);
        const user = new User({
            company_id: companyId,
            name,
            email,
            password_hash: await bcrypt.hash(password, 10),
            role: 'admin',
            cargo
        });
        return userRepository.create(user);
    }

    async login(email, password) {
        const user = await userRepository.findByEmail(String(email || '').trim().toLowerCase());

        // Mensagem genérica: não revela se o e-mail existe na base
        const isMatch = user ? await bcrypt.compare(String(password || ''), user.password_hash) : false;
        if (!user || !isMatch) throw new ErrorResponse('E-mail ou senha incorretos.', 401);
        if (!user.active) throw new ErrorResponse('Conta desativada. Procure o administrador do sistema.', 403);

        await userRepository.updateLastLogin(user.id);
        const full = await userRepository.findById(user.id);
        const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: JWT_EXPIRATION });

        return { user: toPublicUser(full), token };
    }

    async getProfile(userId) {
        const user = await userRepository.findById(userId);
        if (!user) throw new ErrorResponse('Usuário não encontrado.', 404);
        return toPublicUser(user);
    }

    async updateProfile(userId, data) {
        const name = String(data.name || '').trim();
        const cargo = String(data.cargo || '').trim() || 'Colaborador';
        if (name.length < 2 || name.length > 100) throw new ErrorResponse('Nome deve ter entre 2 e 100 caracteres.', 400);
        if (cargo.length > 100) throw new ErrorResponse('Cargo muito longo.', 400);

        await userRepository.updateProfile(userId, { name, cargo });
        return this.getProfile(userId);
    }

    async changePassword(userId, currentPassword, newPassword) {
        const user = await userRepository.findById(userId);
        if (!user) throw new ErrorResponse('Usuário não encontrado.', 404);

        const isMatch = await bcrypt.compare(String(currentPassword || ''), user.password_hash);
        if (!isMatch) throw new ErrorResponse('Senha atual incorreta.', 400);
        if (String(newPassword || '').length < MIN_PASSWORD) {
            throw new ErrorResponse(`A nova senha deve ter no mínimo ${MIN_PASSWORD} caracteres.`, 400);
        }
        await userRepository.updatePassword(userId, await bcrypt.hash(String(newPassword), 10));
    }
}

module.exports = new UserService();
