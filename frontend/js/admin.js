// =========================================================================
// NexusFleet — Relatórios de custos (RF08), usuários e perfis (RF14),
// auditoria (RNF05) e status do sistema (RNF01 / RNF02 / RNF03)
// =========================================================================

Object.assign(PAGE_SETUP, {
    relatorios: setupRelatorios,
    usuarios: setupUsuarios,
    auditoria: setupAuditoria,
    sistema: setupSistema
});

// ==========================================
// Relatório de custos por veículo (RF08)
// ==========================================
let lastCostReport = null;

function monthRange(offset = 0) {
    const now = new Date();
    return [new Date(now.getFullYear(), now.getMonth() + offset, 1), new Date(now.getFullYear(), now.getMonth() + offset + 1, 0)];
}

async function setupRelatorios() {
    const [start, end] = monthRange(0);
    document.getElementById('repStart').value = brToIsoDate(start);
    document.getElementById('repEnd').value = brToIsoDate(end);

    const vehicles = await fetchTable('vehicles');
    document.getElementById('repVehicle').innerHTML = '<option value="">Todos os veículos</option>' +
        vehicles.map(v => `<option value="${Number(v.id)}">${escapeHtml(`${v.plate} — ${v.brand} ${v.model}`)}</option>`).join('');

    const presets = {
        month: () => monthRange(0),
        last: () => monthRange(-1),
        quarter: () => [monthRange(-2)[0], monthRange(0)[1]],
        year: () => [new Date(new Date().getFullYear(), 0, 1), new Date(new Date().getFullYear(), 11, 31)]
    };
    document.querySelectorAll('#repPresets button').forEach(btn => btn.addEventListener('click', () => {
        const [s, e] = presets[btn.dataset.preset]();
        document.getElementById('repStart').value = brToIsoDate(s);
        document.getElementById('repEnd').value = brToIsoDate(e);
        document.querySelectorAll('#repPresets button').forEach(b => b.classList.toggle('active', b === btn));
        loadCostReport();
    }));
    ['repStart', 'repEnd', 'repVehicle'].forEach(id => document.getElementById(id).addEventListener('change', () => {
        document.querySelectorAll('#repPresets button').forEach(b => b.classList.remove('active'));
        loadCostReport();
    }));

    await loadCostReport();
}

async function loadCostReport() {
    const params = new URLSearchParams({
        start: document.getElementById('repStart').value,
        end: document.getElementById('repEnd').value
    });
    const vehicleId = document.getElementById('repVehicle').value;
    if (vehicleId) params.set('vehicle_id', vehicleId);

    const res = await apiFetch(`/api/reports/costs?${params}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return showToast(data.error || 'Não foi possível gerar o relatório.', 'error');
    lastCostReport = data;

    const t = data.totals;
    setText('repPeriodLabel', `${formatDateBR(data.period.start)} a ${formatDateBR(data.period.end)}`);
    setText('repTotal', formatBRL(t.total));
    setText('repTotalInfo', `${data.rows.filter(r => r.total > 0).length} veículo(s) com custos · ${formatNumber(t.km, 0)} km em viagens`);
    setText('repFuel', formatBRL(t.fuel));
    setText('repFuelInfo', `${formatNumber(t.liters, 0)} litros`);
    setText('repMaint', formatBRL(t.maintenance));
    setText('repTollsFines', formatBRL(t.tolls + t.fines));
    setText('repTollsFinesInfo', `Pedágios ${formatBRL(t.tolls)} · Multas ${formatBRL(t.fines)}`);

    // Gráfico: custo por veículo (até 10 maiores)
    const top = data.rows.filter(r => r.total > 0).sort((a, b) => b.total - a.total).slice(0, 10);
    const box = document.getElementById('repChartBox');
    if (!top.length) {
        box.innerHTML = emptyBlock({ icon: 'fa-chart-bar', text: 'Nenhum custo lançado no período.' });
    } else {
        box.innerHTML = '<canvas id="repChart" role="img" aria-label="Custos por veículo"></canvas>';
        box.style.height = `${Math.max(220, top.length * 46)}px`;
        const p = chartTheme().palette;
        const options = baseChartOptions({ stacked: true });
        options.indexAxis = 'y';
        options.plugins.tooltip.callbacks.label = ctx => ` ${ctx.dataset.label}: ${formatBRL(ctx.parsed.x)}`;
        options.scales = {
            x: { stacked: true, beginAtZero: true, border: { display: false }, ticks: { color: chartTheme().text, callback: v => 'R$ ' + Number(v).toLocaleString('pt-BR', { notation: 'compact' }) }, grid: { color: chartTheme().grid } },
            y: { stacked: true, border: { display: false }, ticks: { color: chartTheme().text }, grid: { display: false } }
        };
        renderChart('repChart', {
            type: 'bar',
            data: {
                labels: top.map(r => r.plate),
                datasets: [
                    { label: 'Combustível', data: top.map(r => r.fuel), backgroundColor: p.blue, borderRadius: 4, maxBarThickness: 26 },
                    { label: 'Manutenção', data: top.map(r => r.maintenance), backgroundColor: p.amber, borderRadius: 4, maxBarThickness: 26 },
                    { label: 'Pedágios', data: top.map(r => r.tolls), backgroundColor: p.green, borderRadius: 4, maxBarThickness: 26 },
                    { label: 'Multas', data: top.map(r => r.fines), backgroundColor: p.red, borderRadius: 4, maxBarThickness: 26 }
                ]
            },
            options
        });
    }

    // Tabela por veículo
    document.getElementById('repBody').innerHTML = data.rows.length
        ? data.rows.map(r => `
            <tr data-row>
                <td>${vehicleCell(r.name, r.plate)}</td>
                <td class="num">${formatBRL(r.fuel)}</td>
                <td class="num">${formatBRL(r.maintenance)}</td>
                <td class="num">${formatBRL(r.tolls)}</td>
                <td class="num">${formatBRL(r.fines)}</td>
                <td class="num cell-strong">${formatBRL(r.total)}</td>
                <td class="num cell-muted">${r.km ? `${formatNumber(r.km, 0)} km` : '—'}</td>
                <td class="num">${r.cost_per_km !== null ? formatBRL(r.cost_per_km) : '—'}</td>
            </tr>`).join('')
        : emptyRow(8, 'Nenhum veículo encontrado.', 'fa-car-side');

    document.getElementById('repFoot').innerHTML = `
        <tr>
            <td>Total do período</td>
            <td class="num">${formatBRL(t.fuel)}</td>
            <td class="num">${formatBRL(t.maintenance)}</td>
            <td class="num">${formatBRL(t.tolls)}</td>
            <td class="num">${formatBRL(t.fines)}</td>
            <td class="num">${formatBRL(t.total)}</td>
            <td class="num">${formatNumber(t.km, 0)} km</td>
            <td class="num">${t.km ? formatBRL(t.total / t.km) : '—'}</td>
        </tr>`;

    // Lançamentos que compõem o total (conferência)
    const d = data.details;
    const entries = [
        ...d.fuels.map(x => ({ date: x.date, type: ['Combustível', 'badge-primary'], plate: x.plate, desc: `${FUEL_OPTIONS[x.fuel_type] || x.fuel_type} · ${formatNumber(x.liters, 2)} L`, value: x.cost })),
        ...d.maintenances.map(x => ({ date: x.date, type: ['Manutenção', 'badge-warning'], plate: x.plate, desc: `${x.service} (${x.kind})`, value: x.cost })),
        ...d.tolls.map(x => ({ date: x.actual_end, type: ['Pedágio', 'badge-success'], plate: x.plate, desc: `Viagem #${x.id}: ${x.origin_name} → ${x.destination_name}`, value: x.toll_cost })),
        ...d.fines.map(x => ({ date: x.infraction_date, type: ['Multa', 'badge-danger'], plate: x.plate, desc: x.description, value: x.amount }))
    ].sort((a, b) => (parseAnyDate(b.date) || 0) - (parseAnyDate(a.date) || 0));

    setText('repDetailCount', `${entries.length} lançamento(s) · soma ${formatBRL(entries.reduce((a, e) => a + (e.value || 0), 0))}`);
    document.getElementById('repDetailBody').innerHTML = entries.length
        ? entries.map(e => `
            <tr data-row>
                <td class="cell-muted nowrap">${formatDateBR(e.date)}</td>
                <td>${badge(...e.type)}</td>
                <td><span class="plate">${escapeHtml(e.plate)}</span></td>
                <td>${escapeHtml(e.desc)}</td>
                <td class="num cell-strong">${formatBRL(e.value)}</td>
            </tr>`).join('')
        : emptyRow(5, 'Nenhum lançamento no período.', 'fa-receipt');
    attachTableSearch('repDetailSearch', 'repDetailBody');
}

// ==========================================
// Usuários e perfis de acesso (RF14)
// ==========================================
const ROLE_BADGE = { admin: 'badge-violet', gestor: 'badge-primary', motorista: 'badge-info', financeiro: 'badge-success' };

async function setupUsuarios() {
    fleetRefresher = renderUsers;
    attachTableSearch('tableSearch', 'userLogBody');
    await renderUsers();
}

async function renderUsers() {
    const tbody = document.getElementById('userLogBody');
    if (!tbody) return;
    const users = await fetchJSON('/api/team', []);
    Object.keys(ROLE_LABELS).forEach(role => setText(`usr_${role}`, users.filter(u => u.role === role && u.active).length));

    tbody.innerHTML = users.map(u => {
        const self = currentUser && u.id === currentUser.id;
        return `
            <tr data-row class="${u.active ? '' : 'text-subtle'}">
                <td>${vehicleCell(u.name, u.email, 'fa-user')}</td>
                <td>${badge(ROLE_LABELS[u.role] || u.role, ROLE_BADGE[u.role])}${self ? ' <span class="badge">Você</span>' : ''}</td>
                <td class="cell-muted">${escapeHtml(u.cargo || '—')}</td>
                <td>${u.role === 'motorista' ? (u.driver_name ? `<i class="fa-solid fa-link text-subtle"></i> ${escapeHtml(u.driver_name)}` : '<span class="text-warning">Não vinculado</span>') : '<span class="text-subtle">—</span>'}</td>
                <td class="cell-muted nowrap">${u.last_login_at ? formatUtcDateTime(u.last_login_at) : 'Nunca acessou'}</td>
                <td>${u.active ? badge('Ativo', 'badge-success') : badge('Inativo')}</td>
                <td class="actions">
                    ${iconButton(`openUserModal(${Number(u.id)})`, 'fa-regular fa-pen-to-square', 'Editar')}
                    ${iconButton(`resetUserPassword(${Number(u.id)})`, 'fa-solid fa-key', 'Redefinir senha')}
                    ${self ? '' : iconButton(`toggleUserActive(${Number(u.id)}, ${u.active ? 'false' : 'true'})`, u.active ? 'fa-solid fa-user-slash' : 'fa-solid fa-user-check', u.active ? 'Desativar' : 'Reativar', u.active ? 'danger' : 'success')}
                </td>
            </tr>`;
    }).join('') || emptyRow(7, 'Nenhum usuário.', 'fa-users');
    applyTableSearch('tableSearch', 'userLogBody');
}

async function openUserModal(id = null) {
    const [users, drivers] = await Promise.all([fetchJSON('/api/team', []), fetchTable('drivers')]);
    const item = id ? users.find(u => u.id === id) : {};
    if (id && !item) return showToast('Usuário não encontrado.', 'error');
    const availableDrivers = drivers.filter(d => !d.linked_user_id || d.linked_user_id === id);

    const fields = [
        { name: 'name', label: 'Nome', required: true, maxlength: 100, value: item.name },
        { name: 'email', label: 'E-mail', type: 'email', required: !id, value: item.email, disabled: !!id, hint: id ? 'O e-mail de acesso não pode ser alterado.' : '' },
        { name: 'role', label: 'Perfil de acesso', type: 'select', required: true, value: item.role || 'gestor', options: Object.entries(ROLE_LABELS) },
        { name: 'cargo', label: 'Cargo', maxlength: 100, value: item.cargo },
        { name: 'driver_id', label: 'Cadastro de motorista vinculado', type: 'select', full: true, value: item.driver_id || '', placeholderOption: 'Nenhum', options: availableDrivers.map(d => [d.id, `${d.name} — Cat. ${d.cnh_category}`]), hint: 'Obrigatório para o perfil Motorista ver suas viagens e registrar abastecimentos.' }
    ];
    if (!id) fields.push({ name: 'password', label: 'Senha inicial', type: 'password', required: true, attrs: 'minlength="8" autocomplete="new-password"', hint: 'Mínimo de 8 caracteres. Oriente o usuário a trocá-la no primeiro acesso.' });

    openFormModal({
        title: id ? 'Editar usuário' : 'Novo usuário',
        subtitle: 'As permissões são aplicadas no servidor conforme o perfil escolhido.',
        fields,
        submitLabel: id ? 'Salvar alterações' : 'Criar usuário',
        onSubmit: async (values, { setError }) => {
            if (!id && String(values.password).length < 8) { setError('A senha inicial deve ter no mínimo 8 caracteres.'); return false; }
            if (id) delete values.email;
            if (values.role !== 'motorista') values.driver_id = '';
            const { ok, data } = await apiSend(id ? `/api/team/${id}` : '/api/team', id ? 'PUT' : 'POST', values);
            if (!ok) { setError(data.error || 'Não foi possível salvar o usuário.'); return false; }
            showToast(id ? 'Usuário atualizado.' : 'Usuário criado.');
            renderUsers();
        }
    });
}

function resetUserPassword(id) {
    openFormModal({
        title: 'Redefinir senha',
        size: 'modal-sm',
        submitLabel: 'Redefinir',
        fields: [
            { name: 'password', label: 'Nova senha', type: 'password', required: true, full: true, attrs: 'minlength="8" autocomplete="new-password"' },
            { name: 'confirm', label: 'Confirmar senha', type: 'password', required: true, full: true, attrs: 'autocomplete="new-password"' }
        ],
        onSubmit: async (values, { setError }) => {
            if (values.password.length < 8) { setError('A senha deve ter no mínimo 8 caracteres.'); return false; }
            if (values.password !== values.confirm) { setError('As senhas não conferem.'); return false; }
            const { ok, data } = await apiSend(`/api/team/${id}/reset-password`, 'POST', { password: values.password });
            if (!ok) { setError(data.error || 'Não foi possível redefinir a senha.'); return false; }
            showToast('Senha redefinida.');
        }
    });
}

async function toggleUserActive(id, active) {
    if (!active && !confirm('Desativar este usuário? Ele perderá o acesso imediatamente.')) return;
    const { ok, data } = await apiSend(`/api/team/${id}`, 'PUT', { active });
    if (!ok) return showToast(data.error || 'Não foi possível atualizar o usuário.', 'error');
    showToast(active ? 'Usuário reativado.' : 'Usuário desativado.');
    renderUsers();
}

// ==========================================
// Auditoria (RNF05)
// ==========================================
const ENTITY_LABELS = {
    vehicles: 'Veículos', drivers: 'Motoristas', trips: 'Viagens', checklists: 'Checklists', fuels: 'Abastecimentos',
    maintenances: 'Manutenções', fines: 'Multas', documents: 'Documentos', occurrences: 'Ocorrências',
    reminders: 'Agenda', stations: 'Postos', users: 'Usuários', trash: 'Lixeira'
};
const ACTION_LABELS = {
    create: ['Criação', 'badge-success'], update: ['Alteração', 'badge-primary'], delete: ['Exclusão', 'badge-danger'],
    restore: ['Restauração', 'badge-info'], purge: ['Exclusão definitiva', 'badge-danger'], login: ['Login', '']
};
const audit = { offset: 0, limit: 50, items: [] };

async function setupAuditoria() {
    document.getElementById('audEntity').innerHTML = '<option value="">Todos os cadastros</option>' +
        Object.entries(ENTITY_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
    document.getElementById('audAction').innerHTML = '<option value="">Todas as ações</option>' +
        Object.entries(ACTION_LABELS).map(([k, [v]]) => `<option value="${k}">${v}</option>`).join('');
    const users = await fetchJSON('/api/team', []);
    document.getElementById('audUser').innerHTML = '<option value="">Todos os usuários</option>' +
        users.map(u => `<option value="${Number(u.id)}">${escapeHtml(u.name)}</option>`).join('');

    document.getElementById('audFilterForm').addEventListener('submit', (e) => {
        e.preventDefault();
        audit.offset = 0;
        loadAudit();
    });
    document.getElementById('audPrev').addEventListener('click', () => { audit.offset = Math.max(0, audit.offset - audit.limit); loadAudit(); });
    document.getElementById('audNext').addEventListener('click', () => { audit.offset += audit.limit; loadAudit(); });
    audit.offset = 0;
    await loadAudit();
}

async function loadAudit() {
    const params = new URLSearchParams({ limit: audit.limit, offset: audit.offset });
    [['entity', 'audEntity'], ['action', 'audAction'], ['user_id', 'audUser'], ['start', 'audStart'], ['end', 'audEnd'], ['q', 'audSearch']]
        .forEach(([key, id]) => { const value = document.getElementById(id).value; if (value) params.set(key, value); });

    const data = await fetchJSON(`/api/audit?${params}`, null);
    if (!data) return showToast('Não foi possível carregar a auditoria.', 'error');
    audit.items = data.items;

    setText('audRetention', `Retenção mínima: ${data.retention_months} meses · registro mais antigo: ${data.oldest_record ? formatUtcDateTime(data.oldest_record) : '—'}`);
    setText('audInfo', data.total ? `${data.offset + 1}–${Math.min(data.offset + data.limit, data.total)} de ${data.total}` : 'Nenhum registro');
    document.getElementById('audPrev').disabled = data.offset === 0;
    document.getElementById('audNext').disabled = data.offset + data.limit >= data.total;

    const tbody = document.getElementById('audBody');
    if (!data.items.length) {
        tbody.innerHTML = emptyRow(6, 'Nenhuma alteração encontrada para os filtros.', 'fa-list-check');
        return;
    }
    tbody.innerHTML = data.items.map((item, index) => {
        const [actionLabel, actionClass] = ACTION_LABELS[item.action] || [item.action, ''];
        const hasChanges = item.changes && Object.keys(item.changes).length;
        return `
            <tr>
                <td class="cell-muted nowrap">${formatUtcDateTime(item.created_at)}</td>
                <td><div class="cell-strong">${escapeHtml(item.user_name || 'Sistema')}</div><span class="cell-sub">${escapeHtml(item.ip || '')}</span></td>
                <td>${badge(actionLabel, actionClass)}</td>
                <td>${escapeHtml(ENTITY_LABELS[item.entity] || item.entity)}${item.entity_id ? ` <span class="text-subtle">#${Number(item.entity_id)}</span>` : ''}</td>
                <td>${escapeHtml(item.summary || '—')}</td>
                <td class="actions">${hasChanges ? `<button class="btn btn-ghost btn-sm" onclick="toggleAuditDetail(${index}, this)">Detalhes <i class="fa-solid fa-chevron-down"></i></button>` : ''}</td>
            </tr>
            <tr class="audit-detail" id="audDetail${index}" hidden><td colspan="6"></td></tr>`;
    }).join('');
}

function toggleAuditDetail(index, btn) {
    const row = document.getElementById(`audDetail${index}`);
    const item = audit.items[index];
    if (!row.hidden) {
        row.hidden = true;
        btn.querySelector('i').className = 'fa-solid fa-chevron-down';
        return;
    }
    const fmt = value => value === null || value === undefined || value === '' ? '<span class="text-subtle">vazio</span>' : escapeHtml(typeof value === 'object' ? JSON.stringify(value) : value);
    const entries = Object.entries(item.changes || {});
    const isDiff = item.action === 'update';
    row.querySelector('td').innerHTML = `
        <div class="table-wrap" style="background: var(--surface-2); border-radius: 10px;">
            <table class="table">
                <thead><tr><th>Campo</th>${isDiff ? '<th>Antes</th><th>Depois</th>' : '<th>Valor</th>'}</tr></thead>
                <tbody>${entries.map(([field, value]) => isDiff
                    ? `<tr><td class="cell-strong">${escapeHtml(field)}</td><td class="text-danger">${fmt(value.from)}</td><td class="text-success">${fmt(value.to)}</td></tr>`
                    : `<tr><td class="cell-strong">${escapeHtml(field)}</td><td>${fmt(value)}</td></tr>`).join('')}</tbody>
            </table>
        </div>`;
    row.hidden = false;
    btn.querySelector('i').className = 'fa-solid fa-chevron-up';
}

// ==========================================
// Status do sistema (RNF01 / RNF02 / RNF03)
// ==========================================
function formatUptime(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return d ? `${d}d ${h}h ${m}min` : h ? `${h}h ${m}min` : `${m} min`;
}

async function setupSistema() {
    await renderSystemStatus();
    const timer = setInterval(renderSystemStatus, 30000);
    onPageLeave(() => clearInterval(timer));
}

async function renderSystemStatus() {
    if (!document.getElementById('sysAvailability')) return;
    const data = await fetchJSON('/api/system/status', null);
    if (!data) return;

    const availability = data.availability_30d;
    setText('sysAvailability', availability ? `${formatNumber(availability.percent, 2)}%` : '—');
    setHTML('sysAvailabilityInfo', availability
        ? `Meta 99% · ${availability.percent >= 99 ? '<span class="text-success">atendida</span>' : '<span class="text-danger">abaixo da meta</span>'} desde ${formatUtcDateTime(availability.since)}`
        : 'Coletando dados');
    setText('sysUptime', formatUptime(data.uptime_seconds));
    setText('sysUptimeInfo', `Iniciado em ${new Date(data.started_at).toLocaleString('pt-BR')}`);

    const rt = data.response_times;
    setText('sysAvg', rt.avg_ms !== null ? `${formatNumber(rt.avg_ms, 0)} ms` : '—');
    setText('sysAvgInfo', rt.count ? `p95 ${formatNumber(rt.p95_ms, 0)} ms · máx. ${formatNumber(rt.max_ms, 0)} ms (${rt.count} req.)` : 'Sem requisições medidas');
    setText('sysSlow', rt.over_3s || 0);

    document.getElementById('sysEndpoints').innerHTML = rt.slowest.length
        ? rt.slowest.map(s => `
            <tr>
                <td><code>${escapeHtml(s.endpoint)}</code></td>
                <td class="num">${s.count}</td>
                <td class="num">${formatNumber(s.avg_ms, 1)} ms</td>
                <td class="num">${formatNumber(s.max_ms, 1)} ms</td>
            </tr>`).join('')
        : emptyRow(4, 'Sem medições ainda.', 'fa-stopwatch');

    const sec = data.security;
    document.getElementById('sysSecurity').innerHTML = [
        ['fa-lock', 'Criptografia de CPF e CNH', sec.encryption, 'success'],
        ['fa-key', 'Chave de criptografia dedicada', sec.dedicated_key ? 'Configurada (DATA_ENCRYPTION_KEY)' : 'Derivada do JWT_SECRET — defina DATA_ENCRYPTION_KEY em produção', sec.dedicated_key ? 'success' : 'warning'],
        ['fa-shield-halved', 'Dados em trânsito (HTTPS)', sec.https ? 'Conexão segura ativa' : 'Conexão sem HTTPS (ambiente local). Em produção o HTTPS é obrigatório.', sec.https ? 'success' : 'warning'],
        ['fa-user-lock', 'Senhas', `Hash ${sec.password_hash}`, 'success'],
        ['fa-clock-rotate-left', 'Log de alterações', `Retenção mínima de ${data.audit_retention_months} meses`, 'success'],
        ['fa-database', 'Banco de dados', `${data.database_engine || 'PostgreSQL'}${data.database ? ' — ' + data.database : ''}`, 'success'],
        ['fa-server', 'Execução', data.runtime || 'Node.js', 'success']
    ].map(([icon, title, text, tone]) => `
        <div class="list-item">
            <div class="list-icon ${tone}"><i class="fa-solid ${icon}"></i></div>
            <div class="list-content"><div class="list-title">${title}</div><div class="list-sub" style="white-space: normal;">${escapeHtml(text)}</div></div>
        </div>`).join('');

    setText('sysCounts', `${data.counts.vehicles} veículos · ${data.counts.drivers} motoristas · ${data.counts.trips} viagens · ${data.counts.users} usuários · banco ${data.database_size_bytes ? formatNumber(data.database_size_bytes / 1048576, 2) + ' MB' : '—'}`);
}

// RNF01 — mede o tempo das principais listagens a partir do navegador
async function runListingTest() {
    const btn = document.getElementById('sysPerfBtn');
    btn.disabled = true;
    const tbody = document.getElementById('sysPerfBody');
    tbody.innerHTML = `<tr class="table-empty"><td colspan="4"><div class="page-loading" style="padding: 20px;"><span class="spinner"></span> Medindo...</div></td></tr>`;

    const endpoints = [['Veículos', 'vehicles'], ['Motoristas', 'drivers'], ['Viagens', 'trips'], ['Abastecimentos', 'fuels'], ['Manutenções', 'maintenances'], ['Multas', 'fines']];
    const rows = [];
    for (const [label, resource] of endpoints) {
        const times = [];
        let count = 0;
        for (let i = 0; i < 3; i++) {
            const start = performance.now();
            const res = await apiFetch(`/api/data/${resource}`);
            const json = await res.json();
            times.push(performance.now() - start);
            count = Array.isArray(json) ? json.length : 0;
        }
        const avg = times.reduce((a, b) => a + b, 0) / times.length;
        rows.push({ label, count, avg, max: Math.max(...times) });
    }

    tbody.innerHTML = rows.map(r => `
        <tr>
            <td class="cell-strong">${r.label}</td>
            <td class="num">${r.count}</td>
            <td class="num">${formatNumber(r.avg, 0)} ms<span class="cell-sub">máx. ${formatNumber(r.max, 0)} ms</span></td>
            <td>${r.max <= 3000 ? badge('Dentro de 3 s', 'badge-success') : badge('Acima de 3 s', 'badge-danger')}</td>
        </tr>`).join('');
    btn.disabled = false;
    renderSystemStatus();
}
