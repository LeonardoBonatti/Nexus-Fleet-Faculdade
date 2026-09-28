// RF07 — Rastreamento em tempo real da localização dos veículos
const express = require('express');
const router = express.Router();
const authRequired = require('../middlewares/auth.middleware');
const { authorize } = require('../middlewares/permission.middleware');
const ErrorResponse = require('../utils/errorResponse');
const { get, all, run, insertRow } = require('../database/query');
const v = require('../utils/validators');
const { getOwned } = require('../services/fleet.service');

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const MIN_INTERVAL_MS = 3000;

// O banco grava os carimbos de tempo em UTC no formato "AAAA-MM-DD HH:MM:SS"
const utcToMs = value => (value ? Date.parse(`${String(value).replace(' ', 'T')}Z`) : null);

router.use(authRequired);

// Envio de posição: motorista (viagem em andamento) ou gestor (simulação/demonstração)
router.post('/positions', authorize('admin', 'gestor', 'motorista'), asyncHandler(async (req, res) => {
    const body = req.body || {};
    const lat = v.requireNumber(body.lat, 'Latitude', { min: -90, max: 90 });
    const lng = v.requireNumber(body.lng, 'Longitude', { min: -180, max: 180 });
    const speed = v.requireNumber(body.speed, 'Velocidade', { min: 0, max: 400, required: false });
    const accuracy = v.requireNumber(body.accuracy, 'Precisão', { min: 0, max: 100000, required: false });

    let trip = null;
    let vehicleId;

    if (req.user.role === 'motorista') {
        trip = await get(
            `SELECT * FROM trips WHERE company_id = ? AND driver_id = ? AND status = 'in_progress' ORDER BY id DESC LIMIT 1`,
            [req.companyId, req.user.driverId || -1]
        );
        if (!trip) throw new ErrorResponse('Você não possui viagem em andamento para compartilhar a localização.', 409);
        vehicleId = trip.vehicle_id;
    } else if (body.trip_id) {
        trip = await getOwned('trips', v.requireId(body.trip_id, 'Viagem'), req.companyId, 'Viagem');
        if (trip.status !== 'in_progress') throw new ErrorResponse('A viagem não está em andamento.', 409);
        vehicleId = trip.vehicle_id;
    } else {
        const vehicle = await getOwned('vehicles', v.requireId(body.vehicle_id, 'Veículo'), req.companyId, 'Veículo');
        vehicleId = vehicle.id;
        trip = await get(`SELECT * FROM trips WHERE company_id = ? AND vehicle_id = ? AND status = 'in_progress' LIMIT 1`, [req.companyId, vehicleId]);
    }

    // Evita gravar posições em excesso
    const last = await get(`SELECT recorded_at FROM vehicle_positions WHERE vehicle_id = ? ORDER BY id DESC LIMIT 1`, [vehicleId]);
    if (last && Date.now() - utcToMs(last.recorded_at) < MIN_INTERVAL_MS) {
        return res.json({ success: true, throttled: true });
    }

    await insertRow('vehicle_positions', {
        company_id: req.companyId,
        vehicle_id: vehicleId,
        trip_id: trip ? trip.id : null,
        driver_id: trip ? trip.driver_id : null,
        lat, lng, speed, accuracy
    });
    await run(
        `UPDATE vehicles SET last_lat = ?, last_lng = ?, last_speed = ?, last_position_at = datetime('now') WHERE id = ?`,
        [lat, lng, speed, vehicleId]
    );
    res.status(201).json({ success: true });
}));

// Painel de rastreamento (atualizado pelo frontend a cada 10 segundos)
router.get('/live', authorize('admin', 'gestor'), asyncHandler(async (req, res) => {
    const vehicles = await all(
        `SELECT id, plate, brand, model, vehicle_type, status, current_odometer, last_lat, last_lng, last_speed, last_position_at
         FROM vehicles WHERE company_id = ? ORDER BY plate`,
        [req.companyId]
    );
    const trips = await all(
        `SELECT t.id, t.vehicle_id, t.origin_name, t.destination_name, t.planned_end, t.actual_start,
                t.origin_lat, t.origin_lng, t.destination_lat, t.destination_lng, t.stops, d.name AS driver_name
         FROM trips t LEFT JOIN drivers d ON d.id = t.driver_id
         WHERE t.company_id = ? AND t.status = 'in_progress'`,
        [req.companyId]
    );

    const now = Date.now();
    res.json({
        server_time: new Date().toISOString(),
        vehicles: vehicles.map(vehicle => {
            const trip = trips.find(t => t.vehicle_id === vehicle.id) || null;
            if (trip) {
                try { trip.stops = JSON.parse(trip.stops || '[]'); } catch (e) { trip.stops = []; }
            }
            const updatedMs = utcToMs(vehicle.last_position_at);
            return {
                ...vehicle,
                last_position_at: updatedMs ? new Date(updatedMs).toISOString() : null,
                seconds_since_update: updatedMs ? Math.max(0, Math.round((now - updatedMs) / 1000)) : null,
                trip
            };
        })
    });
}));

router.get('/vehicles/:id/path', authorize('admin', 'gestor'), asyncHandler(async (req, res) => {
    const vehicle = await getOwned('vehicles', req.params.id, req.companyId, 'Veículo');
    const minutes = Math.min(1440, Math.max(5, parseInt(req.query.minutes, 10) || 180));
    const rows = await all(
        `SELECT lat, lng, speed, recorded_at FROM vehicle_positions
         WHERE vehicle_id = ? AND recorded_at >= datetime('now', ?) ORDER BY id ASC LIMIT 5000`,
        [vehicle.id, `-${minutes} minutes`]
    );
    res.json(rows);
}));

module.exports = router;
