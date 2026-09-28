// RF08 — Relatório de custos por veículo (combustível, manutenção, pedágios e multas)
const express = require('express');
const router = express.Router();
const authRequired = require('../middlewares/auth.middleware');
const { authorize } = require('../middlewares/permission.middleware');
const ErrorResponse = require('../utils/errorResponse');
const { all } = require('../database/query');
const v = require('../utils/validators');

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const round = n => Math.round((n + Number.EPSILON) * 100) / 100;

router.use(authRequired, authorize('admin', 'gestor', 'financeiro'));

router.get('/costs', asyncHandler(async (req, res) => {
    const now = new Date();
    const defaultStart = v.formatISODate(new Date(now.getFullYear(), now.getMonth(), 1));
    const defaultEnd = v.formatISODate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
    const start = v.parseDateISO(req.query.start || defaultStart, 'Data inicial');
    const end = v.parseDateISO(req.query.end || defaultEnd, 'Data final');
    if (end < start) throw new ErrorResponse('A data final deve ser posterior à inicial.', 400);

    const vehicleId = req.query.vehicle_id ? v.requireId(req.query.vehicle_id, 'Veículo') : null;
    const inPeriod = value => {
        const date = v.toDate(value);
        if (!date) return false;
        const iso = v.formatISODate(date);
        return iso >= start && iso <= end;
    };

    const vehicles = await all(
        `SELECT id, plate, brand, model FROM vehicles WHERE company_id = ? ${vehicleId ? 'AND id = ?' : ''} ORDER BY plate`,
        vehicleId ? [req.companyId, vehicleId] : [req.companyId]
    );
    const ids = new Set(vehicles.map(x => x.id));
    const plates = Object.fromEntries(vehicles.map(x => [x.id, x.plate]));
    const mine = r => ids.has(r.vehicle_id);

    const fuels = (await all(
        `SELECT id, vehicle_id, date, fuel_type, liters, cost FROM fuels WHERE company_id = ?`, [req.companyId]
    )).filter(r => mine(r) && inPeriod(r.date));

    const maintenances = (await all(
        `SELECT id, vehicle_id, date, service, kind, cost FROM maintenances WHERE company_id = ? AND status = 'completed'`, [req.companyId]
    )).filter(r => mine(r) && inPeriod(r.date));

    const trips = (await all(
        `SELECT id, vehicle_id, actual_end, origin_name, destination_name, toll_cost, start_odometer, end_odometer
         FROM trips WHERE company_id = ? AND status = 'completed'`, [req.companyId]
    )).filter(r => mine(r) && inPeriod(r.actual_end));

    const fines = (await all(
        `SELECT id, vehicle_id, infraction_date, description, amount, status FROM fines WHERE company_id = ? AND status <> 'cancelled'`, [req.companyId]
    )).filter(r => mine(r) && inPeriod(r.infraction_date));

    const sum = (list, field, vid) => list.filter(r => r.vehicle_id === vid).reduce((a, r) => a + (Number(r[field]) || 0), 0);

    const rows = vehicles.map(vehicle => {
        const fuel = sum(fuels, 'cost', vehicle.id);
        const maintenance = sum(maintenances, 'cost', vehicle.id);
        const tolls = sum(trips, 'toll_cost', vehicle.id);
        const finesTotal = sum(fines, 'amount', vehicle.id);
        const km = trips.filter(t => t.vehicle_id === vehicle.id)
            .reduce((a, t) => a + Math.max(0, (t.end_odometer || 0) - (t.start_odometer || 0)), 0);
        const total = fuel + maintenance + tolls + finesTotal;
        return {
            vehicle_id: vehicle.id,
            plate: vehicle.plate,
            name: `${vehicle.brand} ${vehicle.model}`,
            fuel: round(fuel),
            maintenance: round(maintenance),
            tolls: round(tolls),
            fines: round(finesTotal),
            total: round(total),
            liters: round(sum(fuels, 'liters', vehicle.id)),
            km: round(km),
            cost_per_km: km > 0 ? round(total / km) : null
        };
    });

    const totals = ['fuel', 'maintenance', 'tolls', 'fines', 'total', 'liters', 'km']
        .reduce((acc, key) => ({ ...acc, [key]: round(rows.reduce((a, r) => a + r[key], 0)) }), {});

    res.json({
        period: { start, end },
        rows,
        totals,
        details: {
            fuels: fuels.map(r => ({ ...r, plate: plates[r.vehicle_id] })),
            maintenances: maintenances.map(r => ({ ...r, plate: plates[r.vehicle_id] })),
            tolls: trips.filter(t => t.toll_cost > 0).map(r => ({ ...r, plate: plates[r.vehicle_id] })),
            fines: fines.map(r => ({ ...r, plate: plates[r.vehicle_id] }))
        }
    });
}));

module.exports = router;
