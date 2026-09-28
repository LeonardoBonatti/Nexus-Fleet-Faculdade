// RF03 / RF11 / RF12 — Execução da viagem: checklists, início, fim e trajeto
const express = require('express');
const router = express.Router();
const authRequired = require('../middlewares/auth.middleware');
const { authorize } = require('../middlewares/permission.middleware');
const ErrorResponse = require('../utils/errorResponse');
const { get, all, run, insertRow } = require('../database/query');
const v = require('../utils/validators');
const { getOwned, assertDriverFit, lastOdometer } = require('../services/fleet.service');
const { logAudit } = require('../services/audit.service');
const { notify, queueCheck } = require('../services/notification.service');

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const CHECKLIST_ITEMS = [
    { key: 'pneus', label: 'Pneus (calibragem e desgaste)' },
    { key: 'freios', label: 'Freios' },
    { key: 'luzes', label: 'Faróis, lanternas e setas' },
    { key: 'fluidos', label: 'Nível de óleo e fluidos' },
    { key: 'combustivel', label: 'Combustível suficiente' },
    { key: 'documentos', label: 'Documentos do veículo (CRLV)' },
    { key: 'seguranca', label: 'Itens de segurança (estepe, triângulo, macaco)' },
    { key: 'lataria', label: 'Lataria e vidros sem avarias' },
    { key: 'painel', label: 'Painel sem luzes de alerta' },
    { key: 'limpeza', label: 'Limpeza interna' }
];

router.use(authRequired);

async function loadTripFor(req, id) {
    const trip = await getOwned('trips', id, req.companyId, 'Viagem');
    if (req.user.role === 'motorista' && trip.driver_id !== req.user.driverId) {
        throw new ErrorResponse('Esta viagem não pertence a você.', 403);
    }
    return trip;
}

router.get('/checklist-template', (req, res) => res.json(CHECKLIST_ITEMS));

router.get('/:id/checklists', authorize('admin', 'gestor', 'financeiro', 'motorista'), asyncHandler(async (req, res) => {
    const trip = await loadTripFor(req, req.params.id);
    const rows = await all(`SELECT * FROM checklists WHERE trip_id = ? AND company_id = ? ORDER BY type DESC`, [trip.id, req.companyId]);
    res.json(rows.map(r => ({ ...r, items: JSON.parse(r.items || '[]'), has_issues: !!r.has_issues })));
}));

// RF12 — checklist de inspeção (saída = "pre", chegada = "post")
router.post('/:id/checklists', authorize('admin', 'gestor', 'motorista'), asyncHandler(async (req, res) => {
    const trip = await loadTripFor(req, req.params.id);
    const body = req.body || {};
    const type = v.oneOf(body.type, ['pre', 'post'], 'Tipo do checklist');

    if (type === 'pre' && trip.status !== 'planned') {
        throw new ErrorResponse('O checklist de saída deve ser preenchido antes de iniciar a viagem.', 409);
    }
    if (type === 'post' && trip.status !== 'in_progress') {
        throw new ErrorResponse('O checklist de chegada só pode ser preenchido com a viagem em andamento.', 409);
    }
    const existing = await get(`SELECT id FROM checklists WHERE trip_id = ? AND type = ?`, [trip.id, type]);
    if (existing) throw new ErrorResponse('Este checklist já foi registrado.', 409);

    const answers = Array.isArray(body.items) ? body.items : [];
    const items = CHECKLIST_ITEMS.map(template => {
        const answer = answers.find(a => a && a.key === template.key);
        if (!answer || typeof answer.ok !== 'boolean') {
            throw new ErrorResponse(`Responda o item "${template.label}".`, 400);
        }
        const note = v.optionalText(answer.note, `Observação de "${template.label}"`, 200);
        if (!answer.ok && !note) throw new ErrorResponse(`Descreva o problema encontrado em "${template.label}".`, 400);
        return { key: template.key, label: template.label, ok: answer.ok, note };
    });
    const failures = items.filter(i => !i.ok);

    const id = await insertRow('checklists', {
        company_id: req.companyId,
        trip_id: trip.id,
        vehicle_id: trip.vehicle_id,
        driver_id: trip.driver_id,
        user_id: req.user.id,
        user_name: req.user.name,
        type,
        items: JSON.stringify(items),
        has_issues: failures.length ? 1 : 0,
        odometer: v.requireNumber(body.odometer, 'Quilometragem', { min: 0, max: 10000000, required: false }),
        notes: v.optionalText(body.notes, 'Observações', 500)
    });

    if (failures.length) {
        await notify(req.companyId, {
            type: 'checklist',
            severity: 'warning',
            entity: 'trips',
            entityId: trip.id,
            link: 'viagens',
            title: `Checklist ${type === 'pre' ? 'de saída' : 'de chegada'} com pendências — viagem #${trip.id}`,
            message: failures.map(f => `${f.label}: ${f.note}`).join(' · '),
            dedupeKey: `checklist:${id}`
        });
    }

    const row = await get(`SELECT * FROM checklists WHERE id = ?`, [id]);
    await logAudit(req, { action: 'create', entity: 'checklists', entityId: id, after: row, summary: `Checklist ${type} da viagem #${trip.id}` });
    res.status(201).json({ success: true, id, created_at: row.created_at, has_issues: failures.length > 0 });
}));

// Início da viagem
router.post('/:id/start', authorize('admin', 'gestor', 'motorista'), asyncHandler(async (req, res) => {
    const trip = await loadTripFor(req, req.params.id);
    if (trip.status !== 'planned') throw new ErrorResponse('Somente viagens planejadas podem ser iniciadas.', 409);

    const pre = await get(`SELECT id FROM checklists WHERE trip_id = ? AND type = 'pre'`, [trip.id]);
    if (!pre) throw new ErrorResponse('Preencha o checklist de saída antes de iniciar a viagem.', 400);

    const vehicle = await getOwned('vehicles', trip.vehicle_id, req.companyId, 'Veículo');
    const driver = await getOwned('drivers', trip.driver_id, req.companyId, 'Motorista');
    assertDriverFit(driver, vehicle, v.formatISODate(new Date()));

    if (vehicle.status === 'maintenance') throw new ErrorResponse('O veículo está em manutenção.', 409);
    if (vehicle.status === 'inactive') throw new ErrorResponse('O veículo está inativo.', 409);
    if (vehicle.status === 'in_trip') throw new ErrorResponse('O veículo já está em outra viagem.', 409);
    const busy = await get(`SELECT id FROM trips WHERE company_id = ? AND driver_id = ? AND status = 'in_progress' AND id <> ?`, [req.companyId, driver.id, trip.id]);
    if (busy) throw new ErrorResponse(`O motorista já está na viagem #${busy.id}.`, 409);

    const startOdometer = v.requireNumber((req.body || {}).start_odometer, 'Quilometragem inicial', { min: 0, max: 10000000 });
    const last = await lastOdometer(req.companyId, vehicle.id);
    if (startOdometer < last) {
        throw new ErrorResponse(`Quilometragem inválida: a quilometragem inicial não pode ser menor que a atual do veículo (${last.toLocaleString('pt-BR')} km).`, 400);
    }

    const now = v.formatLocalDateTime(new Date());
    await run(`UPDATE trips SET status = 'in_progress', actual_start = ?, start_odometer = ? WHERE id = ?`, [now, startOdometer, trip.id]);
    await run(
        `UPDATE vehicles SET status = 'in_trip', current_odometer = GREATEST(COALESCE(current_odometer, 0), ?) WHERE id = ?`,
        [startOdometer, vehicle.id]
    );

    await logAudit(req, {
        action: 'update', entity: 'trips', entityId: trip.id, before: trip,
        after: { status: 'in_progress', actual_start: now, start_odometer: startOdometer },
        summary: `Viagem #${trip.id} iniciada`
    });
    res.json({ success: true });
}));

// Fim da viagem — HU02: quilometragem final maior que a inicial
router.post('/:id/finish', authorize('admin', 'gestor', 'motorista'), asyncHandler(async (req, res) => {
    const trip = await loadTripFor(req, req.params.id);
    const body = req.body || {};
    if (trip.status !== 'in_progress') throw new ErrorResponse('Somente viagens em andamento podem ser finalizadas.', 409);

    const post = await get(`SELECT id FROM checklists WHERE trip_id = ? AND type = 'post'`, [trip.id]);
    if (!post) throw new ErrorResponse('Preencha o checklist de chegada antes de finalizar a viagem.', 400);

    const endOdometer = v.requireNumber(body.end_odometer, 'Quilometragem final', { min: 0, max: 10000000 });
    if (endOdometer <= (trip.start_odometer || 0)) {
        throw new ErrorResponse(`Quilometragem inválida: a quilometragem final deve ser maior que a inicial (${(trip.start_odometer || 0).toLocaleString('pt-BR')} km).`, 400);
    }
    const tollCost = v.requireNumber(body.toll_cost, 'Pedágios', { min: 0, max: 100000, required: false });
    const notes = v.optionalText(body.notes, 'Observações', 1000);

    const now = v.formatLocalDateTime(new Date());
    const update = {
        status: 'completed',
        actual_end: now,
        end_odometer: endOdometer,
        toll_cost: tollCost !== null ? tollCost : (trip.toll_cost || 0)
    };
    if (notes) update.notes = notes;

    await run(
        `UPDATE trips SET status = ?, actual_end = ?, end_odometer = ?, toll_cost = ?, notes = COALESCE(?, notes) WHERE id = ?`,
        [update.status, update.actual_end, update.end_odometer, update.toll_cost, notes, trip.id]
    );
    await run(
        `UPDATE vehicles SET status = CASE WHEN status = 'in_trip' THEN 'available' ELSE status END,
                current_odometer = GREATEST(COALESCE(current_odometer, 0), ?)
         WHERE id = ?`,
        [endOdometer, trip.vehicle_id]
    );

    await logAudit(req, { action: 'update', entity: 'trips', entityId: trip.id, before: trip, after: update, summary: `Viagem #${trip.id} finalizada` });
    queueCheck(req.companyId);
    res.json({ success: true, distance_km: endOdometer - (trip.start_odometer || 0) });
}));

router.post('/:id/cancel', authorize('admin', 'gestor'), asyncHandler(async (req, res) => {
    const trip = await loadTripFor(req, req.params.id);
    if (trip.status !== 'planned') throw new ErrorResponse('Somente viagens planejadas podem ser canceladas.', 409);
    const reason = v.optionalText((req.body || {}).reason, 'Motivo', 500);
    await run(
        `UPDATE trips SET status = 'cancelled', notes = TRIM(COALESCE(notes, '') || CAST(? AS TEXT)) WHERE id = ?`,
        [reason ? ` [Cancelada: ${reason}]` : ' [Cancelada]', trip.id]
    );
    await logAudit(req, { action: 'update', entity: 'trips', entityId: trip.id, before: trip, after: { status: 'cancelled' }, summary: `Viagem #${trip.id} cancelada` });
    res.json({ success: true });
}));

// Trajeto registrado pelo GPS
router.get('/:id/positions', authorize('admin', 'gestor', 'motorista'), asyncHandler(async (req, res) => {
    const trip = await loadTripFor(req, req.params.id);
    const rows = await all(
        `SELECT lat, lng, speed, recorded_at FROM vehicle_positions WHERE trip_id = ? AND company_id = ? ORDER BY id ASC LIMIT 5000`,
        [trip.id, req.companyId]
    );
    res.json(rows);
}));

module.exports = router;
module.exports.CHECKLIST_ITEMS = CHECKLIST_ITEMS;
