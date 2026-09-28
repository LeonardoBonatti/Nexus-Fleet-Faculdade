// RF01 — Cadastro de veículos
const { get, run } = require('../database/query');
const ErrorResponse = require('../utils/errorResponse');
const v = require('../utils/validators');
const { vehicleLabel } = require('../services/fleet.service');
const { queueCheck } = require('../services/notification.service');

const MANAGERS = ['admin', 'gestor'];
const ALL = ['admin', 'gestor', 'motorista', 'financeiro'];

const FIELDS = [
    'plate', 'model', 'brand', 'year', 'vehicle_type', 'load_capacity_kg', 'fuel_type', 'capacity',
    'status', 'current_odometer', 'maintenance_interval_km', 'maintenance_interval_days'
];

module.exports = {
    table: 'vehicles',
    label: 'Veículo',
    trash: true,
    orderBy: 'plate ASC',
    roles: { read: ALL, create: MANAGERS, update: MANAGERS, delete: MANAGERS },
    describe: row => vehicleLabel(row),

    async build(body, current, ctx) {
        const m = { ...(current || {}), ...v.pickDefined(body, FIELDS) };

        // UC01 — validação de placa (formato e duplicidade)
        const plate = v.normalizePlate(m.plate);
        if (!plate) throw new ErrorResponse('Placa é obrigatória.', 400);
        if (!v.isValidPlate(plate)) {
            throw new ErrorResponse('Placa inválida. Use o padrão Mercosul (ABC1D23) ou antigo (ABC1234).', 400);
        }
        const duplicate = await get(
            `SELECT id FROM vehicles WHERE company_id = ? AND plate = ? AND id <> ?`,
            [ctx.companyId, plate, current ? current.id : -1]
        );
        if (duplicate) throw new ErrorResponse('Placa já cadastrada.', 409);

        if (!m.vehicle_type) throw new ErrorResponse('Tipo do veículo é obrigatório.', 400);
        const vehicleType = v.oneOf(m.vehicle_type, v.VEHICLE_TYPES, 'Tipo do veículo');

        // "Em viagem" é controlado pelo sistema (início/fim de viagem)
        const status = v.oneOf(m.status, v.VEHICLE_STATUS, 'Status', 'available');
        const previousStatus = current ? current.status : null;
        if (status === 'in_trip' && previousStatus !== 'in_trip') {
            throw new ErrorResponse('O status "Em viagem" é definido automaticamente ao iniciar uma viagem.', 400);
        }
        if (previousStatus === 'in_trip' && status !== 'in_trip') {
            throw new ErrorResponse('Finalize a viagem em andamento antes de alterar o status do veículo.', 409);
        }

        return {
            plate,
            model: v.requireText(m.model, 'Modelo', { max: 80 }),
            brand: v.requireText(m.brand, 'Marca', { max: 60 }),
            year: v.requireNumber(m.year, 'Ano', { min: 1950, max: new Date().getFullYear() + 1, integer: true }),
            vehicle_type: vehicleType,
            load_capacity_kg: v.requireNumber(m.load_capacity_kg, 'Capacidade de carga', { min: 0, max: 100000 }),
            fuel_type: v.oneOf(m.fuel_type, v.VEHICLE_FUEL_TYPES, 'Combustível', 'Flex'),
            capacity: v.requireNumber(m.capacity, 'Capacidade do tanque', { min: 1, max: 2000 }),
            current_odometer: v.requireNumber(m.current_odometer, 'Quilometragem atual', { min: 0, max: 10000000, required: false }) || 0,
            status,
            maintenance_interval_km: v.requireNumber(m.maintenance_interval_km, 'Intervalo de revisão (km)', { min: 500, max: 200000, required: false }) || 10000,
            maintenance_interval_days: v.requireNumber(m.maintenance_interval_days, 'Intervalo de revisão (dias)', { min: 7, max: 1095, required: false, integer: true }) || 180
        };
    },

    async beforeDelete(current, ctx) {
        if (current.status === 'in_trip') {
            throw new ErrorResponse('Não é possível excluir um veículo em viagem.', 409);
        }
        const planned = await get(
            `SELECT COUNT(*) AS n FROM trips WHERE company_id = ? AND vehicle_id = ? AND status = 'planned'`,
            [ctx.companyId, current.id]
        );
        if (planned.n) {
            throw new ErrorResponse(`O veículo possui ${planned.n} viagem(ns) planejada(s). Cancele-as antes de excluir.`, 409);
        }
    },

    async afterWrite(action, row, ctx) {
        if (action === 'update') {
            // Mantém o nome do veículo sincronizado nos lançamentos
            const label = vehicleLabel(row);
            await run(`UPDATE fuels SET vehicle = ? WHERE vehicle_id = ? AND company_id = ?`, [label, row.id, ctx.companyId]);
            await run(`UPDATE maintenances SET vehicle = ? WHERE vehicle_id = ? AND company_id = ?`, [label, row.id, ctx.companyId]);
        }
        queueCheck(ctx.companyId);
    }
};
