// =========================================================================
// NexusFleet — Motoristas (RF02), Multas (RF09), Documentos (RF13) e Ocorrências
// =========================================================================

Object.assign(PAGE_SETUP, {
    motoristas: setupMotoristas,
    multas: setupMultas,
    documentos: setupDocumentos,
    ocorrencias: setupOcorrencias
});

// Atualização da tela atual após exclusões/restaurações (chamado por records.js)
let fleetRefresher = null;
function refreshFleetPage() {
    if (fleetRefresher) fleetRefresher();
}

// Regras de habilitação espelhadas do servidor (para avisos imediatos no formulário)
const CNH_CATEGORIES = ['A', 'B', 'C', 'D', 'E', 'AB', 'AC', 'AD', 'AE'];
const REQUIRED_CATEGORY = { moto: 'A', carro: 'B', utilitario: 'B', van: 'B', caminhao: 'C', onibus: 'D' };

function categoryAllows(category, required) {
    const cat = String(category || '').toUpperCase();
    if (required === 'A') return cat.includes('A');
    const rank = { B: 1, C: 2, D: 3, E: 4 };
    const held = Math.max(0, ...cat.replace('A', '').split('').map(l => rank[l] || 0));
    return held >= rank[required];
}

const CNH_STATUS = {
    valid: ['Válida', 'badge-success'],
    expiring: ['Vence em breve', 'badge-warning'],
    expired: ['Vencida', 'badge-danger']
};

const DOC_LABELS = { licenciamento: 'Licenciamento', seguro: 'Seguro', ipva: 'IPVA', tacografo: 'Tacógrafo', vistoria: 'Vistoria', outro: 'Outro' };
const FINE_SEVERITY = { leve: ['Leve', ''], media: ['Média', 'badge-warning'], grave: ['Grave', 'badge-danger'], gravissima: ['Gravíssima', 'badge-danger'] };
const FINE_STATUS = { pending: ['Pendente', 'badge-warning'], paid: ['Paga', 'badge-success'], appealed: ['Em recurso', 'badge-info'], cancelled: ['Cancelada', ''] };
const OCCURRENCE_TYPES = { avaria: 'Avaria', acidente: 'Acidente', pane: 'Pane mecânica', roubo: 'Roubo / furto', outro: 'Outro' };
const OCCURRENCE_SEVERITY = { baixa: ['Baixa', ''], media: ['Média', 'badge-warning'], alta: ['Alta', 'badge-danger'] };

function badge(label, cls = '') {
    return `<span class="badge ${cls}">${escapeHtml(label)}</span>`;
}

function vehicleOptions(vehicles) {
    return vehicles.map(v => [v.id, `${v.plate} — ${v.brand} ${v.model}`]);
}

// Veículos que o motorista logado pode usar (vinculados + viagens ativas)
async function allowedVehiclesForUser() {
    const vehicles = await fetchTable('vehicles');
    if (!hasRole('motorista')) return vehicles.filter(v => v.status !== 'inactive');
    const [drivers, trips] = await Promise.all([fetchTable('drivers'), fetchTable('trips')]);
    const ids = new Set([
        ...((drivers[0] && drivers[0].vehicle_ids) || []),
        ...trips.filter(t => ['planned', 'in_progress'].includes(t.status)).map(t => t.vehicle_id)
    ]);
    return vehicles.filter(v => ids.has(v.id));
}

function maskCpfInput(input) {
    const d = input.value.replace(/\D/g, '').slice(0, 11);
    input.value = d
        .replace(/(\d{3})(\d)/, '$1.$2')
        .replace(/(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
        .replace(/(\d{3})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3-$4');
}

function onlyDigitsInput(input, max) {
    input.value = input.value.replace(/\D/g, '').slice(0, max);
}

// ==========================================
// Motoristas (RF02 / RNF03)
// ==========================================
async function setupMotoristas() {
    attachTableSearch('tableSearch', 'driverLogBody');
    fleetRefresher = renderDrivers;
    await renderDrivers();
}

async function renderDrivers() {
    const tbody = document.getElementById('driverLogBody');
    if (!tbody) return;
    const drivers = await fetchTable('drivers');

    const count = status => drivers.filter(d => d.cnh_status === status).length;
    setText('drvTotal', drivers.length);
    setText('drvActive', `${drivers.filter(d => d.status === 'active').length} ativo(s)`);
    setText('drvValid', count('valid'));
    setText('drvExpiring', count('expiring'));
    setText('drvExpired', count('expired'));

    if (!drivers.length) {
        tbody.innerHTML = emptyRow(8, 'Nenhum motorista cadastrado.', 'fa-id-card');
        return;
    }

    tbody.innerHTML = drivers.map(d => {
        const [cnhLabel, cnhClass] = CNH_STATUS[d.cnh_status] || CNH_STATUS.valid;
        const expiryInfo = d.days_to_expiry < 0 ? `Venceu há ${Math.abs(d.days_to_expiry)} dia(s)` : `Faltam ${d.days_to_expiry} dia(s)`;
        const actions = canManage()
            ? `${iconButton(`openDriverModal(${Number(d.id)})`, 'fa-regular fa-pen-to-square', 'Editar')}
               ${iconButton(`deleteRecord('drivers', ${Number(d.id)})`, 'fa-regular fa-trash-can', 'Excluir', 'danger')}`
            : '';
        return `
            <tr data-row>
                <td>${vehicleCell(d.name, [d.phone, d.email].filter(Boolean).join(' · '), 'fa-user')}</td>
                <td><span class="plate" style="letter-spacing: .02em;">${escapeHtml(d.cpf_masked)}</span></td>
                <td><span class="plate" style="letter-spacing: .02em;">${escapeHtml(d.cnh_masked)}</span> ${badge(`Cat. ${d.cnh_category}`, 'badge-primary')}</td>
                <td class="nowrap">${formatDateBR(d.cnh_expiry)} ${badge(cnhLabel, cnhClass)}<span class="cell-sub">${expiryInfo}</span></td>
                <td>${d.vehicle_plates.length ? d.vehicle_plates.map(p => `<span class="plate" style="margin: 2px;">${escapeHtml(p)}</span>`).join('') : '<span class="text-subtle">Nenhum</span>'}</td>
                <td>${d.linked_user_email ? `<span class="badge badge-info"><i class="fa-solid fa-key"></i> ${escapeHtml(d.linked_user_email)}</span>` : '<span class="text-subtle">Sem acesso</span>'}</td>
                <td>${d.status === 'active' ? badge('Ativo', 'badge-success') : badge('Inativo')}</td>
                <td class="actions">${actions}</td>
            </tr>`;
    }).join('');
    applyTableSearch('tableSearch', 'driverLogBody');
}

async function openDriverModal(id = null) {
    const [vehicles, team] = await Promise.all([
        fetchTable('vehicles'),
        hasRole('admin') ? fetchJSON('/api/team', []) : Promise.resolve([])
    ]);

    let item = {};
    if (id) {
        item = await fetchJSON(`/api/data/drivers/${id}?reveal=1`, null);
        if (!item) return showToast('Motorista não encontrado.', 'error');
    }

    const fields = [
        { type: 'section', label: 'Dados pessoais' },
        { name: 'name', label: 'Nome completo', required: true, full: true, maxlength: 120, value: item.name },
        { name: 'cpf', label: 'CPF', required: !id, value: item.cpf || '', placeholder: '000.000.000-00', attrs: 'inputmode="numeric" oninput="maskCpfInput(this)"', hint: 'Armazenado com criptografia (AES-256-GCM)' },
        { name: 'phone', label: 'Telefone', maxlength: 20, value: item.phone, placeholder: '(19) 99999-9999' },
        { name: 'email', label: 'E-mail', type: 'email', full: true, maxlength: 120, value: item.email },
        { type: 'section', label: 'Carteira de habilitação', divided: true },
        { name: 'cnh_number', label: 'Número da CNH', required: !id, value: item.cnh_number || '', placeholder: '11 dígitos', attrs: 'inputmode="numeric" oninput="onlyDigitsInput(this, 11)"' },
        { name: 'cnh_category', label: 'Categoria', type: 'select', required: true, value: item.cnh_category, placeholderOption: 'Selecione', options: CNH_CATEGORIES },
        { name: 'cnh_expiry', label: 'Validade', type: 'date', required: true, value: item.cnh_expiry, hint: 'Alerta automático 30 dias antes do vencimento' },
        { name: 'status', label: 'Situação', type: 'select', value: item.status || 'active', options: [['active', 'Ativo'], ['inactive', 'Inativo']] },
        { type: 'section', label: 'Vínculos', divided: true },
        { name: 'vehicle_ids', label: 'Veículos que pode conduzir', type: 'checkboxes', full: true, value: (item.vehicle_ids || []).map(String), options: vehicleOptions(vehicles) }
    ];

    if (hasRole('admin')) {
        const available = team.filter(u => u.role === 'motorista' && (!u.driver_id || u.driver_id === id));
        fields.push({
            name: 'linked_user_id', label: 'Usuário de acesso (perfil Motorista)', type: 'select', full: true,
            value: item.linked_user_id || '', placeholderOption: 'Sem acesso ao sistema',
            options: available.map(u => [u.id, `${u.name} (${u.email})`]),
            hint: 'Permite que o motorista entre no sistema para ver viagens e registrar abastecimentos.'
        });
    }

    openFormModal({
        title: id ? 'Editar motorista' : 'Novo motorista',
        subtitle: id ? item.name : 'Somente motoristas com CNH válida e categoria compatível podem ser escalados.',
        fields,
        submitLabel: id ? 'Salvar alterações' : 'Cadastrar motorista',
        onSubmit: async (values, { setError }) => {
            values.vehicle_ids = values.vehicle_ids.map(Number);
            if (id && !values.cpf) delete values.cpf;
            if (id && !values.cnh_number) delete values.cnh_number;
            const { ok, data } = await apiSend(id ? `/api/data/drivers/${id}` : '/api/data/drivers', id ? 'PUT' : 'POST', values);
            if (!ok) { setError(data.error || 'Não foi possível salvar o motorista.'); return false; }
            showToast(id ? 'Motorista atualizado.' : 'Motorista cadastrado.');
            renderDrivers();
        }
    });
}

// ==========================================
// Multas (RF09)
// ==========================================
async function setupMultas() {
    attachTableSearch('tableSearch', 'fineLogBody');
    fleetRefresher = renderFines;
    await renderFines();
}

async function renderFines() {
    const tbody = document.getElementById('fineLogBody');
    if (!tbody) return;
    const fines = await fetchTable('fines');
    const year = new Date().getFullYear();
    const pending = fines.filter(f => f.status === 'pending');
    const thisYear = fines.filter(f => String(f.infraction_date).startsWith(String(year)) && f.status !== 'cancelled');

    setText('fineOpenAmount', formatBRL(pending.reduce((a, f) => a + f.amount, 0)));
    setText('fineOpenCount', `${pending.length} multa(s) pendente(s)`);
    setText('finePoints', thisYear.reduce((a, f) => a + (f.points || 0), 0));
    setText('fineYearAmount', formatBRL(thisYear.reduce((a, f) => a + f.amount, 0)));
    setText('fineAutoLinked', `${fines.filter(f => f.driver_auto).length}`);

    if (!fines.length) {
        tbody.innerHTML = emptyRow(8, 'Nenhuma multa registrada.', 'fa-receipt');
        return;
    }

    tbody.innerHTML = fines.map(f => {
        const [sevLabel, sevClass] = FINE_SEVERITY[f.severity] || FINE_SEVERITY.media;
        const [stLabel, stClass] = FINE_STATUS[f.status] || FINE_STATUS.pending;
        const overdue = f.status === 'pending' && f.due_date && f.due_date < todayIso();
        let actions = '';
        if (canManage()) {
            if (f.status === 'pending') actions += iconButton(`markFinePaid(${Number(f.id)})`, 'fa-solid fa-check', 'Marcar como paga', 'success');
            actions += iconButton(`openFineModal(${Number(f.id)})`, 'fa-regular fa-pen-to-square', 'Editar');
            actions += iconButton(`deleteRecord('fines', ${Number(f.id)})`, 'fa-regular fa-trash-can', 'Excluir', 'danger');
        }
        return `
            <tr data-row>
                <td class="nowrap">${formatDateBR(f.infraction_date)}<span class="cell-sub">${escapeHtml(f.infraction_time || '')}</span></td>
                <td>${vehicleCell(f.vehicle_name, f.vehicle_plate)}</td>
                <td>${f.driver_name ? `<div class="cell-strong">${escapeHtml(f.driver_name)}</div>` : '<span class="text-subtle">Não identificado</span>'}
                    ${f.driver_auto ? `<span class="cell-sub"><i class="fa-solid fa-link"></i> Viagem #${Number(f.trip_id)}</span>` : ''}</td>
                <td><div class="cell-strong">${escapeHtml(f.description)}</div><span class="cell-sub">${escapeHtml([f.code, f.location].filter(Boolean).join(' · '))}</span></td>
                <td>${badge(sevLabel, sevClass)}<span class="cell-sub">${f.points} pontos</span></td>
                <td class="num cell-strong">${formatBRL(f.amount)}<span class="cell-sub ${overdue ? 'text-danger' : ''}">${f.due_date ? `Vence ${formatDateBR(f.due_date)}` : ''}</span></td>
                <td>${badge(stLabel, stClass)}</td>
                <td class="actions">${actions}</td>
            </tr>`;
    }).join('');
    applyTableSearch('tableSearch', 'fineLogBody');
}

async function openFineModal(id = null) {
    const [vehicles, drivers] = await Promise.all([fetchTable('vehicles'), fetchTable('drivers')]);
    let item = {};
    if (id) {
        item = await fetchJSON(`/api/data/fines/${id}`, null);
        if (!item) return showToast('Multa não encontrada.', 'error');
    }

    openFormModal({
        title: id ? 'Editar multa' : 'Registrar multa',
        subtitle: 'O motorista é identificado automaticamente pela viagem em andamento na data e hora da infração.',
        submitLabel: id ? 'Salvar alterações' : 'Registrar multa',
        fields: [
            { type: 'section', label: 'Infração' },
            { name: 'vehicle_id', label: 'Veículo', type: 'select', required: true, value: item.vehicle_id, placeholderOption: 'Selecione', options: vehicleOptions(vehicles) },
            { name: 'infraction_date', label: 'Data', type: 'date', required: true, value: item.infraction_date, attrs: `max="${todayIso()}"` },
            { name: 'infraction_time', label: 'Hora', type: 'time', value: item.infraction_time },
            { name: 'driver_id', label: 'Motorista responsável', type: 'select', value: item.driver_auto ? '' : (item.driver_id || ''), placeholderOption: 'Identificar pela viagem (automático)', options: drivers.map(d => [d.id, d.name]) },
            { name: 'description', label: 'Descrição da infração', required: true, full: true, maxlength: 255, value: item.description, placeholder: 'Ex.: Avançar o sinal vermelho' },
            { name: 'code', label: 'Código', maxlength: 20, value: item.code, placeholder: '605-03' },
            { name: 'location', label: 'Local', maxlength: 255, value: item.location, placeholder: 'Av. Brasil, 1000' },
            { type: 'section', label: 'Valores e situação', divided: true },
            { name: 'severity', label: 'Gravidade', type: 'select', value: item.severity || 'media', options: Object.entries(FINE_SEVERITY).map(([k, [l]]) => [k, l]) },
            { name: 'amount', label: 'Valor (R$)', type: 'number', required: true, min: 0.01, step: '0.01', value: item.amount },
            { name: 'due_date', label: 'Vencimento', type: 'date', value: item.due_date },
            { name: 'status', label: 'Situação', type: 'select', value: item.status || 'pending', options: Object.entries(FINE_STATUS).map(([k, [l]]) => [k, l]) },
            { name: 'notes', label: 'Observações', type: 'textarea', full: true, value: item.notes }
        ],
        onOpen: (overlay, form) => {
            const hint = overlay.querySelector('#ff_driver_id_hint');
            const suggest = async () => {
                const f = form.elements;
                if (!f.vehicle_id.value || !f.infraction_date.value) { hint.textContent = ''; return; }
                const params = new URLSearchParams({ vehicle_id: f.vehicle_id.value, date: f.infraction_date.value });
                if (f.infraction_time.value) params.set('time', f.infraction_time.value);
                const result = await fetchJSON(`/api/fines/suggest-driver?${params}`, null);
                if (result && result.driver_id) {
                    hint.className = 'field-hint is-success';
                    hint.textContent = `${result.driver_name} — ${result.trip_label}`;
                } else {
                    hint.className = 'field-hint';
                    hint.textContent = 'Nenhuma viagem encontrada neste horário. Selecione o motorista manualmente.';
                }
            };
            ['vehicle_id', 'infraction_date', 'infraction_time'].forEach(name => form.elements[name].addEventListener('change', suggest));
            if (id) suggest();
        },
        onSubmit: async (values, { setError }) => {
            const { ok, data } = await apiSend(id ? `/api/data/fines/${id}` : '/api/data/fines', id ? 'PUT' : 'POST', values);
            if (!ok) { setError(data.error || 'Não foi possível salvar a multa.'); return false; }
            const saved = data.data;
            showToast(saved && saved.driver_name
                ? `Multa vinculada a ${saved.driver_name}${saved.driver_auto ? ' (identificado pela viagem)' : ''}.`
                : 'Multa registrada sem motorista identificado.', saved && saved.driver_name ? 'success' : 'info');
            renderFines();
        }
    });
}

async function markFinePaid(id) {
    const { ok, data } = await apiSend(`/api/data/fines/${id}`, 'PUT', { status: 'paid' });
    if (!ok) return showToast(data.error || 'Não foi possível atualizar a multa.', 'error');
    showToast('Multa marcada como paga.');
    renderFines();
}

// ==========================================
// Documentos do veículo (RF13)
// ==========================================
async function setupDocumentos() {
    attachTableSearch('tableSearch', 'docLogBody');
    fleetRefresher = renderDocuments;
    await renderDocuments();
}

async function renderDocuments() {
    const tbody = document.getElementById('docLogBody');
    if (!tbody) return;
    const docs = await fetchTable('documents');
    const count = s => docs.filter(d => d.doc_status === s).length;
    setText('docExpired', count('expired'));
    setText('docExpiring', count('expiring'));
    setText('docValid', count('valid'));
    setText('docCost', formatBRL(docs.filter(d => String(d.expiry_date).startsWith(String(new Date().getFullYear()))).reduce((a, d) => a + (d.cost || 0), 0)));

    if (!docs.length) {
        tbody.innerHTML = emptyRow(6, 'Nenhum documento cadastrado.', 'fa-file-shield');
        return;
    }

    const STATUS = { valid: ['Em dia', 'badge-success'], expiring: ['Vence em breve', 'badge-warning'], expired: ['Vencido', 'badge-danger'] };
    tbody.innerHTML = docs.map(d => {
        const [label, cls] = STATUS[d.doc_status];
        const actions = canManage()
            ? `${iconButton(`openDocumentModal(${Number(d.id)})`, 'fa-regular fa-pen-to-square', 'Editar')}
               ${iconButton(`deleteRecord('documents', ${Number(d.id)})`, 'fa-regular fa-trash-can', 'Excluir', 'danger')}`
            : '';
        return `
            <tr data-row class="${d.doc_status === 'expired' ? 'row-highlight' : ''}">
                <td>${vehicleCell(d.vehicle_name, d.vehicle_plate)}</td>
                <td><div class="cell-strong">${DOC_LABELS[d.doc_type] || d.doc_type}</div><span class="cell-sub">${escapeHtml([d.number, d.issuer].filter(Boolean).join(' · '))}</span></td>
                <td class="nowrap">${formatDateBR(d.expiry_date)}<span class="cell-sub">${relativeDays(parseAnyDate(d.expiry_date))}</span></td>
                <td>${badge(label, cls)}</td>
                <td class="num">${formatBRL(d.cost)}</td>
                <td class="actions">${actions}</td>
            </tr>`;
    }).join('');
    applyTableSearch('tableSearch', 'docLogBody');
}

async function openDocumentModal(id = null) {
    const vehicles = await fetchTable('vehicles');
    let item = {};
    if (id) {
        item = await fetchJSON(`/api/data/documents/${id}`, null);
        if (!item) return showToast('Documento não encontrado.', 'error');
    }
    openFormModal({
        title: id ? 'Editar documento' : 'Novo documento',
        subtitle: 'O gestor é notificado 30 dias antes do vencimento.',
        size: '',
        submitLabel: 'Salvar',
        fields: [
            { name: 'vehicle_id', label: 'Veículo', type: 'select', required: true, full: true, value: item.vehicle_id, placeholderOption: 'Selecione', options: vehicleOptions(vehicles) },
            { name: 'doc_type', label: 'Tipo', type: 'select', required: true, value: item.doc_type, placeholderOption: 'Selecione', options: Object.entries(DOC_LABELS) },
            { name: 'expiry_date', label: 'Vencimento', type: 'date', required: true, value: item.expiry_date },
            { name: 'number', label: 'Número / apólice', maxlength: 60, value: item.number },
            { name: 'issuer', label: 'Emissor / seguradora', maxlength: 120, value: item.issuer },
            { name: 'cost', label: 'Custo (R$)', type: 'number', min: 0, step: '0.01', value: item.cost },
            { name: 'notes', label: 'Observações', type: 'textarea', full: true, value: item.notes }
        ],
        onSubmit: async (values, { setError }) => {
            const { ok, data } = await apiSend(id ? `/api/data/documents/${id}` : '/api/data/documents', id ? 'PUT' : 'POST', values);
            if (!ok) { setError(data.error || 'Não foi possível salvar o documento.'); return false; }
            showToast('Documento salvo.');
            renderDocuments();
            loadNotifications();
        }
    });
}

// ==========================================
// Ocorrências
// ==========================================
async function setupOcorrencias() {
    attachTableSearch('tableSearch', 'occLogBody');
    fleetRefresher = renderOccurrences;
    await renderOccurrences();
}

async function renderOccurrences() {
    const tbody = document.getElementById('occLogBody');
    if (!tbody) return;
    const items = await fetchTable('occurrences');
    const open = items.filter(o => o.status === 'open');
    setText('occOpen', open.length);
    setText('occHigh', open.filter(o => o.severity === 'alta').length);
    setText('occResolved', items.filter(o => o.status === 'resolved').length);

    if (!items.length) {
        tbody.innerHTML = emptyRow(7, 'Nenhuma ocorrência registrada.', 'fa-circle-exclamation');
        return;
    }

    tbody.innerHTML = items.map(o => {
        const [sevLabel, sevClass] = OCCURRENCE_SEVERITY[o.severity] || OCCURRENCE_SEVERITY.media;
        const actions = canManage()
            ? `${o.status === 'open' ? iconButton(`resolveOccurrence(${Number(o.id)})`, 'fa-solid fa-check', 'Resolver', 'success') : ''}
               ${iconButton(`deleteRecord('occurrences', ${Number(o.id)})`, 'fa-regular fa-trash-can', 'Excluir', 'danger')}`
            : '';
        return `
            <tr data-row>
                <td class="nowrap">${formatDateTimeBR(o.occurred_at)}</td>
                <td>${vehicleCell(o.vehicle_name, o.vehicle_plate)}</td>
                <td><div class="cell-strong">${escapeHtml(o.driver_name || o.user_name || '—')}</div>${o.trip_id ? `<span class="cell-sub">Viagem #${Number(o.trip_id)}</span>` : ''}</td>
                <td>${badge(OCCURRENCE_TYPES[o.type] || o.type, 'badge-violet')} ${badge(sevLabel, sevClass)}</td>
                <td style="max-width: 360px;">${escapeHtml(o.description)}${o.resolution ? `<span class="cell-sub"><i class="fa-solid fa-check"></i> ${escapeHtml(o.resolution)}</span>` : ''}</td>
                <td>${o.status === 'open' ? badge('Aberta', 'badge-warning') : badge('Resolvida', 'badge-success')}</td>
                <td class="actions">${actions}</td>
            </tr>`;
    }).join('');
    applyTableSearch('tableSearch', 'occLogBody');
}

async function openOccurrenceModal(prefill = {}) {
    const vehicles = await allowedVehiclesForUser();
    if (!vehicles.length) return showToast('Nenhum veículo disponível para registrar ocorrência.', 'error');

    openFormModal({
        title: 'Reportar ocorrência',
        subtitle: 'Avarias, panes, acidentes ou outros problemas com o veículo. O gestor é notificado imediatamente.',
        size: '',
        submitLabel: 'Enviar ocorrência',
        fields: [
            { name: 'vehicle_id', label: 'Veículo', type: 'select', required: true, full: true, value: prefill.vehicle_id, placeholderOption: 'Selecione', options: vehicleOptions(vehicles) },
            { name: 'type', label: 'Tipo', type: 'select', required: true, value: prefill.type || 'avaria', options: Object.entries(OCCURRENCE_TYPES) },
            { name: 'severity', label: 'Gravidade', type: 'select', value: 'media', options: Object.entries(OCCURRENCE_SEVERITY).map(([k, [l]]) => [k, l]) },
            { name: 'occurred_at', label: 'Data e hora', type: 'datetime-local', required: true, full: true, value: localDateTimeValue(), attrs: `max="${localDateTimeValue()}"` },
            { name: 'description', label: 'Descrição', type: 'textarea', required: true, full: true, placeholder: 'Descreva o que aconteceu, onde e em que condições.' }
        ],
        onSubmit: async (values, { setError }) => {
            if (prefill.trip_id) values.trip_id = prefill.trip_id;
            const { ok, data } = await apiSend('/api/data/occurrences', 'POST', values);
            if (!ok) { setError(data.error || 'Não foi possível registrar a ocorrência.'); return false; }
            showToast('Ocorrência enviada ao gestor da frota.');
            renderOccurrences();
        }
    });
}

async function resolveOccurrence(id) {
    const item = await fetchJSON(`/api/data/occurrences/${id}`, null);
    if (!item) return;
    openFormModal({
        title: 'Resolver ocorrência',
        subtitle: `${OCCURRENCE_TYPES[item.type]} · ${item.vehicle_plate}`,
        size: '',
        submitLabel: 'Marcar como resolvida',
        intro: `<div class="callout" style="margin-bottom: 16px;"><i class="fa-solid fa-quote-left"></i><span>${escapeHtml(item.description)}</span></div>`,
        fields: [
            { name: 'resolution', label: 'Solução aplicada', type: 'textarea', required: true, full: true, placeholder: 'Ex.: Veículo encaminhado à funilaria; manutenção corretiva registrada.' }
        ],
        onSubmit: async (values, { setError }) => {
            const { ok, data } = await apiSend(`/api/data/occurrences/${id}`, 'PUT', { status: 'resolved', resolution: values.resolution });
            if (!ok) { setError(data.error || 'Não foi possível atualizar.'); return false; }
            showToast('Ocorrência resolvida.');
            renderOccurrences();
        }
    });
}
