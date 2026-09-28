// RF02 — Cadastro de motoristas (CPF e CNH criptografados — RNF03)
const { get, all, run } = require('../database/query');
const ErrorResponse = require('../utils/errorResponse');
const v = require('../utils/validators');
const { encrypt, decrypt, blindIndex, onlyDigits, maskCpf, maskCnh, formatCpf } = require('../utils/crypto');
const { queueCheck } = require('../services/notification.service');

const MANAGERS = ['admin', 'gestor'];
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function cnhSituation(expiry) {
    const days = v.daysBetween(new Date(), v.toDate(expiry));
    return {
        days_to_expiry: days,
        cnh_status: days < 0 ? 'expired' : days <= 30 ? 'expiring' : 'valid'
    };
}

module.exports = {
    table: 'drivers',
    label: 'Motorista',
    trash: true,
    orderBy: 'name COLLATE NOCASE ASC',
    roles: { read: ['admin', 'gestor', 'financeiro', 'motorista'], create: MANAGERS, update: MANAGERS, delete: MANAGERS },
    scope: ctx => (ctx.role === 'motorista' ? { sql: 'AND id = ?', params: [ctx.driverId || -1] } : null),
    describe: row => row.name,

    async enrich(rows, ctx) {
        if (!rows.length) return rows;
        const links = await all(
            `SELECT dv.driver_id, dv.vehicle_id, ve.plate
             FROM driver_vehicles dv JOIN vehicles ve ON ve.id = dv.vehicle_id
             WHERE ve.company_id = ?`,
            [ctx.companyId]
        );
        const users = await all(`SELECT id, email FROM users WHERE company_id = ?`, [ctx.companyId]);
        const emails = Object.fromEntries(users.map(u => [u.id, u.email]));

        return rows.map(r => {
            const mine = links.filter(l => l.driver_id === r.id);
            return {
                ...r,
                vehicle_ids: mine.map(l => l.vehicle_id),
                vehicle_plates: mine.map(l => l.plate),
                linked_user_email: r.linked_user_id ? emails[r.linked_user_id] || null : null
            };
        });
    },

    // Nunca envia os valores criptografados; CPF/CNH completos só sob demanda para gestores
    present(row, ctx, opts = {}) {
        const { cpf_enc, cpf_hash, cnh_enc, cnh_hash, ...safe } = row;
        const out = {
            ...safe,
            cpf_masked: maskCpf(row.cpf_last),
            cnh_masked: maskCnh(row.cnh_last),
            ...cnhSituation(row.cnh_expiry)
        };
        if (opts.reveal && ['admin', 'gestor'].includes(ctx.role)) {
            out.cpf = formatCpf(decrypt(cpf_enc));
            out.cnh_number = decrypt(cnh_enc);
        }
        return out;
    },

    async build(body, current, ctx) {
        const m = { ...(current || {}), ...v.pickDefined(body, ['name', 'cnh_category', 'cnh_expiry', 'phone', 'email', 'status', 'linked_user_id']) };
        const excludeId = current ? current.id : -1;

        const data = {
            name: v.requireText(m.name, 'Nome', { min: 3, max: 120 }),
            cnh_category: v.oneOf(String(m.cnh_category || '').toUpperCase(), v.CNH_CATEGORIES, 'Categoria da CNH'),
            cnh_expiry: v.parseDateISO(m.cnh_expiry, 'Validade da CNH'),
            phone: v.optionalText(m.phone, 'Telefone', 20),
            email: v.optionalText(m.email, 'E-mail', 120),
            status: v.oneOf(m.status, ['active', 'inactive'], 'Status', 'active')
        };
        if (data.email && !EMAIL_REGEX.test(data.email)) throw new ErrorResponse('E-mail inválido.', 400);

        // CPF (obrigatório no cadastro; na edição só é alterado se informado)
        const cpf = onlyDigits(body.cpf);
        if (cpf || !current) {
            if (!v.isValidCPF(cpf)) throw new ErrorResponse('CPF inválido.', 400);
            const hash = blindIndex(`cpf:${cpf}`);
            const dup = await get(`SELECT id FROM drivers WHERE company_id = ? AND cpf_hash = ? AND id <> ?`, [ctx.companyId, hash, excludeId]);
            if (dup) throw new ErrorResponse('CPF já cadastrado para outro motorista.', 409);
            Object.assign(data, { cpf_enc: encrypt(cpf), cpf_hash: hash, cpf_last: cpf.slice(-4) });
        }

        // Número da CNH
        const cnh = onlyDigits(body.cnh_number);
        if (cnh || !current) {
            if (!v.isValidCNH(cnh)) throw new ErrorResponse('Número da CNH inválido (11 dígitos).', 400);
            const hash = blindIndex(`cnh:${cnh}`);
            const dup = await get(`SELECT id FROM drivers WHERE company_id = ? AND cnh_hash = ? AND id <> ?`, [ctx.companyId, hash, excludeId]);
            if (dup) throw new ErrorResponse('CNH já cadastrada para outro motorista.', 409);
            Object.assign(data, { cnh_enc: encrypt(cnh), cnh_hash: hash, cnh_last: cnh.slice(-4) });
        }

        // Vínculo com a conta de acesso (perfil Motorista)
        if (m.linked_user_id !== undefined && m.linked_user_id !== null && m.linked_user_id !== '') {
            const userId = v.requireId(m.linked_user_id, 'Usuário');
            const user = await get(`SELECT id, role FROM users WHERE id = ? AND company_id = ?`, [userId, ctx.companyId]);
            if (!user || user.role !== 'motorista') throw new ErrorResponse('O usuário vinculado deve ter o perfil Motorista.', 400);
            const taken = await get(`SELECT id FROM drivers WHERE linked_user_id = ? AND company_id = ? AND id <> ?`, [userId, ctx.companyId, excludeId]);
            if (taken) throw new ErrorResponse('Este usuário já está vinculado a outro motorista.', 409);
            data.linked_user_id = userId;
        } else {
            data.linked_user_id = null;
        }

        // Veículos que o motorista pode conduzir
        if (body.vehicle_ids !== undefined) {
            const raw = Array.isArray(body.vehicle_ids) ? body.vehicle_ids : String(body.vehicle_ids).split(',');
            const ids = [...new Set(raw.map(Number).filter(n => Number.isInteger(n) && n > 0))];
            if (ids.length) {
                const found = await all(
                    `SELECT id FROM vehicles WHERE company_id = ? AND id IN (${ids.map(() => '?').join(',')})`,
                    [ctx.companyId, ...ids]
                );
                if (found.length !== ids.length) throw new ErrorResponse('Veículo vinculado inválido.', 400);
            }
            data._vehicle_ids = ids;
        }

        if (current && current.status === 'active' && data.status === 'inactive') {
            const active = await get(`SELECT id FROM trips WHERE company_id = ? AND driver_id = ? AND status = 'in_progress'`, [ctx.companyId, current.id]);
            if (active) throw new ErrorResponse('O motorista está em viagem. Finalize-a antes de inativá-lo.', 409);
        }

        return data;
    },

    async afterWrite(action, row, ctx, extras) {
        if (extras && extras._vehicle_ids) {
            await run(`DELETE FROM driver_vehicles WHERE driver_id = ?`, [row.id]);
            for (const vehicleId of extras._vehicle_ids) {
                await run(`INSERT OR IGNORE INTO driver_vehicles (driver_id, vehicle_id) VALUES (?, ?)`, [row.id, vehicleId]);
            }
        }
        queueCheck(ctx.companyId);
    },

    async beforeDelete(current, ctx) {
        const trips = await get(
            `SELECT COUNT(*) AS n FROM trips WHERE company_id = ? AND driver_id = ? AND status IN ('planned', 'in_progress')`,
            [ctx.companyId, current.id]
        );
        if (trips.n) throw new ErrorResponse(`O motorista possui ${trips.n} viagem(ns) planejada(s) ou em andamento.`, 409);
    },

    async afterDelete(current) {
        await run(`DELETE FROM driver_vehicles WHERE driver_id = ?`, [current.id]);
    }
};
