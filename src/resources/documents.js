// RF13 — Documentos do veículo (licenciamento, seguro...) com controle de vencimento
const { all } = require('../database/query');
const v = require('../utils/validators');
const { getOwned } = require('../services/fleet.service');
const { queueCheck, DOC_LABELS } = require('../services/notification.service');

const MANAGERS = ['admin', 'gestor'];
const DOC_TYPES = Object.keys(DOC_LABELS);

module.exports = {
    table: 'vehicle_documents',
    label: 'Documento',
    trash: false,
    orderBy: 'expiry_date ASC',
    roles: { read: ['admin', 'gestor', 'financeiro'], create: MANAGERS, update: MANAGERS, delete: MANAGERS },
    describe: row => `${DOC_LABELS[row.doc_type] || 'Documento'} · vence ${row.expiry_date}`,

    async enrich(rows, ctx) {
        if (!rows.length) return rows;
        const vehicles = await all(`SELECT id, plate, brand, model FROM vehicles WHERE company_id = ?`, [ctx.companyId]);
        const map = Object.fromEntries(vehicles.map(x => [x.id, x]));
        return rows.map(r => ({
            ...r,
            vehicle_plate: map[r.vehicle_id] ? map[r.vehicle_id].plate : null,
            vehicle_name: map[r.vehicle_id] ? `${map[r.vehicle_id].brand} ${map[r.vehicle_id].model}` : 'Veículo removido'
        }));
    },

    present(row) {
        const days = v.daysBetween(new Date(), v.toDate(row.expiry_date));
        return { ...row, days_to_expiry: days, doc_status: days < 0 ? 'expired' : days <= 30 ? 'expiring' : 'valid' };
    },

    async build(body, current, ctx) {
        const m = { ...(current || {}), ...v.pickDefined(body, ['vehicle_id', 'doc_type', 'number', 'issuer', 'expiry_date', 'cost', 'notes']) };
        const vehicle = await getOwned('vehicles', v.requireId(m.vehicle_id, 'Veículo'), ctx.companyId, 'Veículo');
        return {
            vehicle_id: vehicle.id,
            doc_type: v.oneOf(m.doc_type, DOC_TYPES, 'Tipo de documento'),
            number: v.optionalText(m.number, 'Número', 60),
            issuer: v.optionalText(m.issuer, 'Emissor / seguradora', 120),
            expiry_date: v.parseDateISO(m.expiry_date, 'Data de vencimento'),
            cost: v.requireNumber(m.cost, 'Custo', { min: 0, max: 1000000, required: false }) || 0,
            notes: v.optionalText(m.notes, 'Observações', 500)
        };
    },

    async afterWrite(action, row, ctx) {
        queueCheck(ctx.companyId);
    }
};
