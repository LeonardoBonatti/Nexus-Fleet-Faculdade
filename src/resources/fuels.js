// RF03 / RF06 / HU02 — Abastecimentos com quilometragem e consumo médio automático
const { get, all } = require('../database/query');
const ErrorResponse = require('../utils/errorResponse');
const v = require('../utils/validators');
const { getOwned, vehicleLabel, lastOdometer, lastFuelOdometer, bumpOdometer } = require('../services/fleet.service');
const { queueCheck, checkFuelAnomaly } = require('../services/notification.service');

const MANAGERS = ['admin', 'gestor'];
const FIELDS = ['vehicle_id', 'driver_id', 'trip_id', 'fuel_type', 'liters', 'price_per_liter', 'odometer', 'horimeter', 'date'];

module.exports = {
    table: 'fuels',
    label: 'Abastecimento',
    trash: true,
    orderBy: 'id DESC',
    roles: {
        read: ['admin', 'gestor', 'financeiro', 'motorista'],
        create: ['admin', 'gestor', 'motorista'],
        update: MANAGERS,
        delete: MANAGERS
    },
    scope: ctx => (ctx.role === 'motorista' ? { sql: 'AND driver_id = ?', params: [ctx.driverId || -1] } : null),
    describe: row => `${row.vehicle} · R$ ${Number(row.cost).toFixed(2)}`,

    async enrich(rows, ctx) {
        if (!rows.length) return rows;
        const drivers = await all(`SELECT id, name FROM drivers WHERE company_id = ?`, [ctx.companyId]);
        const names = Object.fromEntries(drivers.map(d => [d.id, d.name]));
        return rows.map(r => ({ ...r, driver_name: r.driver_id ? names[r.driver_id] || null : null }));
    },

    async build(body, current, ctx) {
        const m = { ...(current || {}), ...v.pickDefined(body, FIELDS) };
        if (current) m.vehicle_id = current.vehicle_id;

        const vehicle = await getOwned('vehicles', v.requireId(m.vehicle_id, 'Veículo'), ctx.companyId, 'Veículo');

        // Vínculo com motorista e viagem (CA_HU02_3)
        let driverId = null;
        let tripId = null;
        if (ctx.role === 'motorista') {
            if (!ctx.driverId) {
                throw new ErrorResponse('Seu usuário não está vinculado a um cadastro de motorista. Procure o gestor da frota.', 403);
            }
            driverId = ctx.driverId;
            const linked = await get(`SELECT 1 AS ok FROM driver_vehicles WHERE driver_id = ? AND vehicle_id = ?`, [driverId, vehicle.id]);
            const ownTrip = await get(
                `SELECT id FROM trips WHERE company_id = ? AND driver_id = ? AND vehicle_id = ? AND status IN ('planned', 'in_progress') LIMIT 1`,
                [ctx.companyId, driverId, vehicle.id]
            );
            if (!linked && !ownTrip) {
                throw new ErrorResponse('Você só pode registrar abastecimentos de veículos vinculados a você ou às suas viagens.', 403);
            }
        } else if (m.driver_id) {
            const driver = await getOwned('drivers', v.requireId(m.driver_id, 'Motorista'), ctx.companyId, 'Motorista');
            driverId = driver.id;
        }

        if (m.trip_id) {
            const trip = await getOwned('trips', v.requireId(m.trip_id, 'Viagem'), ctx.companyId, 'Viagem');
            if (trip.vehicle_id !== vehicle.id) throw new ErrorResponse('A viagem informada é de outro veículo.', 400);
            if (ctx.role === 'motorista' && trip.driver_id !== driverId) throw new ErrorResponse('Esta viagem não pertence a você.', 403);
            tripId = trip.id;
            if (!driverId) driverId = trip.driver_id;
        } else if (!current) {
            const active = await get(
                `SELECT id, driver_id FROM trips WHERE company_id = ? AND vehicle_id = ? AND status = 'in_progress' LIMIT 1`,
                [ctx.companyId, vehicle.id]
            );
            if (active) {
                tripId = active.id;
                if (!driverId) driverId = active.driver_id;
            }
        }

        // Combustível compatível com o veículo e volume dentro do tanque
        const allowed = v.COMPATIBLE_FUELS[vehicle.fuel_type] || v.FUEL_TYPES;
        const fuelType = v.oneOf(m.fuel_type, v.FUEL_TYPES, 'Tipo de combustível', allowed[0]);
        if (!allowed.includes(fuelType)) {
            throw new ErrorResponse(`${fuelType} não é compatível com o veículo ${vehicle.plate} (${vehicle.fuel_type}).`, 400);
        }
        const liters = v.requireNumber(m.liters, 'Volume abastecido', { min: 0.01, max: 10000 });
        const capacity = Number(vehicle.capacity) || 0;
        if (fuelType !== 'Eletricidade' && capacity > 0 && liters > capacity) {
            throw new ErrorResponse(`Volume (${liters}L) excede a capacidade do tanque (${capacity}L).`, 400);
        }
        const pricePerLiter = v.requireNumber(m.price_per_liter, 'Preço por litro', { min: 0.01, max: 100 });

        // RF03 — quilometragem obrigatória em novos registros (CA_HU02_2)
        const odometer = v.requireNumber(m.odometer, 'Quilometragem (hodômetro)', {
            min: current ? 0 : 1, max: 10000000, required: !current
        }) || 0;
        if (!current) {
            const lastFuel = await lastFuelOdometer(ctx.companyId, vehicle.id);
            const lastAny = await lastOdometer(ctx.companyId, vehicle.id);
            if (odometer <= lastFuel || odometer < lastAny) {
                throw new ErrorResponse(
                    `Quilometragem inválida: deve ser maior que a última registrada para o veículo (${Math.max(lastFuel, lastAny).toLocaleString('pt-BR')} km).`,
                    400
                );
            }
        }

        // CA_HU02_1 — consumo médio calculado automaticamente
        let kmPerLiter = current ? current.km_per_liter : null;
        const changed = !current || Number(current.odometer) !== odometer || Number(current.liters) !== liters;
        if (fuelType !== 'Eletricidade' && odometer > 0 && changed) {
            const previous = await get(
                `SELECT MAX(odometer) AS m FROM fuels WHERE company_id = ? AND vehicle_id = ? AND odometer > 0 AND odometer < ? AND id <> ?`,
                [ctx.companyId, vehicle.id, odometer, current ? current.id : -1]
            );
            kmPerLiter = previous && previous.m ? Math.round(((odometer - previous.m) / liters) * 100) / 100 : null;
        }

        return {
            vehicle_id: vehicle.id,
            vehicle: vehicleLabel(vehicle),
            driver_id: driverId,
            trip_id: tripId,
            fuel_type: fuelType,
            liters,
            price_per_liter: pricePerLiter,
            cost: Math.round(liters * pricePerLiter * 100) / 100,
            odometer,
            horimeter: v.requireNumber(m.horimeter, 'Horímetro', { min: 0, max: 1000000, required: false }) || 0,
            km_per_liter: kmPerLiter,
            date: v.parseDateBR(m.date, 'Data do abastecimento')
        };
    },

    async afterWrite(action, row, ctx) {
        await bumpOdometer(ctx.companyId, row.vehicle_id, row.odometer);
        if (action === 'create') await checkFuelAnomaly(ctx.companyId, row);
        queueCheck(ctx.companyId);
    }
};
