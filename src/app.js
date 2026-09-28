/**
 * src/app.js
 * Monta a aplicação Express (sem abrir porta).
 *
 * É usada nos dois modos de execução:
 *  - servidor permanente  → server.js        (desenvolvimento local)
 *  - função serverless    → api/index.js     (Vercel)
 */
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const { bootstrap } = require('./bootstrap');
const errorHandler = require('./middlewares/error.middleware');
const metrics = require('./services/metrics.service');

const isProduction = process.env.NODE_ENV === 'production';

// Na Vercel o código é empacotado; o caminho do frontend pode variar conforme o bundle.
function resolveFrontendDir() {
    const candidates = [
        path.join(__dirname, '..', 'frontend'),
        path.join(process.cwd(), 'frontend'),
        path.join(__dirname, '..', '..', 'frontend')
    ];
    return candidates.find(dir => fs.existsSync(path.join(dir, 'login.html'))) || candidates[0];
}

const FRONTEND_DIR = resolveFrontendDir();

function createApp() {
    const app = express();

    app.set('trust proxy', 1);
    app.disable('x-powered-by');

    // RNF03 — dados em trânsito: força HTTPS em produção (atrás do proxy da Vercel)
    app.use((req, res, next) => {
        const proto = req.headers['x-forwarded-proto'];
        if (isProduction && process.env.FORCE_HTTPS !== 'false' && proto === 'http') {
            return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
        }
        if (req.secure || proto === 'https') {
            res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        }
        next();
    });

    // Cabeçalhos básicos de segurança
    app.use((req, res, next) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'SAMEORIGIN');
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        res.setHeader('Permissions-Policy', 'geolocation=(self)');
        next();
    });

    app.use(cors());
    app.use(express.json({ limit: '1mb' }));
    app.use(metrics.responseTimeMiddleware);

    app.use(express.static(FRONTEND_DIR));

    // Garante que o esquema do banco existe antes de qualquer chamada da API.
    // O custo ocorre apenas no primeiro acesso de cada instância (cold start).
    app.use('/api', (req, res, next) => {
        bootstrap().then(() => next()).catch(next);
    });

    app.use('/api', require('./routes/api.routes'));

    app.get('/', (req, res) => {
        res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
    });

    app.use((req, res) => {
        if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Endpoint não encontrado.' });
        res.status(404).sendFile(path.join(FRONTEND_DIR, 'login.html'));
    });

    app.use(errorHandler);

    return app;
}

module.exports = { createApp, FRONTEND_DIR };
