/**
 * Entidade de Usuário.
 * Perfis (RF14): admin, gestor, motorista, financeiro.
 */
class User {
    constructor({ id, company_id, name, email, password_hash, role = 'gestor', cargo = 'Colaborador' }) {
        this.id = id;
        this.company_id = company_id;
        this.name = name;
        this.email = email;
        this.password_hash = password_hash;
        this.role = role;
        this.cargo = cargo;
    }
}

module.exports = User;
