// RF09 — Multas vinculadas a veículo e motorista (motorista identificado pela viagem na data)
const { all } = require('../database/query');
const ErrorResponse = require('../utils/errorResponse');
const v = require('../utils/validators');
const { getOwned, findTripAt } = require('../services/fleet.service');
const { notify } = require('../services/notification.service');

const MANAGERS = ['admin', 'gestor'];
const SEVERITY_POINTS = { leve: 3, media: 4, grave: 5, gravissima: 7 };
const FIELDS = ['vehicle_id', 'driver_id', 'infraction_date', 'infraction_time', 'code', 'description', 'severity', 'amount', 'due_date', 'location', 'status', 'notes'];

module.exports = {
    table: 'fines',
    label: 'Multa',
    trash: true,
    orderBy: 'infraction_date DESC, id DESC',
    roles: { read: ['admin', 'gestor', 'financeiro', 'motorista'], create: MANAGERS, update: MANAGERS, delete: MANAGERS },
    scope: ctx => (ctx.role === 'motorista' ? { sql: 'AND driver_id = ?', params: [ctx.driverId || -1] } : null),
    describe: row => `Multa ${row.code || ''} · R$ ${Number(row.amount).toFixed(2)}`.replace('  ', ' '),

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
        const m = { ...(current || {}), ...v.pickDefined(body, FIELDS) };
        const vehicle = await getOwned('vehicles', v.requireId(m.vehicle_id, 'Veículo'), ctx.companyId, 'Veículo');

        const infractionDate = v.parseDateISO(m.infraction_date, 'Data da infração', { allowFuture: false });
        let infractionTime = null;
        if (m.infraction_time) {
            infractionTime = String(m.infraction_time).slice(0, 5);
            if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(infractionTime)) throw new ErrorResponse('Hora da infração inválida.', 400);
        }

        const severity = v.oneOf(m.severity, Object.keys(SEVERITY_POINTS), 'Gravidade', 'media');
        const status = v.oneOf(m.status, ['pending', 'paid', 'appealed', 'cancelled'], 'Situação', 'pending');

        const data = {
            vehicle_id: vehicle.id,
            infraction_date: infractionDate,
            infraction_time: infractionTime,
            code: v.optionalText(m.code, 'Código da infração', 20),
            description: v.requireText(m.description, 'Descrição da infração', { max: 255 }),
            severity,
            points: SEVERITY_POINTS[severity],
            amount: v.requireNumber(m.amount, 'Valor', { min: 0.01, max: 100000 }),
            due_date: v.parseDateISO(m.due_date, 'Vencimento', { required: false }),
            location: v.optionalText(m.location, 'Local', 255),
            status,
            paid_at: status === 'paid' ? ((current && current.paid_at) || v.formatISODate(new Date())) : null,
            notes: v.optionalText(m.notes, 'Observações', 500)
        };

        // Motorista responsável: informado manualmente ou identificado pela viagem na data/hora
        const manual = body.driver_id !== undefined && body.driver_id !== null && body.driver_id !== '';
        const keyChanged = !current
            || current.vehicle_id !== vehicle.id
            || current.infraction_date !== infractionDate
            || (current.infraction_time || null) !== infractionTime;

        if (manual) {
            const driver = await getOwned('drivers', v.requireId(body.driver_id, 'Motorista'), ctx.companyId, 'Motorista');
            const trip = await findTripAt(ctx.companyId, vehicle.id, infractionDate, infractionTime);
            data.driver_id = driver.id;
            data.trip_id = trip && trip.driver_id === driver.id ? trip.id : null;
            data.driver_auto = 0;
        } else if (current && !keyChanged && body.driver_id === undefined) {
            data.driver_id = current.driver_id;
            data.trip_id = current.trip_id;
            data.driver_auto = current.driver_auto;
        } else {
            const trip = await findTripAt(ctx.companyId, vehicle.id, infractionDate, infractionTime);
            data.driver_id = trip ? trip.driver_id : null;
            data.trip_id = trip ? trip.id : null;
            data.driver_auto = trip ? 1 : 0;
        }

        return data;
    },

    async afterWrite(action, row, ctx) {
        if (action !== 'create' || !row.driver_id) return;
        const driver = await getOwned('drivers', row.driver_id, ctx.companyId, 'Motorista').catch(() => null);
        if (driver && driver.linked_user_id) {
            await notify(ctx.companyId, {
                userId: driver.linked_user_id,
                type: 'fine',
                severity: 'warning',
                entity: 'fines',
                entityId: row.id,
                link: 'multas',
                title: 'Multa registrada em seu nome',
                message: `${row.description} em ${row.infraction_date.split('-').reverse().join('/')} — R$ ${Number(row.amount).toFixed(2)}.`,
                dedupeKey: `fine:${row.id}:user`
            });
        }
    }
};
