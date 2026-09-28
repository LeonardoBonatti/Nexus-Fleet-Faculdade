// Limitador simples em memória (sem dependências externas) para proteger
// login e cadastro contra força bruta. Conta apenas tentativas que FALHARAM,
// para não bloquear usuários legítimos que compartilham o mesmo IP.
module.exports = function rateLimit({ windowMs = 15 * 60 * 1000, max = 10, message } = {}) {
    const failures = new Map();

    return (req, res, next) => {
        const key = req.ip;
        const now = Date.now();
        let entry = failures.get(key);

        if (entry && now > entry.resetAt) {
            failures.delete(key);
            entry = null;
        }

        if (entry && entry.count >= max) {
            const retry = Math.ceil((entry.resetAt - now) / 1000);
            res.set('Retry-After', String(retry));
            return res.status(429).json({ error: message || `Muitas tentativas sem sucesso. Tente novamente em ${Math.ceil(retry / 60)} minuto(s).` });
        }

        res.on('finish', () => {
            if (res.statusCode < 400 || res.statusCode === 429) return;
            const current = failures.get(key);
            if (current && Date.now() <= current.resetAt) current.count++;
            else failures.set(key, { count: 1, resetAt: Date.now() + windowMs });
        });

        return next();
    };
};
