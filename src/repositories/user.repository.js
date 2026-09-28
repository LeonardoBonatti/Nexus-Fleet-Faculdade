const { get, run } = require('../database/query');

class UserRepository {
    findByEmail(email) {
        return get(`SELECT * FROM users WHERE email = ?`, [email]);
    }

    findById(id) {
        return get(
            `SELECT u.*, c.name AS company_name,
                    (SELECT d.id FROM drivers d WHERE d.linked_user_id = u.id AND d.company_id = u.company_id) AS driver_id
             FROM users u LEFT JOIN companies c ON c.id = u.company_id
             WHERE u.id = ?`,
            [id]
        );
    }

    async createCompany(name) {
        const result = await run(`INSERT INTO companies (name) VALUES (?)`, [name]);
        return result.lastID;
    }

    async create(userData) {
        const result = await run(
            `INSERT INTO users (company_id, name, email, password_hash, role, cargo, active) VALUES (?, ?, ?, ?, ?, ?, 1)`,
            [userData.company_id, userData.name, userData.email, userData.password_hash, userData.role, userData.cargo]
        );
        return { id: result.lastID, name: userData.name, email: userData.email, role: userData.role, cargo: userData.cargo };
    }

    updateLastLogin(id) {
        return run(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`, [id]);
    }

    updateProfile(id, { name, cargo }) {
        return run(`UPDATE users SET name = ?, cargo = ? WHERE id = ?`, [name, cargo, id]);
    }

    updatePassword(id, passwordHash) {
        return run(`UPDATE users SET password_hash = ? WHERE id = ?`, [passwordHash, id]);
    }
}

module.exports = new UserRepository();
