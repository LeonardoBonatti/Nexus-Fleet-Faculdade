// =========================================================================
// NexusFleet — Componentes compartilhados e cadastros básicos
// (veículos, abastecimentos, manutenções e lixeira)
// =========================================================================

const STATUS_LABELS = {
    available: 'Disponível',
    in_trip: 'Em viagem',
    maintenance: 'Em manutenção',
    inactive: 'Inativo',
    active: 'Disponível'
};

const STATUS_BADGE = {
    available: 'badge-success',
    active: 'badge-success',
    in_trip: 'badge-primary',
    maintenance: 'badge-warning',
    inactive: ''
};

const VEHICLE_TYPES = { carro: 'Carro', moto: 'Moto', utilitario: 'Utilitário', van: 'Van', caminhao: 'Caminhão', onibus: 'Ônibus' };
const VEHICLE_TYPE_ICONS = { carro: 'fa-car-side', moto: 'fa-motorcycle', utilitario: 'fa-truck-pickup', van: 'fa-van-shuttle', caminhao: 'fa-truck', onibus: 'fa-bus' };

const MAINTENANCE_STATUS = {
    scheduled: ['Agendada', 'badge-info'],
    in_progress: ['Em andamento', 'badge-warning'],
    completed: ['Concluída', 'badge-success'],
    cancelled: ['Cancelada', '']
};

const FUEL_OPTIONS = {
    'Gasolina Comum': 'Gasolina comum',
    'Gasolina Aditivada': 'Gasolina aditivada',
    'Álcool Comum': 'Etanol comum',
    'Álcool Aditivado': 'Etanol aditivado',
    'Diesel S10': 'Diesel S10',
    'Diesel S500': 'Diesel S500',
    'Diesel Aditivado': 'Diesel aditivado',
    'GNV': 'GNV',
    'Eletricidade': 'Carga elétrica (kWh)'
};

const COMPATIBLE_FUELS = {
    'Flex': ['Gasolina Comum', 'Gasolina Aditivada', 'Álcool Comum', 'Álcool Aditivado'],
    'Gasolina': ['Gasolina Comum', 'Gasolina Aditivada'],
    'Álcool': ['Álcool Comum', 'Álcool Aditivado'],
    'Diesel': ['Diesel S10', 'Diesel S500', 'Diesel Aditivado'],
    'GNV': ['GNV'],
    'Elétrico': ['Eletricidade'],
    'Híbrido': ['Gasolina Comum', 'Gasolina Aditivada', 'Álcool Comum', 'Álcool Aditivado', 'Eletricidade']
};

// ==========================================
// Modais das telas
// ==========================================
function openModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('active');
    setTimeout(() => el.querySelector('input:not([type="hidden"]):not([readonly]), select, textarea')?.focus(), 60);
}

function closeModal(id) {
    document.getElementById(id)?.classList.remove('active');
}

document.addEventListener('mousedown', (e) => {
    const target = e.target;
    if (target.classList && target.classList.contains('modal-overlay') && target.closest('.page-container')) {
        target.classList.remove('active');
    }
});

/**
 * Modal de formulário gerado dinamicamente.
 * fields: [{ name, label, type, required, options, value, min, max, step, full, placeholder, hint, attrs, maxlength }]
 * onSubmit(values, { close, setError }) — deve retornar true/undefined para fechar, ou false para manter aberto.
 */
function openFormModal({ title, subtitle = '', fields, submitLabel = 'Salvar', size = 'modal-lg', intro = '', onSubmit, onOpen }) {
    document.getElementById('formModal')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'formModal';
    overlay.className = 'modal-overlay';
    overlay.dataset.dynamic = '1';
    overlay.innerHTML = `
        <div class="modal ${size}" role="dialog" aria-modal="true" aria-labelledby="formModalTitle">
            <form id="formModalForm" novalidate>
                <div class="modal-header">
                    <div>
                        <h3 class="modal-title" id="formModalTitle">${escapeHtml(title)}</h3>
                        ${subtitle ? `<p class="modal-subtitle">${escapeHtml(subtitle)}</p>` : ''}
                    </div>
                    <button type="button" class="btn-icon" data-close aria-label="Fechar"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <div class="modal-body">
                    <div id="formModalError" class="form-error" style="margin-bottom: 16px;" hidden></div>
                    ${intro}
                    <div class="form-grid">${fields.map(renderFormField).join('')}</div>
                </div>
                <div class="modal-footer">
                    <span class="modal-footer-note"><span class="req">*</span> Campos obrigatórios</span>
                    <button type="button" class="btn btn-ghost" data-close>Cancelar</button>
                    <button type="submit" class="btn btn-primary"><i class="fa-solid fa-check"></i> ${escapeHtml(submitLabel)}</button>
                </div>
            </form>
        </div>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('active'));

    const form = overlay.querySelector('form');
    const errorEl = overlay.querySelector('#formModalError');
    const close = () => {
        overlay.classList.remove('active');
        setTimeout(() => overlay.remove(), 200);
    };
    const setError = (message) => {
        errorEl.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i> <span></span>';
        errorEl.querySelector('span').textContent = message;
        errorEl.hidden = false;
        errorEl.scrollIntoView({ block: 'nearest' });
    };

    overlay.addEventListener('mousedown', e => { if (e.target === overlay) close(); });
    overlay.querySelectorAll('[data-close]').forEach(btn => btn.addEventListener('click', close));

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorEl.hidden = true;
        const missing = fields.find(f => f.required && isEmptyValue(readFieldValue(form, f)));
        if (missing) return setError(`Preencha o campo "${missing.label}".`);

        const values = {};
        fields.forEach(f => { if (f.type !== 'section') values[f.name] = readFieldValue(form, f); });

        const btn = form.querySelector('button[type="submit"]');
        const original = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-color:rgba(255,255,255,.4);border-top-color:#fff;"></span> Salvando...';
        try {
            const result = await onSubmit(values, { close, setError, form });
            if (result !== false) close();
        } finally {
            btn.disabled = false;
            btn.innerHTML = original;
        }
    });

    setTimeout(() => form.querySelector('input:not([type="hidden"]):not([readonly]), select, textarea')?.focus(), 80);
    if (onOpen) onOpen(overlay, form);
    return { overlay, form, close, setError };
}

function isEmptyValue(value) {
    return value === null || value === undefined || (typeof value === 'string' && value.trim() === '') || (Array.isArray(value) && !value.length);
}

function readFieldValue(form, field) {
    if (field.type === 'checkboxes') {
        return Array.from(form.querySelectorAll(`input[name="${field.name}"]:checked`)).map(el => el.value);
    }
    if (field.type === 'checkbox') return form.elements[field.name].checked;
    const el = form.elements[field.name];
    return el ? el.value : null;
}

function renderFormField(field) {
    if (field.type === 'section') {
        return `<div class="form-section-title ${field.divided ? 'divided' : ''}">${escapeHtml(field.label)}</div>`;
    }
    const id = `ff_${field.name}`;
    const attrs = [
        `name="${field.name}"`,
        `id="${id}"`,
        field.min !== undefined ? `min="${field.min}"` : '',
        field.max !== undefined ? `max="${field.max}"` : '',
        field.step ? `step="${field.step}"` : '',
        field.maxlength ? `maxlength="${field.maxlength}"` : '',
        field.placeholder ? `placeholder="${escapeHtml(field.placeholder)}"` : '',
        field.disabled ? 'disabled' : '',
        field.readonly ? 'readonly' : '',
        field.attrs || ''
    ].join(' ');
    const value = field.value ?? '';

    let control;
    if (field.type === 'select') {
        const options = (field.options || []).map(opt => {
            const [val, text] = Array.isArray(opt) ? opt : [opt, opt];
            return `<option value="${escapeHtml(val)}" ${String(val) === String(value) ? 'selected' : ''}>${escapeHtml(text)}</option>`;
        }).join('');
        control = `<select ${attrs}>${field.placeholderOption ? `<option value="">${escapeHtml(field.placeholderOption)}</option>` : ''}${options}</select>`;
    } else if (field.type === 'textarea') {
        control = `<textarea ${attrs}>${escapeHtml(value)}</textarea>`;
    } else if (field.type === 'checkboxes') {
        const selected = (Array.isArray(value) ? value : []).map(String);
        control = (field.options || []).length
            ? `<div class="check-grid">${field.options.map(([val, text]) => `
                <label class="check-option"><input type="checkbox" name="${field.name}" value="${escapeHtml(val)}" ${selected.includes(String(val)) ? 'checked' : ''}> <span>${escapeHtml(text)}</span></label>`).join('')}</div>`
            : '<span class="field-hint">Nenhuma opção disponível.</span>';
    } else if (field.type === 'checkbox') {
        control = `<label class="check-option"><input type="checkbox" ${attrs} ${value ? 'checked' : ''}> <span>${escapeHtml(field.checkboxLabel || '')}</span></label>`;
    } else {
        const inputValue = field.type === 'date' ? brToIsoDate(value) || value : value;
        control = field.affix
            ? `<div class="input-affix"><input type="${field.type || 'text'}" ${attrs} value="${escapeHtml(inputValue)}"><span class="affix">${escapeHtml(field.affix)}</span></div>`
            : `<input type="${field.type || 'text'}" ${attrs} value="${escapeHtml(inputValue)}">`;
    }

    return `
        <div class="field ${field.full ? 'full' : ''}">
            <label for="${id}">${escapeHtml(field.label)}${field.required ? '<span class="req">*</span>' : ''}</label>
            ${control}
            ${field.hint ? `<span class="field-hint" id="${id}_hint">${escapeHtml(field.hint)}</span>` : `<span class="field-hint" id="${id}_hint"></span>`}
        </div>`;
}

// ==========================================
// Componentes de tabela
// ==========================================
function emptyRow(colspan, message, icon = 'fa-inbox') {
    return `
        <tr class="table-empty">
            <td colspan="${colspan}">
                <div class="empty-state" style="padding: 20px;">
                    <div class="empty-icon"><i class="fa-solid ${icon}"></i></div>
                    <p>${escapeHtml(message)}</p>
                </div>
            </td>
        </tr>`;
}

function emptyBlock({ icon = 'fa-inbox', tone = '', title = '', text = '', action = '' } = {}) {
    return `
        <div class="empty-state">
            <div class="empty-icon ${tone}"><i class="fa-solid ${icon}"></i></div>
            ${title ? `<h3>${escapeHtml(title)}</h3>` : ''}
            ${text ? `<p>${escapeHtml(text)}</p>` : ''}
            ${action}
        </div>`;
}

function iconButton(onclick, icon, title, tone = '') {
    return `<button class="btn-icon ${tone}" onclick="${onclick}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}"><i class="${icon}"></i></button>`;
}

// Botões de editar/excluir (somente para gestores e administradores)
function actionButtons(type, id, extra = '') {
    if (!canManage()) return `<td class="actions">${extra}</td>`;
    return `
        <td class="actions">
            ${extra}
            ${iconButton(`editRecord('${type}', ${Number(id)})`, 'fa-regular fa-pen-to-square', 'Editar')}
            ${iconButton(`deleteRecord('${type}', ${Number(id)})`, 'fa-regular fa-trash-can', 'Excluir', 'danger')}
        </td>`;
}

function splitVehicleLabel(label) {
    const match = String(label || '').match(/^(.*)\s\(([^)]+)\)$/);
    return match ? { name: match[1], plate: match[2] } : { name: label || '—', plate: '' };
}

function vehicleCell(name, sub = '', icon = 'fa-car-side') {
    return `
        <div class="cell-vehicle">
            <div class="cell-vehicle-icon"><i class="fa-solid ${icon}"></i></div>
            <div>
                <div class="cell-strong">${escapeHtml(name)}</div>
                ${sub ? `<span class="cell-sub">${escapeHtml(sub)}</span>` : ''}
            </div>
        </div>`;
}

function fuelBadge(fuelType) {
    const ft = String(fuelType || '').toLowerCase();
    let cls = 'badge-violet';
    if (ft.includes('gasolina') || ft === 'flex') cls = 'badge-primary';
    else if (ft.includes('álcool') || ft.includes('alcool') || ft.includes('etanol')) cls = 'badge-success';
    else if (ft.includes('diesel')) cls = 'badge-warning';
    return `<span class="badge ${cls}">${escapeHtml(FUEL_OPTIONS[fuelType] || fuelType || '—')}</span>`;
}

function statusBadge(status) {
    return `<span class="badge badge-dot ${STATUS_BADGE[status] || ''}">${STATUS_LABELS[status] || status}</span>`;
}

function attachTableSearch(inputId, tbodyId) {
    const input = document.getElementById(inputId);
    if (!input || input.dataset.bound) return;
    input.dataset.bound = '1';
    input.addEventListener('input', () => applyTableSearch(inputId, tbodyId));
}

function applyTableSearch(inputId, tbodyId) {
    const input = document.getElementById(inputId);
    const tbody = document.getElementById(tbodyId);
    if (!input || !tbody) return;
    const term = input.value.trim().toLowerCase();
    tbody.querySelectorAll('tr[data-row]').forEach(tr => {
        tr.hidden = term !== '' && !tr.textContent.toLowerCase().includes(term);
    });
}

async function refreshVisibleTables() {
    const jobs = [];
    if (document.getElementById('vehicleLogBody')) jobs.push(renderVehicleTable());
    if (document.getElementById('fuelLogBody')) jobs.push(renderFuelTable());
    if (document.getElementById('maintenanceLogBody')) jobs.push(renderMaintenanceTable());
    if (typeof updateRecordKpis === 'function') jobs.push(updateRecordKpis());
    jobs.push(refreshAlertBadge());
    await Promise.all(jobs);
}

// ==========================================
// Veículos (RF01)
// ==========================================
function vehicleFields(item = {}) {
    const currentYear = new Date().getFullYear();
    const statusOptions = item.status === 'in_trip'
        ? [['in_trip', 'Em viagem (automático)']]
        : [['available', 'Disponível'], ['maintenance', 'Em manutenção'], ['inactive', 'Inativo']];
    return [
        { type: 'section', label: 'Identificação' },
        { name: 'plate', label: 'Placa', required: true, maxlength: 8, value: item.plate, placeholder: 'ABC1D23', attrs: 'style="font-family: var(--font-mono); text-transform: uppercase; letter-spacing: .08em;" oninput="formatPlate(this)"', hint: 'Mercosul (ABC1D23) ou antigo (ABC1234)' },
        { name: 'vehicle_type', label: 'Tipo', type: 'select', required: true, value: item.vehicle_type, placeholderOption: 'Selecione', options: Object.entries(VEHICLE_TYPES) },
        { name: 'brand', label: 'Marca', required: true, maxlength: 60, value: item.brand, placeholder: 'Volkswagen' },
        { name: 'model', label: 'Modelo', required: true, maxlength: 80, value: item.model, placeholder: 'Gol 1.0' },
        { name: 'year', label: 'Ano', type: 'number', required: true, min: 1950, max: currentYear + 1, value: item.year, placeholder: String(currentYear) },
        { name: 'status', label: 'Status', type: 'select', value: item.status || 'available', options: statusOptions },
        { type: 'section', label: 'Capacidades e combustível', divided: true },
        { name: 'load_capacity_kg', label: 'Capacidade de carga', type: 'number', required: true, min: 0, step: '1', affix: 'kg', value: item.load_capacity_kg ?? '', placeholder: '650' },
        { name: 'fuel_type', label: 'Combustível', type: 'select', value: item.fuel_type || 'Flex', options: Object.keys(COMPATIBLE_FUELS) },
        { name: 'capacity', label: 'Capacidade do tanque', type: 'number', required: true, min: 1, step: '0.5', affix: 'L', value: item.capacity || '', placeholder: '55' },
        { name: 'current_odometer', label: 'Quilometragem atual', type: 'number', min: 0, step: '1', affix: 'km', value: item.current_odometer ?? '', placeholder: '0' },
        { type: 'section', label: 'Plano de manutenção preventiva (RF05)', divided: true },
        { name: 'maintenance_interval_km', label: 'Revisão a cada', type: 'number', min: 500, step: '500', affix: 'km', value: item.maintenance_interval_km || 10000 },
        { name: 'maintenance_interval_days', label: 'Ou a cada', type: 'number', min: 7, step: '1', affix: 'dias', value: item.maintenance_interval_days || 180 }
    ];
}

function openVehicleModal() {
    openFormModal({
        title: 'Novo veículo',
        subtitle: 'Cadastre os dados principais do veículo da frota.',
        fields: vehicleFields(),
        submitLabel: 'Cadastrar veículo',
        onSubmit: async (values, { setError }) => {
            const { ok, data } = await apiSend('/api/data/vehicles', 'POST', values);
            if (!ok) { setError(data.error || 'Placa inválida ou já cadastrada.'); return false; }
            showToast(`Veículo ${data.data.plate} cadastrado com sucesso.`);
            refreshVisibleTables();
        }
    });
}

async function renderVehicleTable() {
    const logBody = document.getElementById('vehicleLogBody');
    if (!logBody) return;

    const vehicles = await fetchTable('vehicles');
    if (vehicles.length === 0) {
        logBody.innerHTML = emptyRow(7, 'Nenhum veículo cadastrado. Clique em "Novo veículo" para começar.', 'fa-car-side');
        return;
    }

    logBody.innerHTML = vehicles.map(v => `
        <tr data-row>
            <td>${vehicleCell(`${v.brand} ${v.model}`, `${VEHICLE_TYPES[v.vehicle_type] || 'Veículo'} · ${v.year || '—'}`, VEHICLE_TYPE_ICONS[v.vehicle_type] || 'fa-car-side')}</td>
            <td><span class="plate">${escapeHtml(v.plate)}</span></td>
            <td class="num">${formatNumber(v.load_capacity_kg, 0)} kg<span class="cell-sub">Tanque ${formatNumber(v.capacity, 0)} L</span></td>
            <td class="num">${formatNumber(v.current_odometer, 0)} km</td>
            <td><span class="badge">${escapeHtml(v.fuel_type || 'Flex')}</span></td>
            <td>${statusBadge(v.status)}</td>
            ${actionButtons('vehicles', v.id)}
        </tr>`).join('');
    applyTableSearch('tableSearch', 'vehicleLogBody');
}

async function populateVehicleSelect(selectId, { includeInactive = false, onlyIds = null, placeholder = 'Selecione o veículo' } = {}) {
    const sel = document.getElementById(selectId);
    if (!sel) return [];
    let vehicles = (await fetchTable('vehicles')).filter(v => includeInactive || v.status !== 'inactive');
    if (onlyIds) vehicles = vehicles.filter(v => onlyIds.has(v.id));

    sel.innerHTML = `<option value="">${vehicles.length ? placeholder : 'Nenhum veículo disponível'}</option>` +
        vehicles.map(v => `<option value="${Number(v.id)}">${escapeHtml(`${v.plate} — ${v.brand} ${v.model}`)}${v.status !== 'available' ? ` (${STATUS_LABELS[v.status] || v.status})` : ''}</option>`).join('');
    return vehicles;
}

// ==========================================
// Abastecimentos (RF03 / RF06 / HU02)
// ==========================================
async function renderFuelTable() {
    const logBody = document.getElementById('fuelLogBody');
    if (!logBody) return;

    const fuels = await fetchTable('fuels');
    if (fuels.length === 0) {
        logBody.innerHTML = emptyRow(9, 'Nenhum abastecimento registrado ainda.', 'fa-gas-pump');
        return;
    }

    logBody.innerHTML = fuels.map(f => {
        const v = splitVehicleLabel(f.vehicle);
        return `
            <tr data-row>
                <td class="cell-muted nowrap">${escapeHtml(f.date)}</td>
                <td>${vehicleCell(v.name, v.plate)}</td>
                <td class="cell-muted">${escapeHtml(f.driver_name || '—')}</td>
                <td>${fuelBadge(f.fuel_type)}</td>
                <td class="num">${formatNumber(f.liters, 2)} L</td>
                <td class="num cell-muted">${f.odometer > 0 ? formatNumber(f.odometer, 0) + ' km' : '—'}</td>
                <td class="num">${f.km_per_liter ? `<strong>${formatNumber(f.km_per_liter, 2)}</strong> km/L` : '<span class="text-subtle">—</span>'}</td>
                <td class="num cell-strong">${formatBRL(f.cost)}</td>
                ${actionButtons('fuels', f.id)}
            </tr>`;
    }).join('');
    applyTableSearch('tableSearch', 'fuelLogBody');
}

async function openFuelModal() {
    const form = document.getElementById('fuelRecordForm');
    if (!form) return;
    form.reset();
    resetVehicleContext();
    ['fuelTankHint', 'litersHint', 'odometerHint', 'horimeterHint'].forEach(id => setHint(id, ''));
    form.elements.date.value = todayIso();
    form.elements.date.max = todayIso();
    document.getElementById('fuelTypeSelect').innerHTML = '<option value="">Selecione o veículo</option>';
    openModal('fuelModal');

    // Motorista só vê os veículos vinculados a ele ou às suas viagens
    let onlyIds = null;
    if (hasRole('motorista')) {
        const [drivers, trips] = await Promise.all([fetchTable('drivers'), fetchTable('trips')]);
        onlyIds = new Set([
            ...((drivers[0] && drivers[0].vehicle_ids) || []),
            ...trips.filter(t => ['planned', 'in_progress'].includes(t.status)).map(t => t.vehicle_id)
        ]);
    } else {
        const drivers = await fetchTable('drivers');
        const sel = document.getElementById('fuelDriverSelect');
        if (sel) {
            sel.innerHTML = '<option value="">Automático (motorista da viagem em andamento)</option>' +
                drivers.filter(d => d.status === 'active').map(d => `<option value="${Number(d.id)}">${escapeHtml(d.name)}</option>`).join('');
        }
    }
    await populateVehicleSelect('fuelVehicleSelect', { onlyIds });
}

// ==========================================
// Manutenções (RF04 / HU03)
// ==========================================
async function renderMaintenanceTable() {
    const logBody = document.getElementById('maintenanceLogBody');
    if (!logBody) return;

    const manuts = await fetchTable('maintenances');
    if (manuts.length === 0) {
        logBody.innerHTML = emptyRow(7, 'Nenhuma manutenção registrada ainda.', 'fa-screwdriver-wrench');
        return;
    }

    logBody.innerHTML = manuts.map(m => {
        const v = splitVehicleLabel(m.vehicle);
        const [statusLabel, statusClass] = MAINTENANCE_STATUS[m.status] || MAINTENANCE_STATUS.completed;
        const dateLabel = m.status === 'scheduled' ? formatDateBR(m.scheduled_date) : m.date;
        const due = m.status === 'scheduled' ? relativeDays(parseAnyDate(m.scheduled_date)) : '';

        let extra = '';
        if (canManage()) {
            if (m.status === 'scheduled') extra += iconButton(`startMaintenance(${Number(m.id)})`, 'fa-solid fa-play', 'Iniciar (veículo fica em manutenção)');
            if (['scheduled', 'in_progress'].includes(m.status)) {
                extra += iconButton(`completeMaintenance(${Number(m.id)})`, 'fa-solid fa-check', 'Concluir', 'success');
                extra += iconButton(`cancelMaintenance(${Number(m.id)})`, 'fa-solid fa-ban', 'Cancelar', 'danger');
            }
        }

        return `
            <tr data-row class="${m.status === 'scheduled' && due && due.startsWith('Há') ? 'row-highlight' : ''}">
                <td class="nowrap"><span class="cell-muted">${escapeHtml(dateLabel)}</span>${due ? `<span class="cell-sub">${escapeHtml(due)}</span>` : ''}</td>
                <td>${vehicleCell(v.name, v.plate)}</td>
                <td>
                    <div class="cell-strong">${escapeHtml(m.service)}</div>
                    <span class="cell-sub">${m.kind === 'preventiva' ? 'Preventiva' : 'Corretiva'}${m.workshop ? ` · ${escapeHtml(m.workshop)}` : ''}${m.notes ? ` · ${escapeHtml(m.notes)}` : ''}</span>
                </td>
                <td><span class="badge badge-dot ${statusClass}">${statusLabel}</span></td>
                <td class="num cell-muted">${m.odometer > 0 ? formatNumber(m.odometer, 0) + ' km' : '—'}</td>
                <td class="num cell-strong">${formatBRL(m.cost)}</td>
                ${actionButtons('maintenances', m.id, extra)}
            </tr>`;
    }).join('');
    applyTableSearch('tableSearch', 'maintenanceLogBody');
}

function setMaintMode(mode) {
    const form = document.getElementById('maintenanceForm');
    if (!form) return;
    form.elements.status.value = mode;
    document.querySelectorAll('#maintModeSwitch button').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    const scheduled = mode === 'scheduled';
    document.getElementById('maintDoneFields').hidden = scheduled;
    document.getElementById('maintScheduleFields').hidden = !scheduled;
    form.elements.date.required = !scheduled;
    form.elements.scheduled_date.required = scheduled;
    form.elements.cost.required = !scheduled;
    document.getElementById('maintCostLabel').innerHTML = scheduled
        ? 'Custo estimado <span class="opt">(opcional)</span>'
        : 'Custo total<span class="req">*</span>';
    document.getElementById('maintModalTitle').textContent = scheduled ? 'Agendar manutenção' : 'Registrar manutenção realizada';
}

async function openMaintModal(mode = 'completed') {
    const form = document.getElementById('maintenanceForm');
    if (!form) return;
    form.reset();
    resetVehicleContext();
    ['maintOdometerHint', 'maintHorimeterHint'].forEach(id => setHint(id, ''));
    form.elements.date.value = todayIso();
    form.elements.date.max = todayIso();
    form.elements.scheduled_date.min = todayIso();
    setMaintMode(mode);
    openModal('maintModal');
    await populateVehicleSelect('maintVehicleSelect', { includeInactive: true });
}

async function startMaintenance(id) {
    if (!confirm('Iniciar a manutenção? O veículo ficará com status "Em manutenção" e não poderá ser escalado para viagens.')) return;
    const { ok, data } = await apiSend(`/api/maintenances/${id}/start`, 'POST');
    if (!ok) return showToast(data.error || 'Não foi possível iniciar a manutenção.', 'error');
    showToast('Manutenção iniciada. Veículo em manutenção.');
    refreshVisibleTables();
}

async function completeMaintenance(id) {
    const items = await fetchTable('maintenances');
    const m = items.find(x => x.id === id);
    if (!m) return;
    openFormModal({
        title: 'Concluir manutenção',
        subtitle: `${m.service} · ${m.vehicle}`,
        size: '',
        submitLabel: 'Concluir',
        fields: [
            { name: 'date', label: 'Data de conclusão', type: 'date', required: true, value: todayIso(), attrs: `max="${todayIso()}"` },
            { name: 'cost', label: 'Custo final (R$)', type: 'number', required: true, min: 0, step: '0.01', value: m.cost || '' },
            { name: 'odometer', label: 'Quilometragem', type: 'number', min: 0, affix: 'km', value: m.odometer || '' },
            { name: 'workshop', label: 'Oficina', value: m.workshop || '' },
            { name: 'notes', label: 'Descrição do serviço', type: 'textarea', full: true, value: m.notes || '' }
        ],
        onSubmit: async (values, { setError }) => {
            const { ok, data } = await apiSend(`/api/maintenances/${id}/complete`, 'POST', values);
            if (!ok) { setError(data.error || 'Não foi possível concluir.'); return false; }
            showToast(data.vehicle_status === 'available' ? 'Manutenção concluída. Veículo disponível novamente.' : 'Manutenção concluída.');
            refreshVisibleTables();
        }
    });
}

async function cancelMaintenance(id) {
    if (!confirm('Cancelar esta manutenção?')) return;
    const { ok, data } = await apiSend(`/api/maintenances/${id}/cancel`, 'POST');
    if (!ok) return showToast(data.error || 'Não foi possível cancelar.', 'error');
    showToast('Manutenção cancelada.');
    refreshVisibleTables();
}

// ==========================================
// Excluir / Lixeira
// ==========================================
async function deleteRecord(type, id) {
    const msg = type === 'vehicles'
        ? 'Mover este veículo para a lixeira? Os lançamentos dele continuam no histórico.'
        : 'Excluir este registro?';
    if (!confirm(msg)) return false;

    const { ok, data } = await apiSend(`/api/data/${type}/${id}`, 'DELETE');
    if (!ok) {
        showToast(data.error || 'Não foi possível excluir o registro.', 'error');
        return false;
    }
    showToast(data.trashed ? 'Registro movido para a lixeira.' : 'Registro excluído.');
    refreshVisibleTables();
    if (typeof refreshFleetPage === 'function') refreshFleetPage();
    return true;
}

async function restoreRecord(id) {
    const { ok, data } = await apiSend(`/api/trash/${id}/restore`, 'POST');
    if (!ok) return showToast(data.error || 'Não foi possível restaurar o registro.', 'error');
    showToast('Registro restaurado com sucesso!');
    renderTrashTable();
    refreshVisibleTables();
    if (typeof refreshFleetPage === 'function') refreshFleetPage();
}

async function purgeTrashItem(id) {
    if (!confirm('Excluir DEFINITIVAMENTE este item? Esta ação não pode ser desfeita.')) return;
    const { ok, data } = await apiSend(`/api/trash/${id}`, 'DELETE');
    if (!ok) return showToast(data.error || 'Não foi possível excluir o item.', 'error');
    showToast('Item excluído definitivamente.');
    renderTrashTable();
}

async function emptyTrash() {
    if (!confirm('Esvaziar a lixeira? Todos os itens serão excluídos definitivamente.')) return;
    const { ok, data } = await apiSend('/api/trash', 'DELETE');
    if (!ok) return showToast(data.error || 'Não foi possível esvaziar a lixeira.', 'error');
    showToast(`${data.removed || 0} item(ns) removido(s) da lixeira.`);
    renderTrashTable();
}

async function renderTrashTable() {
    const logBody = document.getElementById('trashLogBody');
    if (!logBody) return;

    logBody.innerHTML = `<tr class="table-empty"><td colspan="4"><div class="page-loading" style="padding: 24px;"><span class="spinner"></span></div></td></tr>`;
    const trash = await fetchJSON('/api/trash', []);
    const emptyBtn = document.getElementById('btnEmptyTrash');
    if (emptyBtn) emptyBtn.hidden = trash.length === 0;

    if (!trash.length) {
        logBody.innerHTML = emptyRow(4, 'Sua lixeira está vazia.', 'fa-trash-can');
        return;
    }

    const BADGE = { vehicles: 'badge-violet', drivers: 'badge-info', fuels: 'badge-primary', maintenances: 'badge-warning', fines: 'badge-danger' };
    logBody.innerHTML = trash.map(t => `
        <tr>
            <td><span class="badge ${BADGE[t.original_type] || ''}">${escapeHtml(t.label)}</span></td>
            <td>${escapeHtml(t.summary)}<span class="cell-sub">Excluído por ${escapeHtml(t.deleted_by || '—')}</span></td>
            <td class="cell-muted nowrap">${formatUtcDateTime(t.deleted_at)}</td>
            <td class="actions">
                <button class="btn btn-secondary btn-sm" onclick="restoreRecord(${Number(t.id)})"><i class="fa-solid fa-rotate-left"></i> Restaurar</button>
                ${iconButton(`purgeTrashItem(${Number(t.id)})`, 'fa-solid fa-xmark', 'Excluir definitivamente', 'danger')}
            </td>
        </tr>`).join('');
}

const originalOpenProfileModal = window.openProfileModal || function(id) {
    document.getElementById(id)?.classList.add('active');
};
window.openProfileModal = function(id) {
    originalOpenProfileModal(id);
    if (id === 'trashModal') renderTrashTable();
};

// ==========================================
// Edição (modal gerado a partir das definições de campos)
// ==========================================
const EDIT_DEFINITIONS = {
    vehicles: { title: 'Editar veículo', fields: item => vehicleFields(item) },
    fuels: {
        title: 'Editar abastecimento',
        fields: item => [
            { name: 'date', label: 'Data', type: 'date', required: true, value: item.date },
            { name: 'fuel_type', label: 'Combustível', type: 'select', value: item.fuel_type, options: Object.entries(FUEL_OPTIONS) },
            { name: 'liters', label: 'Volume', type: 'number', step: '0.01', min: 0.01, required: true, affix: 'L', value: item.liters },
            { name: 'price_per_liter', label: 'Preço por litro (R$)', type: 'number', step: '0.001', min: 0.01, required: true, value: item.price_per_liter },
            { name: 'odometer', label: 'Quilometragem', type: 'number', step: '1', min: 0, affix: 'km', value: item.odometer },
            { name: 'horimeter', label: 'Horímetro', type: 'number', step: '0.1', min: 0, affix: 'h', value: item.horimeter }
        ]
    },
    maintenances: {
        title: 'Editar manutenção',
        fields: item => [
            { name: 'kind', label: 'Tipo', type: 'select', required: true, value: item.kind, options: [['preventiva', 'Preventiva'], ['corretiva', 'Corretiva']] },
            item.status === 'scheduled'
                ? { name: 'scheduled_date', label: 'Data agendada', type: 'date', required: true, value: item.scheduled_date }
                : { name: 'date', label: 'Data', type: 'date', required: true, value: item.date },
            { name: 'service', label: 'Serviço', required: true, full: true, value: item.service },
            { name: 'workshop', label: 'Oficina', value: item.workshop },
            { name: 'cost', label: item.status === 'scheduled' ? 'Custo estimado (R$)' : 'Custo (R$)', type: 'number', step: '0.01', min: 0, required: item.status !== 'scheduled', value: item.cost },
            { name: 'odometer', label: 'Quilometragem', type: 'number', min: 0, affix: 'km', value: item.odometer },
            { name: 'horimeter', label: 'Horímetro', type: 'number', min: 0, step: '0.1', affix: 'h', value: item.horimeter },
            { name: 'notes', label: 'Descrição', type: 'textarea', full: true, value: item.notes }
        ]
    }
};

async function editRecord(type, id) {
    const definition = EDIT_DEFINITIONS[type];
    if (!definition) return;
    const item = await fetchJSON(`/api/data/${type}/${id}`, null);
    if (!item) return showToast('Registro não encontrado.', 'error');

    openFormModal({
        title: definition.title,
        subtitle: item.vehicle || (item.plate ? `${item.brand} ${item.model} (${item.plate})` : ''),
        fields: definition.fields(item),
        submitLabel: 'Salvar alterações',
        onSubmit: async (values, { setError }) => {
            const { ok, data } = await apiSend(`/api/data/${type}/${id}`, 'PUT', values);
            if (!ok) { setError(data.error || 'Não foi possível salvar.'); return false; }
            showToast('Registro atualizado com sucesso!');
            refreshVisibleTables();
        }
    });
}

// ==========================================
// Ajudas de preenchimento
// ==========================================
function setHint(hintId, text, state = '') {
    const hint = document.getElementById(hintId);
    if (!hint) return;
    hint.className = `field-hint${state ? ` is-${state}` : ''}`;
    hint.textContent = text;
}

function resetVehicleContext() {
    window._vehicleContext = { capacity: 0, horimeter: 0, odometer: 0, vehicle: null };
}
resetVehicleContext();

function formatPlate(input) {
    const v = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7);
    input.value = v;
    const hintId = document.getElementById('plateHint') ? 'plateHint' : `${input.id}_hint`;
    if (v.length === 7) {
        if (/^[A-Z]{3}[0-9][A-Z][0-9]{2}$/.test(v)) setHint(hintId, 'Placa Mercosul válida', 'success');
        else if (/^[A-Z]{3}[0-9]{4}$/.test(v)) setHint(hintId, 'Placa padrão antigo válida', 'success');
        else setHint(hintId, 'Placa inválida. Use ABC1D23 ou ABC1234', 'error');
    } else {
        setHint(hintId, 'Mercosul (ABC1D23) ou antigo (ABC1234)');
    }
}

async function loadVehicleContext(vehicleId) {
    resetVehicleContext();
    if (!vehicleId) return window._vehicleContext;
    const [vehicle, readings] = await Promise.all([
        fetchJSON(`/api/data/vehicles/${vehicleId}`, null),
        fetchJSON(`/api/vehicles/${vehicleId}/last-readings`, {})
    ]);
    window._vehicleContext = {
        vehicle,
        capacity: vehicle ? parseFloat(vehicle.capacity) || 0 : 0,
        horimeter: readings.last_horimeter || 0,
        odometer: readings.last_odometer || 0
    };
    return window._vehicleContext;
}

// CA_HU02_2 — a quilometragem precisa ser maior que a última registrada
function validateReading(inputId, hintId, last, unit, { strict = false } = {}) {
    const input = document.getElementById(inputId);
    if (!input) return true;
    const value = parseFloat(input.value) || 0;
    if (value > 0 && last > 0) {
        if (strict ? value <= last : value < last) {
            setHint(hintId, `Quilometragem inválida: deve ser maior que ${formatNumber(last, 0)} ${unit}`, 'error');
            return false;
        }
        setHint(hintId, `+${formatNumber(value - last, 0)} ${unit} desde o último registro`, 'success');
    } else if (last > 0) {
        setHint(hintId, `Último registro: ${formatNumber(last, 0)} ${unit}`);
    } else {
        setHint(hintId, '');
    }
    return true;
}

async function onVehicleChangeFuel(sel) {
    const ctx = await loadVehicleContext(sel.value);
    const fuelTypeSelect = document.getElementById('fuelTypeSelect');

    setHint('fuelTankHint', ctx.vehicle ? `Tanque de ${formatNumber(ctx.capacity, 0)} L · ${ctx.vehicle.fuel_type} · ${formatNumber(ctx.vehicle.current_odometer, 0)} km` : '');
    validateReading('odometerInput', 'odometerHint', ctx.odometer, 'km', { strict: true });
    validateReading('horimeterInput', 'horimeterHint', ctx.horimeter, 'h');

    if (fuelTypeSelect) {
        const allowed = ctx.vehicle ? (COMPATIBLE_FUELS[ctx.vehicle.fuel_type] || Object.keys(FUEL_OPTIONS)) : [];
        fuelTypeSelect.innerHTML = allowed.length
            ? allowed.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(FUEL_OPTIONS[value])}</option>`).join('')
            : '<option value="">Selecione o veículo</option>';
    }
    validateFuelLiters();
}

async function onVehicleChangeMaint(sel) {
    const ctx = await loadVehicleContext(sel.value);
    validateReading('maintOdometerInput', 'maintOdometerHint', ctx.odometer, 'km');
    validateReading('maintHorimeterInput', 'maintHorimeterHint', ctx.horimeter, 'h');
}

function validateFuelLiters() {
    const input = document.getElementById('fuelLitersInput');
    if (!input) return true;
    const liters = parseFloat(input.value) || 0;
    const cap = window._vehicleContext.capacity;
    let valid = true;
    if (cap > 0 && liters > cap) {
        setHint('litersHint', `Excede a capacidade do tanque (${formatNumber(cap, 0)} L)`, 'error');
        valid = false;
    } else if (liters > 0 && cap > 0) {
        setHint('litersHint', `${formatNumber((liters / cap) * 100, 0)}% da capacidade do tanque`, 'success');
    } else {
        setHint('litersHint', '');
    }
    calcFuelTotal();
    return valid;
}

const validateHorimeter = () => validateReading('horimeterInput', 'horimeterHint', window._vehicleContext.horimeter, 'h');
const validateOdometer = () => validateReading('odometerInput', 'odometerHint', window._vehicleContext.odometer, 'km', { strict: true });
const validateMaintHorimeter = () => validateReading('maintHorimeterInput', 'maintHorimeterHint', window._vehicleContext.horimeter, 'h');
const validateMaintOdometer = () => validateReading('maintOdometerInput', 'maintOdometerHint', window._vehicleContext.odometer, 'km');

function calcFuelTotal() {
    const litersInput = document.getElementById('fuelLitersInput');
    const priceInput = document.getElementById('pricePerLiter');
    const costInput = document.getElementById('fuelCostTotal');
    if (!litersInput || !priceInput || !costInput) return;
    const total = (parseFloat(litersInput.value) || 0) * parseBrazilianValue(priceInput.value);
    costInput.value = total > 0 ? total.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
}

function onServiceTypeChange(sel) {
    const detail = document.querySelector('#maintenanceForm [name="service_detail"]');
    if (detail) detail.required = sel.value === 'Outro';
}

// ==========================================
// Envio dos formulários fixos das telas
// ==========================================
async function submitWithButton(form, action) {
    const btn = form.querySelector('button[type="submit"]');
    const original = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-color:rgba(255,255,255,.4);border-top-color:#fff;"></span> Salvando...';
    }
    try {
        await action();
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = original;
        }
    }
}

function requireFields(form) {
    const invalid = Array.from(form.querySelectorAll('[required]')).find(el => !el.closest('[hidden]') && !String(el.value).trim());
    if (invalid) {
        invalid.focus();
        const label = form.querySelector(`label[for="${invalid.id}"]`);
        showToast(`Preencha o campo "${label ? label.textContent.replace('*', '').trim() : 'obrigatório'}".`, 'error');
        return false;
    }
    return true;
}

document.addEventListener('submit', async (e) => {
    const form = e.target;
    const f = form.elements;

    if (form.id === 'fuelRecordForm') {
        e.preventDefault();
        if (!requireFields(form)) return;
        if (!validateFuelLiters() || !validateOdometer() || !validateHorimeter()) {
            return showToast('Corrija os campos destacados antes de salvar.', 'error');
        }
        await submitWithButton(form, async () => {
            const payload = {
                vehicle_id: f.vehicle_id.value,
                fuel_type: f.fuel_type.value,
                liters: f.liters.value,
                price_per_liter: parseBrazilianValue(f.price_per_liter.value),
                odometer: f.odometer.value,
                horimeter: f.horimeter.value,
                date: f.date.value
            };
            if (f.driver_id && f.driver_id.value) payload.driver_id = f.driver_id.value;

            const { ok, data } = await apiSend('/api/data/fuels', 'POST', payload);
            if (!ok) return showToast(data.error || 'Verifique os dados do abastecimento.', 'error');

            closeModal('fuelModal');
            const kmpl = data.data && data.data.km_per_liter;
            showToast(kmpl ? `Abastecimento registrado. Consumo calculado: ${formatNumber(kmpl, 2)} km/L.` : 'Abastecimento registrado.');
            refreshVisibleTables();
        });
    }

    else if (form.id === 'maintenanceForm') {
        e.preventDefault();
        if (!requireFields(form)) return;
        if (!validateMaintOdometer() || !validateMaintHorimeter()) {
            return showToast('Corrija a quilometragem antes de salvar.', 'error');
        }
        const type = f.service_type.value;
        const detail = f.service_detail.value.trim();
        if (type === 'Outro' && !detail) return showToast('Descreva o serviço quando o tipo for "Outro".', 'error');

        const scheduled = f.status.value === 'scheduled';
        await submitWithButton(form, async () => {
            const payload = {
                vehicle_id: f.vehicle_id.value,
                status: f.status.value,
                kind: f.kind.value,
                service: type === 'Outro' ? detail : type,
                notes: type === 'Outro' ? '' : detail,
                workshop: f.workshop.value,
                cost: parseBrazilianValue(f.cost.value),
                odometer: f.odometer.value,
                horimeter: f.horimeter.value
            };
            if (scheduled) payload.scheduled_date = f.scheduled_date.value;
            else payload.date = f.date.value;

            const { ok, data } = await apiSend('/api/data/maintenances', 'POST', payload);
            if (!ok) return showToast(data.error || 'Verifique os dados da manutenção.', 'error');

            closeModal('maintModal');
            showToast(scheduled ? 'Manutenção agendada. Você será alertado 3 dias antes.' : 'Manutenção registrada.');
            refreshVisibleTables();
        });
    }
});
