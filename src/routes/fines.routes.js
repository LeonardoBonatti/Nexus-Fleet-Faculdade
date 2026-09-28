// RF09 — Sugestão do motorista responsável pela multa (viagem ativa na data/hora da infração)
const express = require('express');
const router = express.Router();
const authRequired = require('../middlewares/auth.middleware');
const { authorize } = require('../middlewares/permission.middleware');
const ErrorResponse = require('../utils/errorResponse');
const v = require('../utils/validators');
const { getOwned, findTripAt, formatDateTimeBr } = require('../services/fleet.service');

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.use(authRequired, authorize('admin', 'gestor'));

router.get('/suggest-driver', asyncHandler(async (req, res) => {
    const vehicle = await getOwned('vehicles', v.requireId(req.query.vehicle_id, 'Veículo'), req.companyId, 'Veículo');
    const date = v.parseDateISO(req.query.date, 'Data da infração');
    let time = null;
    if (req.query.time) {
        time = String(req.query.time).slice(0, 5);
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new ErrorResponse('Hora inválida.', 400);
    }

    const trip = await findTripAt(req.companyId, vehicle.id, date, time);
    if (!trip) return res.json({ driver_id: null });

    res.json({
        driver_id: trip.driver_id,
        driver_name: trip.driver_name,
        trip_id: trip.id,
        trip_label: `Viagem #${trip.id}: ${trip.origin_name} → ${trip.destination_name} (${formatDateTimeBr(trip.actual_start || trip.planned_start)})`
    });
}));

module.exports = router;
