// Tratamento centralizado de erros da API
module.exports = function errorHandler(err, req, res, next) {
    if (res.headersSent) return next(err);

    if (err.type === 'entity.parse.failed') {
        return res.status(400).json({ error: 'JSON inválido no corpo da requisição.' });
    }
    if (err.type === 'entity.too.large') {
        return res.status(413).json({ error: 'Requisição muito grande.' });
    }
    if (err.statusCode) {
        return res.status(err.statusCode).json({ error: err.message });
    }
    // PostgreSQL: 23505 = violação de índice único
    if (err.code === '23505' || (err.code === 'SQLITE_CONSTRAINT' && /UNIQUE/i.test(err.message))) {
        return res.status(409).json({ error: 'Registro duplicado.' });
    }
    // PostgreSQL: 22P02 = texto inválido para o tipo da coluna (ex.: /api/data/vehicles/abc)
    if (err.code === '22P02') {
        return res.status(400).json({ error: 'Parâmetro inválido na requisição.' });
    }
    // Banco indisponível (Neon dormindo, credenciais erradas, rede)
    if (['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', '57P01', '53300', '08006'].includes(err.code)) {
        console.error('❌ Banco de dados indisponível:', err.message);
        return res.status(503).json({ error: 'Banco de dados indisponível. Tente novamente em instantes.' });
    }

    console.error('❌ Erro não tratado:', err);
    return res.status(500).json({ error: 'Erro interno no servidor.' });
};
