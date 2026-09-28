// Agregador de todas as rotas da API (/api/...)
const express = require('express');
const router = express.Router();
const authRequired = require('../middlewares/auth.middleware');
const { getOwned, lastOdometer } = require('../services/fleet.service');
const { get } = require('../database/query');

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get('/status', (req, res) => {
    res.json({ success: true, message: 'NexusFleet API em execução.', version: '2.0.0' });
});

router.use('/users', require('./user.routes'));
router.use('/data', require('./data.routes'));
router.use('/trash', require('./trash.routes'));
router.use('/trips', require('./trips.routes'));
router.use('/maintenances', require('./maintenance.routes'));
router.use('/fines', require('./fines.routes'));
router.use('/tracking', require('./tracking.routes'));
router.use('/notifications', require('./notifications.routes'));
router.use('/reports', require('./reports.routes'));
router.use('/team', require('./team.routes'));
router.use('/audit', require('./audit.routes'));
router.use('/system', require('./system.routes'));
router.use('/cron', require('./cron.routes'));

// Última quilometragem/horímetro conhecidos do veículo (usado nos formulários)
router.get('/vehicles/:id/last-readings', authRequired, asyncHandler(async (req, res) => {
    const vehicle = await getOwned('vehicles', req.params.id, req.companyId, 'Veículo');
    const odometer = await lastOdometer(req.companyId, vehicle.id);
    const f = await get(`SELECT MAX(horimeter) AS h FROM fuels WHERE vehicle_id = ? AND company_id = ?`, [vehicle.id, req.companyId]);
    const m = await get(`SELECT MAX(horimeter) AS h FROM maintenances WHERE vehicle_id = ? AND company_id = ?`, [vehicle.id, req.companyId]);
    res.json({ last_odometer: odometer, last_horimeter: Math.max((f && f.h) || 0, (m && m.h) || 0) });
}));

module.exports = router;
