// RF04 / HU03 — Manutenções preventivas e corretivas (agendadas, em andamento ou concluídas)
const { run } = require('../database/query');
const ErrorResponse = require('../utils/errorResponse');
const v = require('../utils/validators');
const { getOwned, vehicleLabel, isoToBr, lastOdometer, bumpOdometer } = require('../services/fleet.service');
const { queueCheck } = require('../services/notification.service');

const MANAGERS = ['admin', 'gestor'];
const FIELDS = ['vehicle_id', 'kind', 'scheduled_date', 'service', 'workshop', 'notes', 'cost', 'odometer', 'horimeter', 'date'];

module.exports = {
    table: 'maintenances',
    label: 'Manutenção',
    trash: true,
    orderBy: `CASE status WHEN 'in_progress' THEN 0 WHEN 'scheduled' THEN 1 ELSE 2 END, id DESC`,
    roles: { read: ['admin', 'gestor', 'financeiro'], create: MANAGERS, update: MANAGERS, delete: MANAGERS },
    describe: row => `${row.service} · ${row.vehicle}`,

    async build(body, current, ctx) {
        const m = { ...(current || {}), ...v.pickDefined(body, FIELDS) };
        if (current) m.vehicle_id = current.vehicle_id;

        const vehicle = await getOwned('vehicles', v.requireId(m.vehicle_id, 'Veículo'), ctx.companyId, 'Veículo');
        if (!m.kind) throw new ErrorResponse('Informe se a manutenção é preventiva ou corretiva.', 400);

        // A situação só é escolhida no cadastro; depois muda pelas ações iniciar/concluir/cancelar
        const status = current ? current.status : v.oneOf(body.status, ['scheduled', 'in_progress', 'completed'], 'Situação', 'completed');

        const data = {
            vehicle_id: vehicle.id,
            vehicle: vehicleLabel(vehicle),
            kind: v.oneOf(m.kind, ['preventiva', 'corretiva'], 'Tipo de manutenção'),
            service: v.requireText(m.service, 'Serviço', { max: 120 }),
            workshop: v.optionalText(m.workshop, 'Oficina', 120),
            notes: v.optionalText(m.notes, 'Descrição', 500),
            horimeter: v.requireNumber(m.horimeter, 'Horímetro', { min: 0, max: 1000000, required: false }) || 0
        };
        if (!current) data.status = status;

        if (status === 'scheduled') {
            // CA_HU03_1 — agendamento com data, tipo e veículo
            const scheduled = v.parseDateISO(m.scheduled_date, 'Data agendada', { allowPast: !!current });
            data.scheduled_date = scheduled;
            data.date = isoToBr(scheduled);
            data.cost = v.requireNumber(m.cost, 'Custo estimado', { min: 0, max: 10000000, required: false }) || 0;
            data.odometer = v.requireNumber(m.odometer, 'Quilometragem', { min: 0, max: 10000000, required: false }) || 0;
        } else {
            data.date = v.parseDateBR(m.date, 'Data do serviço');
            data.cost = v.requireNumber(m.cost, status === 'completed' ? 'Custo' : 'Custo estimado', {
                min: 0, max: 10000000, required: status === 'completed'
            }) || 0;
            data.odometer = v.requireNumber(m.odometer, 'Quilometragem', { min: 0, max: 10000000, required: false }) || 0;
            if (!current && status === 'completed') data.completed_at = new Date().toISOString();
            if (!current && data.odometer > 0) {
                const last = await lastOdometer(ctx.companyId, vehicle.id);
                if (data.odometer < last) {
                    throw new ErrorResponse(`Quilometragem inválida: não pode ser menor que a última registrada (${last.toLocaleString('pt-BR')} km).`, 400);
                }
            }
        }

        if (!current && status === 'in_progress' && vehicle.status === 'in_trip') {
            throw new ErrorResponse('O veículo está em viagem. Finalize a viagem antes de iniciar a manutenção.', 409);
        }

        return data;
    },

    async beforeDelete(current) {
        if (current.status === 'in_progress') {
            throw new ErrorResponse('Conclua ou cancele a manutenção em andamento antes de excluí-la.', 409);
        }
    },

    async afterWrite(action, row, ctx) {
        if (row.status === 'completed') await bumpOdometer(ctx.companyId, row.vehicle_id, row.odometer);
        if (action === 'create' && row.status === 'in_progress') {
            await run(`UPDATE vehicles SET status = 'maintenance' WHERE id = ? AND company_id = ?`, [row.vehicle_id, ctx.companyId]);
        }
        queueCheck(ctx.companyId);
    }
};
