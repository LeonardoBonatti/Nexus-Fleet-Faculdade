// RF05 / RF13 / HU03 — Notificações automáticas ao gestor
const { run, get, all } = require('../database/query');
const { toDate, daysBetween } = require('../utils/validators');
const { isoToBr } = require('./fleet.service');

const DOC_LABELS = {
    licenciamento: 'Licenciamento', seguro: 'Seguro', ipva: 'IPVA', tacografo: 'Tacógrafo', vistoria: 'Vistoria', outro: 'Documento'
};

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // verificação a cada hora (inclui a verificação diária exigida)

// Cria a notificação uma única vez por chave (evita duplicar o mesmo alerta)
async function notify(companyId, n) {
    await run(
        `INSERT OR IGNORE INTO notifications
            (company_id, user_id, type, severity, title, message, entity, entity_id, link_page, dedupe_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [companyId, n.userId || null, n.type, n.severity || 'info', n.title, n.message || null,
            n.entity || null, n.entityId || null, n.link || null, n.dedupeKey || null]
    );
}

function dueState(days, windowDays) {
    if (days < 0) return 'expired';
    if (days <= windowDays) return 'soon';
    return null;
}

async function checkDriverLicenses(companyId, today) {
    const drivers = await all(
        `SELECT id, name, cnh_expiry, linked_user_id FROM drivers WHERE company_id = ? AND status = 'active'`,
        [companyId]
    );
    for (const d of drivers) {
        const days = daysBetween(today, toDate(d.cnh_expiry));
        const state = dueState(days, 30);
        if (!state) continue;
        const expired = state === 'expired';
        const base = {
            type: 'cnh',
            severity: expired ? 'danger' : 'warning',
            entity: 'drivers',
            entityId: d.id,
            link: 'motoristas',
            title: expired ? `CNH vencida — ${d.name}` : `CNH vence em ${days} dia(s) — ${d.name}`,
            message: expired
                ? `A CNH venceu em ${isoToBr(d.cnh_expiry)}. O motorista não pode ser escalado para viagens.`
                : `A CNH vence em ${isoToBr(d.cnh_expiry)}. Providencie a renovação.`
        };
        const key = `cnh:${d.id}:${d.cnh_expiry}:${state}`;
        await notify(companyId, { ...base, dedupeKey: key });
        if (d.linked_user_id) await notify(companyId, { ...base, userId: d.linked_user_id, link: 'viagens', dedupeKey: `${key}:user` });
    }
}

async function checkVehicleDocuments(companyId, today) {
    const docs = await all(
        `SELECT d.id, d.doc_type, d.expiry_date, v.plate
         FROM vehicle_documents d JOIN vehicles v ON v.id = d.vehicle_id
         WHERE d.company_id = ?`,
        [companyId]
    );
    for (const d of docs) {
        const days = daysBetween(today, toDate(d.expiry_date));
        const state = dueState(days, 30);
        if (!state) continue;
        const label = DOC_LABELS[d.doc_type] || 'Documento';
        await notify(companyId, {
            type: 'document',
            severity: state === 'expired' ? 'danger' : 'warning',
            entity: 'documents',
            entityId: d.id,
            link: 'documentos',
            title: state === 'expired' ? `${label} vencido — ${d.plate}` : `${label} vence em ${days} dia(s) — ${d.plate}`,
            message: `Vencimento em ${isoToBr(d.expiry_date)}.`,
            dedupeKey: `doc:${d.id}:${d.expiry_date}:${state}`
        });
    }
}

// HU03 — alerta quando a manutenção agendada estiver a 3 dias (ou atrasada)
async function checkScheduledMaintenances(companyId, today) {
    const rows = await all(
        `SELECT m.id, m.service, m.scheduled_date, v.plate
         FROM maintenances m JOIN vehicles v ON v.id = m.vehicle_id
         WHERE m.company_id = ? AND m.status = 'scheduled' AND m.scheduled_date IS NOT NULL`,
        [companyId]
    );
    for (const m of rows) {
        const days = daysBetween(today, toDate(m.scheduled_date));
        const state = dueState(days, 3);
        if (!state) continue;
        const when = days === 0 ? 'hoje' : `em ${days} dia(s)`;
        await notify(companyId, {
            type: 'maintenance',
            severity: state === 'expired' ? 'danger' : 'warning',
            entity: 'maintenances',
            entityId: m.id,
            link: 'manutencao',
            title: state === 'expired' ? `Manutenção agendada atrasada — ${m.plate}` : `Manutenção ${when} — ${m.plate}`,
            message: `${m.service} agendada para ${isoToBr(m.scheduled_date)}.`,
            dedupeKey: `maint:${m.id}:${m.scheduled_date}:${state}`
        });
    }
}

// RF05 — revisão preventiva por quilometragem ou tempo decorrido
async function checkPreventiveMaintenance(companyId, today) {
    const vehicles = await all(`SELECT * FROM vehicles WHERE company_id = ? AND status <> 'inactive'`, [companyId]);
    for (const v of vehicles) {
        const scheduled = await get(
            `SELECT id FROM maintenances WHERE company_id = ? AND vehicle_id = ? AND kind = 'preventiva' AND status IN ('scheduled', 'in_progress') LIMIT 1`,
            [companyId, v.id]
        );
        if (scheduled) continue;

        const last = await get(
            `SELECT id, odometer, date FROM maintenances
             WHERE company_id = ? AND vehicle_id = ? AND kind = 'preventiva' AND status = 'completed'
             ORDER BY id DESC LIMIT 1`,
            [companyId, v.id]
        );

        let baseKm;
        let baseDate;
        if (last) {
            baseKm = last.odometer || 0;
            baseDate = toDate(last.date);
        } else {
            const first = await get(`SELECT MIN(odometer) AS m FROM fuels WHERE vehicle_id = ? AND odometer > 0`, [v.id]);
            baseKm = first && first.m ? first.m : (v.current_odometer || 0);
            baseDate = toDate(v.created_at);
        }

        const intervalKm = v.maintenance_interval_km || 10000;
        const intervalDays = v.maintenance_interval_days || 180;
        const kmSince = baseKm > 0 ? Math.max(0, (v.current_odometer || 0) - baseKm) : 0;
        const daysSince = baseDate ? Math.max(0, daysBetween(baseDate, today)) : 0;
        const remainingKm = intervalKm - kmSince;
        const remainingDays = intervalDays - daysSince;

        const due = remainingKm <= 0 || remainingDays <= 0;
        const soon = !due && (remainingKm <= intervalKm * 0.1 || remainingDays <= 15);
        if (!due && !soon) continue;

        const detail = `${Math.round(kmSince).toLocaleString('pt-BR')} km e ${daysSince} dia(s) desde a última revisão (intervalo: ${intervalKm.toLocaleString('pt-BR')} km ou ${intervalDays} dias).`;
        await notify(companyId, {
            type: 'preventive',
            severity: due ? 'danger' : 'warning',
            entity: 'vehicles',
            entityId: v.id,
            link: 'manutencao',
            title: due ? `Revisão preventiva vencida — ${v.plate}` : `Revisão preventiva próxima — ${v.plate}`,
            message: due
                ? `${detail} Agende a revisão.`
                : `${detail} Faltam ${Math.max(0, Math.round(remainingKm)).toLocaleString('pt-BR')} km ou ${Math.max(0, remainingDays)} dia(s).`,
            dedupeKey: `prev:${v.id}:${last ? last.id : 0}:${due ? 'due' : 'soon'}`
        });
    }
}

async function checkReminders(companyId, today) {
    const rows = await all(`SELECT id, title, date FROM reminders WHERE company_id = ? AND completed = 0`, [companyId]);
    for (const r of rows) {
        const days = daysBetween(today, toDate(r.date));
        const state = dueState(days, 7);
        if (!state) continue;
        await notify(companyId, {
            type: 'reminder',
            severity: state === 'expired' ? 'danger' : 'info',
            entity: 'reminders',
            entityId: r.id,
            link: 'agenda',
            title: state === 'expired' ? `Prazo vencido — ${r.title}` : `Prazo em ${days} dia(s) — ${r.title}`,
            message: `Data limite: ${isoToBr(r.date)}.`,
            dedupeKey: `rem:${r.id}:${r.date}:${state}`
        });
    }
}

// Reduzir gasto excessivo de combustível: consumo 20% abaixo da média do veículo
async function checkFuelAnomaly(companyId, fuel) {
    if (!fuel.km_per_liter) return;
    const previous = await all(
        `SELECT km_per_liter FROM fuels
         WHERE company_id = ? AND vehicle_id = ? AND km_per_liter IS NOT NULL AND id <> ?
         ORDER BY id DESC LIMIT 10`,
        [companyId, fuel.vehicle_id, fuel.id]
    );
    if (previous.length < 3) return;
    const avg = previous.reduce((a, r) => a + r.km_per_liter, 0) / previous.length;
    if (fuel.km_per_liter >= avg * 0.8) return;

    const drop = Math.round((1 - fuel.km_per_liter / avg) * 100);
    await notify(companyId, {
        type: 'fuel_anomaly',
        severity: 'warning',
        entity: 'fuels',
        entityId: fuel.id,
        link: 'abastecimento',
        title: `Consumo irregular — ${fuel.vehicle}`,
        message: `Abastecimento de ${fuel.date}: ${fuel.km_per_liter.toFixed(2)} km/L, ${drop}% abaixo da média do veículo (${avg.toFixed(2)} km/L). Verifique a condução ou possível problema mecânico.`,
        dedupeKey: `fuel-anomaly:${fuel.id}`
    });
}

async function checkCompany(companyId) {
    const today = new Date();
    await checkDriverLicenses(companyId, today);
    await checkVehicleDocuments(companyId, today);
    await checkScheduledMaintenances(companyId, today);
    await checkPreventiveMaintenance(companyId, today);
    await checkReminders(companyId, today);
}

async function runAllChecks() {
    const companies = await all(`SELECT id FROM companies`);
    for (const c of companies) {
        try {
            await checkCompany(c.id);
        } catch (err) {
            console.error(`Falha na verificação de alertas da empresa ${c.id}:`, err.message);
        }
    }
    // Limpeza: notificações lidas há mais de 90 dias e posições GPS antigas
    await run(`DELETE FROM notifications WHERE read_at IS NOT NULL AND read_at < datetime('now', '-90 days')`);
    await run(`DELETE FROM vehicle_positions WHERE recorded_at < datetime('now', '-90 days')`);
}

// Reexecuta a verificação logo após alterações relevantes.
// Em ambiente serverless a instância pode ser congelada assim que a resposta é
// enviada, então a verificação é disparada de imediato (sem timer) e apenas uma
// por empresa fica em execução ao mesmo tempo.
const running = new Map();
function queueCheck(companyId) {
    if (running.has(companyId)) return running.get(companyId);
    const task = checkCompany(companyId)
        .catch(err => console.error('Falha na verificação de alertas:', err.message))
        .finally(() => running.delete(companyId));
    running.set(companyId, task);
    return task;
}

function scheduleChecks() {
    runAllChecks().catch(err => console.error('Falha na verificação de alertas:', err.message));
    setInterval(() => runAllChecks().catch(err => console.error('Falha na verificação de alertas:', err.message)), CHECK_INTERVAL_MS).unref();
}

module.exports = { notify, checkCompany, runAllChecks, queueCheck, scheduleChecks, checkFuelAnomaly, DOC_LABELS };
