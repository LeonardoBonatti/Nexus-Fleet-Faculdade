// Configuração centralizada de autenticação (JWT)
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
    console.warn('⚠️  JWT_SECRET não definido no .env — usando chave de desenvolvimento. NÃO use em produção.');
}

module.exports = {
    JWT_SECRET: JWT_SECRET || 'dev_only_insecure_secret',
    JWT_EXPIRATION: process.env.JWT_EXPIRATION || '24h'
};
