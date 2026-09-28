// RNF01 / RNF02 — Métricas de tempo de resposta e disponibilidade
const { get, run } = require('../database/query');

const startedAt = new Date();
const samples = [];
const MAX_SAMPLES = 1000;

// Mede cada requisição da API e expõe o tempo no cabeçalho X-Response-Time
function responseTimeMiddleware(req, res, next) {
    const start = process.hrtime.bigint();
    const elapsed = () => Number(process.hrtime.bigint() - start) / 1e6;

    const originalWriteHead = res.writeHead;
    res.writeHead = function (...args) {
        if (!res.headersSent) res.setHeader('X-Response-Time', `${elapsed().toFixed(1)}ms`);
        return originalWriteHead.apply(this, args);
    };

    res.on('finish', () => {
        if (!req.originalUrl.startsWith('/api')) return;
        const path = `${req.baseUrl || ''}${req.route ? req.route.path : ''}` || req.originalUrl.split('?')[0];
        samples.push({ method: req.method, path, status: res.statusCode, ms: elapsed(), at: Date.now() });
        if (samples.length > MAX_SAMPLES) samples.shift();
        touchHeartbeat();
    });
    next();
}

function responseStats() {
    const recent = samples.slice(-500);
    if (!recent.length) return { count: 0, avg_ms: null, p95_ms: null, max_ms: null, over_3s: 0, slowest: [] };

    const times = recent.map(s => s.ms).sort((a, b) => a - b);
    const byPath = {};
    recent.forEach(s => {
        const key = `${s.method} ${s.path}`;
        byPath[key] = byPath[key] || { endpoint: key, count: 0, total: 0, max: 0 };
        byPath[key].count++;
        byPath[key].total += s.ms;
        byPath[key].max = Math.max(byPath[key].max, s.ms);
    });

    return {
        count: recent.length,
        avg_ms: Number((times.reduce((a, b) => a + b, 0) / times.length).toFixed(1)),
        p95_ms: Number(times[Math.min(times.length - 1, Math.floor(times.length * 0.95))].toFixed(1)),
        max_ms: Number(times[times.length - 1].toFixed(1)),
        over_3s: times.filter(t => t > 3000).length,
        slowest: Object.values(byPath)
            .map(p => ({ endpoint: p.endpoint, count: p.count, avg_ms: Number((p.total / p.count).toFixed(1)), max_ms: Number(p.max.toFixed(1)) }))
            .sort((a, b) => b.avg_ms - a.avg_ms)
            .slice(0, 6)
    };
}

// RNF02 — um batimento por minuto: disponibilidade = minutos com batimento ÷ minutos decorridos.
// Em ambiente serverless (Vercel) não existe processo permanente para usar setInterval,
// por isso o batimento é gravado durante as requisições (no máximo uma vez por minuto)
// e também pelo agendamento diário (Vercel Cron, /api/cron).
async function recordHeartbeat() {
    const minute = new Date().toISOString().slice(0, 16);
    const cutoff = new Date(Date.now() - 35 * 86400000).toISOString().slice(0, 16);
    await run(`INSERT OR IGNORE INTO system_heartbeats (minute) VALUES (?)`, [minute]);
    await run(`DELETE FROM system_heartbeats WHERE minute < ?`, [cutoff]);
}

let lastBeatAt = 0;

// Grava o batimento no máximo uma vez por minuto por instância (custo desprezível)
function touchHeartbeat() {
    const now = Date.now();
    if (now - lastBeatAt < 55000) return;
    lastBeatAt = now;
    recordHeartbeat().catch(err => console.error('Falha ao registrar batimento:', err.message));
}

// Usado apenas quando o sistema roda como servidor permanente (desenvolvimento local)
function startHeartbeat() {
    const beat = () => recordHeartbeat().catch(err => console.error('Falha ao registrar batimento:', err.message));
    beat();
    setInterval(beat, 60000).unref();
}

async function availability(days = 30) {
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 16);
    const row = await get(`SELECT MIN(minute) AS first, COUNT(*) AS n FROM system_heartbeats WHERE minute >= ?`, [since]);
    if (!row || !row.first) return null;
    const expected = Math.floor((Date.now() - Date.parse(`${row.first}:00Z`)) / 60000) + 1;
    return {
        percent: Number(Math.min(100, (row.n / expected) * 100).toFixed(2)),
        minutes_up: row.n,
        minutes_expected: expected,
        since: `${row.first}:00Z`
    };
}

module.exports = { startedAt, responseTimeMiddleware, responseStats, startHeartbeat, touchHeartbeat, recordHeartbeat, availability };
