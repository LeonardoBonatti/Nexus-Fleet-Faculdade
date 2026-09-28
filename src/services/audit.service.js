// RNF05 — Histórico (log) de alterações nos cadastros
const { run } = require('../database/query');

const IGNORED_FIELDS = ['id', 'company_id', 'user_id', 'created_at'];
const SENSITIVE = /(_enc|_hash|password)/i;

// Retenção mínima de 12 meses (configurável, nunca abaixo de 12)
const RETENTION_MONTHS = Math.max(12, parseInt(process.env.AUDIT_RETENTION_MONTHS, 10) || 24);

function redact(field, value) {
    return SENSITIVE.test(field) ? '[protegido]' : value;
}

function snapshot(record) {
    if (!record) return null;
    const out = {};
    Object.entries(record).forEach(([k, v]) => {
        if (!IGNORED_FIELDS.includes(k) && v !== null && v !== undefined && v !== '') out[k] = redact(k, v);
    });
    return out;
}

function diff(before, after) {
    const changes = {};
    const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
    keys.forEach(k => {
        if (IGNORED_FIELDS.includes(k)) return;
        if (!after || !(k in after)) return; // campo não alterado nesta operação
        const from = before ? before[k] : null;
        const to = after[k];
        if (String(from ?? '') !== String(to ?? '')) {
            changes[k] = { from: redact(k, from ?? null), to: redact(k, to ?? null) };
        }
    });
    return changes;
}

/**
 * Registra uma ação no log. Nunca interrompe a requisição em caso de falha.
 * action: create | update | delete | restore | purge | start | finish | complete | cancel | login ...
 */
async function logAudit(req, { action, entity, entityId = null, before = null, after = null, summary = null }) {
    try {
        let changes;
        if (action === 'update') {
            changes = diff(before, after);
            if (!Object.keys(changes).length) return;
        } else {
            changes = snapshot(after || before);
        }
        await run(
            `INSERT INTO audit_logs (company_id, user_id, user_name, action, entity, entity_id, summary, changes, ip)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                req.user ? req.user.company_id : null,
                req.user ? req.user.id : null,
                req.user ? req.user.name : null,
                action,
                entity,
                entityId,
                summary,
                changes ? JSON.stringify(changes) : null,
                req.ip
            ]
        );
    } catch (err) {
        console.error('Falha ao registrar auditoria:', err.message);
    }
}

async function purgeOldAuditLogs() {
    const result = await run(`DELETE FROM audit_logs WHERE created_at < datetime('now', ?)`, [`-${RETENTION_MONTHS} months`]);
    if (result.changes) console.log(`🧹 ${result.changes} registro(s) de auditoria com mais de ${RETENTION_MONTHS} meses removidos.`);
}

module.exports = { logAudit, purgeOldAuditLogs, RETENTION_MONTHS };
