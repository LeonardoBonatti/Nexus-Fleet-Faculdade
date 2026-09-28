// RF10 / RF11 — Viagens: rota (origem, destino, paradas) e associação motorista × veículo
const { all, run } = require('../database/query');
const ErrorResponse = require('../utils/errorResponse');
const v = require('../utils/validators');
const { getOwned, assertDriverFit, formatDateTimeBr } = require('../services/fleet.service');

const MANAGERS = ['admin', 'gestor'];

function parseStops(raw) {
    let stops = raw;
    if (typeof stops === 'string') {
        try { stops = JSON.parse(stops || '[]'); } catch (e) { throw new ErrorResponse('Paradas inválidas.', 400); }
    }
    if (!stops) return [];
    if (!Array.isArray(stops)) throw new ErrorResponse('Paradas inválidas.', 400);
    if (stops.length > 10) throw new ErrorResponse('A rota pode ter no máximo 10 paradas.', 400);
    return stops.map((s, i) => ({
        name: v.requireText(s && s.name, `Parada ${i + 1}`, { max: 255 }),
        lat: v.requireNumber(s.lat, `Latitude da parada ${i + 1}`, { min: -90, max: 90, required: false }),
        lng: v.requireNumber(s.lng, `Longitude da parada ${i + 1}`, { min: -180, max: 180, required: false })
    }));
}

module.exports = {
    table: 'trips',
    label: 'Viagem',
    trash: false,
    orderBy: 'planned_start DESC',
    roles: { read: ['admin', 'gestor', 'financeiro', 'motorista'], create: MANAGERS, update: MANAGERS, delete: MANAGERS },
    scope: ctx => (ctx.role === 'motorista' ? { sql: 'AND driver_id = ?', params: [ctx.driverId || -1] } : null),
    describe: row => `Viagem #${row.id}: ${row.origin_name} → ${row.destination_name}`,

    async enrich(rows, ctx) {
        if (!rows.length) return rows;
        const vehicles = await all(`SELECT id, plate, brand, model, vehicle_type, current_odometer FROM vehicles WHERE company_id = ?`, [ctx.companyId]);
        const drivers = await all(`SELECT id, name FROM drivers WHERE company_id = ?`, [ctx.companyId]);
        const checklists = await all(`SELECT trip_id, type, has_issues FROM checklists WHERE company_id = ?`, [ctx.companyId]);
        const vMap = Object.fromEntries(vehicles.map(x => [x.id, x]));
        const dMap = Object.fromEntries(drivers.map(x => [x.id, x]));

        return rows.map(r => {
            const vehicle = vMap[r.vehicle_id];
            const lists = checklists.filter(c => c.trip_id === r.id);
            return {
                ...r,
                vehicle_plate: vehicle ? vehicle.plate : null,
                vehicle_name: vehicle ? `${vehicle.brand} ${vehicle.model}` : 'Veículo removido',
                vehicle_odometer: vehicle ? vehicle.current_odometer : null,
                driver_name: dMap[r.driver_id] ? dMap[r.driver_id].name : 'Motorista removido',
                has_pre_checklist: lists.some(c => c.type === 'pre'),
                has_post_checklist: lists.some(c => c.type === 'post'),
                checklist_issues: lists.some(c => c.has_issues)
            };
        });
    },

    present(row) {
        let stops = [];
        try { stops = JSON.parse(row.stops || '[]'); } catch (e) { stops = []; }
        return { ...row, stops };
    },

    async build(body, current, ctx) {
        // Viagens já iniciadas/encerradas: só observações e pedágios podem ser ajustados
        if (current && current.status !== 'planned') {
            const data = {};
            if (body.notes !== undefined) data.notes = v.optionalText(body.notes, 'Observações', 1000);
            if (body.toll_cost !== undefined && current.status === 'completed') {
                data.toll_cost = v.requireNumber(body.toll_cost, 'Pedágios', { min: 0, max: 100000, required: false }) || 0;
            }
            if (!Object.keys(data).length) {
                throw new ErrorResponse('Somente viagens planejadas podem ter rota, motorista, veículo ou horários alterados.', 409);
            }
            return data;
        }

        const fields = [
            'vehicle_id', 'driver_id', 'origin_name', 'origin_lat', 'origin_lng', 'destination_name', 'destination_lat',
            'destination_lng', 'stops', 'distance_km', 'duration_min', 'planned_start', 'planned_end', 'toll_cost', 'notes'
        ];
        const m = { ...(current || {}), ...v.pickDefined(body, fields) };

        const vehicle = await getOwned('vehicles', v.requireId(m.vehicle_id, 'Veículo'), ctx.companyId, 'Veículo');
        const driver = await getOwned('drivers', v.requireId(m.driver_id, 'Motorista'), ctx.companyId, 'Motorista');

        const plannedStart = v.parseDateTime(m.planned_start, 'Saída prevista');
        const plannedEnd = v.parseDateTime(m.planned_end, 'Chegada prevista');
        if (plannedEnd <= plannedStart) throw new ErrorResponse('A chegada prevista deve ser posterior à saída.', 400);
        if (!current && plannedEnd < v.formatLocalDateTime(new Date())) {
            throw new ErrorResponse('Não é possível planejar uma viagem que já terminou.', 400);
        }

        if (vehicle.status === 'inactive') throw new ErrorResponse(`O veículo ${vehicle.plate} está inativo.`, 409);
        if (vehicle.status === 'maintenance') {
            throw new ErrorResponse(`O veículo ${vehicle.plate} está em manutenção. Conclua a manutenção antes de escalar uma viagem.`, 409);
        }

        // Motorista habilitado, com CNH válida e categoria compatível
        assertDriverFit(driver, vehicle, plannedEnd.slice(0, 10));

        // Bloqueio de conflito de agenda (mesmo veículo ou motorista no mesmo período)
        const conflicts = await all(
            `SELECT id, vehicle_id, driver_id, planned_start, planned_end FROM trips
             WHERE company_id = ? AND id <> ? AND status IN ('planned', 'in_progress')
               AND (vehicle_id = ? OR driver_id = ?)
               AND planned_start < ? AND planned_end > ?`,
            [ctx.companyId, current ? current.id : -1, vehicle.id, driver.id, plannedEnd, plannedStart]
        );
        if (conflicts.length) {
            const c = conflicts[0];
            const who = c.vehicle_id === vehicle.id ? `o veículo ${vehicle.plate}` : `o motorista ${driver.name}`;
            throw new ErrorResponse(
                `Conflito de agenda: ${who} já está escalado na viagem #${c.id} (${formatDateTimeBr(c.planned_start)} a ${formatDateTimeBr(c.planned_end)}).`,
                409
            );
        }

        return {
            vehicle_id: vehicle.id,
            driver_id: driver.id,
            origin_name: v.requireText(m.origin_name, 'Origem', { max: 255 }),
            origin_lat: v.requireNumber(m.origin_lat, 'Latitude da origem', { min: -90, max: 90, required: false }),
            origin_lng: v.requireNumber(m.origin_lng, 'Longitude da origem', { min: -180, max: 180, required: false }),
            destination_name: v.requireText(m.destination_name, 'Destino', { max: 255 }),
            destination_lat: v.requireNumber(m.destination_lat, 'Latitude do destino', { min: -90, max: 90, required: false }),
            destination_lng: v.requireNumber(m.destination_lng, 'Longitude do destino', { min: -180, max: 180, required: false }),
            stops: JSON.stringify(parseStops(m.stops)),
            distance_km: v.requireNumber(m.distance_km, 'Distância', { min: 0, max: 100000, required: false }),
            duration_min: v.requireNumber(m.duration_min, 'Duração', { min: 0, max: 100000, required: false }),
            planned_start: plannedStart,
            planned_end: plannedEnd,
            toll_cost: v.requireNumber(m.toll_cost, 'Pedágios', { min: 0, max: 100000, required: false }) || 0,
            notes: v.optionalText(m.notes, 'Observações', 1000),
            status: current ? current.status : 'planned'
        };
    },

    async beforeDelete(current) {
        if (current.status === 'in_progress') {
            throw new ErrorResponse('Não é possível excluir uma viagem em andamento.', 409);
        }
    },

    async afterDelete(current) {
        await run(`DELETE FROM checklists WHERE trip_id = ?`, [current.id]);
        await run(`DELETE FROM vehicle_positions WHERE trip_id = ?`, [current.id]);
    }
};
