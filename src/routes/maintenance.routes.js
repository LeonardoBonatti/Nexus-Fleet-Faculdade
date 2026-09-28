// RF04 / HU03 — Controle do ciclo da manutenção: agendada → em andamento → concluída
const express = require('express');
const router = express.Router();
const authRequired = require('../middlewares/auth.middleware');
const { authorize } = require('../middlewares/permission.middleware');
const ErrorResponse = require('../utils/errorResponse');
const { run } = require('../database/query');
const v = require('../utils/validators');
const { getOwned, lastOdometer, bumpOdometer, releaseVehicleFromMaintenance } = require('../services/fleet.service');
const { logAudit } = require('../services/audit.service');
const { queueCheck } = require('../services/notification.service');

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.use(authRequired, authorize('admin', 'gestor'));

router.post('/:id/start', asyncHandler(async (req, res) => {
    const maintenance = await getOwned('maintenances', req.params.id, req.companyId, 'Manutenção');
    if (maintenance.status !== 'scheduled') throw new ErrorResponse('Somente manutenções agendadas podem ser iniciadas.', 409);

    const vehicle = await getOwned('vehicles', maintenance.vehicle_id, req.companyId, 'Veículo');
    if (vehicle.status === 'in_trip') throw new ErrorResponse('O veículo está em viagem. Finalize a viagem antes de iniciar a manutenção.', 409);

    const today = v.formatBR(new Date());
    await run(`UPDATE maintenances SET status = 'in_progress', date = ? WHERE id = ?`, [today, maintenance.id]);
    await run(`UPDATE vehicles SET status = 'maintenance' WHERE id = ?`, [vehicle.id]);

    await logAudit(req, {
        action: 'update', entity: 'maintenances', entityId: maintenance.id, before: maintenance,
        after: { status: 'in_progress', date: today }, summary: `Manutenção iniciada: ${maintenance.service}`
    });
    res.json({ success: true, vehicle_status: 'maintenance' });
}));

// CA_HU03_3 — ao concluir, o veículo volta a ficar "Disponível"
router.post('/:id/complete', asyncHandler(async (req, res) => {
    const maintenance = await getOwned('maintenances', req.params.id, req.companyId, 'Manutenção');
    if (!['scheduled', 'in_progress'].includes(maintenance.status)) {
        throw new ErrorResponse('Esta manutenção já foi concluída ou cancelada.', 409);
    }
    const body = req.body || {};

    const update = {
        status: 'completed',
        date: v.parseDateBR(body.date, 'Data de conclusão'),
        cost: v.requireNumber(body.cost, 'Custo', { min: 0, max: 10000000 }),
        odometer: v.requireNumber(body.odometer, 'Quilometragem', { min: 0, max: 10000000, required: false }) || maintenance.odometer || 0,
        workshop: v.optionalText(body.workshop !== undefined ? body.workshop : maintenance.workshop, 'Oficina', 120),
        notes: v.optionalText(body.notes !== undefined ? body.notes : maintenance.notes, 'Descrição', 500),
        completed_at: new Date().toISOString()
    };

    if (update.odometer > 0) {
        const last = await lastOdometer(req.companyId, maintenance.vehicle_id);
        if (update.odometer < last) {
            throw new ErrorResponse(`Quilometragem inválida: não pode ser menor que a última registrada (${last.toLocaleString('pt-BR')} km).`, 400);
        }
    }

    await run(
        `UPDATE maintenances SET status = ?, date = ?, cost = ?, odometer = ?, workshop = ?, notes = ?, completed_at = ? WHERE id = ?`,
        [update.status, update.date, update.cost, update.odometer, update.workshop, update.notes, update.completed_at, maintenance.id]
    );
    await bumpOdometer(req.companyId, maintenance.vehicle_id, update.odometer);
    const vehicleStatus = await releaseVehicleFromMaintenance(req.companyId, maintenance.vehicle_id);

    await logAudit(req, {
        action: 'update', entity: 'maintenances', entityId: maintenance.id, before: maintenance, after: update,
        summary: `Manutenção concluída: ${maintenance.service}`
    });
    queueCheck(req.companyId);
    res.json({ success: true, vehicle_status: vehicleStatus });
}));

router.post('/:id/cancel', asyncHandler(async (req, res) => {
    const maintenance = await getOwned('maintenances', req.params.id, req.companyId, 'Manutenção');
    if (!['scheduled', 'in_progress'].includes(maintenance.status)) {
        throw new ErrorResponse('Somente manutenções agendadas ou em andamento podem ser canceladas.', 409);
    }
    await run(`UPDATE maintenances SET status = 'cancelled' WHERE id = ?`, [maintenance.id]);
    const vehicleStatus = await releaseVehicleFromMaintenance(req.companyId, maintenance.vehicle_id);

    await logAudit(req, {
        action: 'update', entity: 'maintenances', entityId: maintenance.id, before: maintenance,
        after: { status: 'cancelled' }, summary: `Manutenção cancelada: ${maintenance.service}`
    });
    queueCheck(req.companyId);
    res.json({ success: true, vehicle_status: vehicleStatus });
}));

module.exports = router;
