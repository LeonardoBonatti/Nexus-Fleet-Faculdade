// Ocorrências reportadas pelos motoristas (avarias, panes, acidentes...)
const { get, all } = require('../database/query');
const ErrorResponse = require('../utils/errorResponse');
const v = require('../utils/validators');
const { getOwned } = require('../services/fleet.service');
const { notify } = require('../services/notification.service');

const MANAGERS = ['admin', 'gestor'];
const TYPES = { avaria: 'Avaria', acidente: 'Acidente', pane: 'Pane mecânica', roubo: 'Roubo / furto', outro: 'Outro' };
const SEVERITIES = ['baixa', 'media', 'alta'];

module.exports = {
    table: 'occurrences',
    label: 'Ocorrência',
    trash: false,
    orderBy: `CASE status WHEN 'open' THEN 0 ELSE 1 END, occurred_at DESC`,
    roles: {
        read: ['admin', 'gestor', 'motorista'],
        create: ['admin', 'gestor', 'motorista'],
        update: MANAGERS,
        delete: MANAGERS
    },
    scope: ctx => (ctx.role === 'motorista' ? { sql: 'AND driver_id = ?', params: [ctx.driverId || -1] } : null),
    describe: row => `${TYPES[row.type] || row.type}: ${String(row.description).slice(0, 60)}`,

    async enrich(rows, ctx) {
        if (!rows.length) return rows;
        const vehicles = await all(`SELECT id, plate, brand, model FROM vehicles WHERE company_id = ?`, [ctx.companyId]);
        const drivers = await all(`SELECT id, name FROM drivers WHERE company_id = ?`, [ctx.companyId]);
        const vMap = Object.fromEntries(vehicles.map(x => [x.id, x]));
        const dMap = Object.fromEntries(drivers.map(x => [x.id, x.name]));
        return rows.map(r => ({
            ...r,
            vehicle_plate: vMap[r.vehicle_id] ? vMap[r.vehicle_id].plate : null,
            vehicle_name: vMap[r.vehicle_id] ? `${vMap[r.vehicle_id].brand} ${vMap[r.vehicle_id].model}` : 'Veículo removido',
            driver_name: r.driver_id ? dMap[r.driver_id] || null : null
        }));
    },

    async build(body, current, ctx) {
        // Gestor tratando a ocorrência
        if (current) {
            const m = { ...current, ...v.pickDefined(body, ['type', 'severity', 'description', 'status', 'resolution']) };
            const status = v.oneOf(m.status, ['open', 'resolved'], 'Situação', 'open');
            return {
                type: v.oneOf(m.type, Object.keys(TYPES), 'Tipo'),
                severity: v.oneOf(m.severity, SEVERITIES, 'Gravidade', 'media'),
                description: v.requireText(m.description, 'Descrição', { min: 5, max: 1000 }),
                status,
                resolution: v.optionalText(m.resolution, 'Solução', 1000),
                resolved_at: status === 'resolved' ? (current.resolved_at || new Date().toISOString()) : null
            };
        }

        const vehicle = await getOwned('vehicles', v.requireId(body.vehicle_id, 'Veículo'), ctx.companyId, 'Veículo');

        let driverId = null;
        if (ctx.role === 'motorista') {
            if (!ctx.driverId) throw new ErrorResponse('Seu usuário não está vinculado a um cadastro de motorista.', 403);
            driverId = ctx.driverId;
        } else if (body.driver_id) {
            driverId = (await getOwned('drivers', v.requireId(body.driver_id, 'Motorista'), ctx.companyId, 'Motorista')).id;
        }

        let tripId = null;
        if (body.trip_id) {
            const trip = await getOwned('trips', v.requireId(body.trip_id, 'Viagem'), ctx.companyId, 'Viagem');
            if (trip.vehicle_id !== vehicle.id) throw new ErrorResponse('A viagem informada é de outro veículo.', 400);
            if (ctx.role === 'motorista' && trip.driver_id !== driverId) throw new ErrorResponse('Esta viagem não pertence a você.', 403);
            tripId = trip.id;
        } else {
            const active = await get(`SELECT id FROM trips WHERE company_id = ? AND vehicle_id = ? AND status = 'in_progress' LIMIT 1`, [ctx.companyId, vehicle.id]);
            tripId = active ? active.id : null;
        }

        const now = v.formatLocalDateTime(new Date());
        const occurredAt = body.occurred_at ? v.parseDateTime(body.occurred_at, 'Data e hora da ocorrência') : now;
        if (occurredAt > now) throw new ErrorResponse('A data da ocorrência não pode estar no futuro.', 400);

        return {
            vehicle_id: vehicle.id,
            driver_id: driverId,
            trip_id: tripId,
            user_name: ctx.user.name,
            type: v.oneOf(body.type, Object.keys(TYPES), 'Tipo de ocorrência'),
            severity: v.oneOf(body.severity, SEVERITIES, 'Gravidade', 'media'),
            description: v.requireText(body.description, 'Descrição', { min: 5, max: 1000 }),
            occurred_at: occurredAt,
            status: 'open'
        };
    },

    async afterWrite(action, row, ctx) {
        if (action !== 'create') return;
        const vehicle = await get(`SELECT plate FROM vehicles WHERE id = ?`, [row.vehicle_id]);
        await notify(ctx.companyId, {
            type: 'occurrence',
            severity: row.severity === 'alta' ? 'danger' : 'warning',
            entity: 'occurrences',
            entityId: row.id,
            link: 'ocorrencias',
            title: `${TYPES[row.type] || 'Ocorrência'} — ${vehicle ? vehicle.plate : ''}`,
            message: `${row.user_name}: ${String(row.description).slice(0, 160)}`,
            dedupeKey: `occ:${row.id}`
        });
    }
};
