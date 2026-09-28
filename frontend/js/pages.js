// =========================================================================
// NexusFleet — Telas analíticas (dashboard, financeiro, saúde, agenda, postos, assistente)
// =========================================================================

const PAGE_SETUP = {
    dashboard: setupDashboard,
    veiculos: setupVeiculos,
    abastecimento: setupAbastecimento,
    manutencao: setupManutencao,
    historico: setupHistorico,
    financeiro: setupFinanceiro,
    saude: setupSaude,
    diagnostico: setupDiagnostico,
    comparador: setupComparador,
    previsao: setupPrevisao,
    agenda: setupAgenda,
    mapa_postos: setupMapaPostos,
    assistente: setupAssistente
};

async function setupPageScripts(page) {
    const setup = PAGE_SETUP[page];
    if (setup) await setup();
}

// ==========================================
// Helpers
// ==========================================
const _charts = {};

function renderChart(canvasId, config) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === 'undefined') return null;
    if (_charts[canvasId]) _charts[canvasId].destroy();
    _charts[canvasId] = new Chart(canvas, config);
    return _charts[canvasId];
}

function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function setHTML(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
}

function sumCost(records) {
    return records.reduce((acc, r) => acc + (parseFloat(r.cost) || 0), 0);
}

function pct(part, total) {
    return total > 0 ? (part / total) * 100 : 0;
}

function capitalize(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function inCurrentMonth(record) {
    const d = parseAnyDate(record.date);
    const now = new Date();
    return d && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
}

function fuelCategory(fuelType) {
    const ft = String(fuelType || '').toLowerCase();
    if (ft.includes('álcool') || ft.includes('alcool') || ft.includes('etanol')) return 'etanol';
    if (ft.includes('diesel')) return 'diesel';
    if (ft.includes('gasolina')) return 'gasolina';
    return 'outros';
}

function efficiencyLabel(eff) {
    if (!eff) return 'Dados insuficientes';
    if (eff.kmPerLiter >= 12) return 'Eficiência ótima';
    if (eff.kmPerLiter >= 8) return 'Normal';
    return 'Alto consumo';
}

function baseChartOptions({ stacked = false, legend = true } = {}) {
    const theme = chartTheme();
    return {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
            legend: {
                display: legend,
                position: 'bottom',
                labels: { color: theme.text, usePointStyle: true, pointStyle: 'rectRounded', boxWidth: 8, boxHeight: 8, padding: 16 }
            },
            tooltip: {
                backgroundColor: theme.surface,
                titleColor: document.body.classList.contains('dark-mode') ? '#e8edf5' : '#0f172a',
                bodyColor: theme.text,
                borderColor: theme.grid,
                borderWidth: 1,
                padding: 10,
                boxPadding: 4,
                callbacks: { label: ctx => ` ${ctx.dataset.label}: ${formatBRL(ctx.parsed.y)}` }
            }
        },
        scales: {
            y: {
                stacked,
                beginAtZero: true,
                border: { display: false },
                ticks: { color: theme.text, maxTicksLimit: 6, callback: v => 'R$ ' + Number(v).toLocaleString('pt-BR', { notation: 'compact' }) },
                grid: { color: theme.grid }
            },
            x: { stacked, border: { display: false }, ticks: { color: theme.text }, grid: { display: false } }
        }
    };
}

// Linha do tempo de custos (somente manutenções concluídas)
function buildEvents(fuels, manuts) {
    return [
        ...fuels.map(f => ({
            kind: 'fuel', id: f.id, date: f.date, vehicle_id: f.vehicle_id, vehicle: f.vehicle,
            desc: `${FUEL_OPTIONS[f.fuel_type] || f.fuel_type || 'Combustível'} · ${formatNumber(f.liters, 2)} L${f.odometer > 0 ? ` · ${formatNumber(f.odometer, 0)} km` : ''}`,
            cost: parseFloat(f.cost) || 0
        })),
        ...completedMaintenances(manuts).map(m => ({
            kind: 'maint', id: m.id, date: m.date, vehicle_id: m.vehicle_id, vehicle: m.vehicle,
            desc: m.notes ? `${m.service} · ${m.notes}` : m.service,
            cost: parseFloat(m.cost) || 0
        }))
    ].sort((a, b) => ((parseAnyDate(b.date) || 0) - (parseAnyDate(a.date) || 0)) || (b.id - a.id));
}

const EVENT_BADGE = {
    fuel: '<span class="badge badge-primary"><i class="fa-solid fa-gas-pump"></i> Abastecimento</span>',
    maint: '<span class="badge badge-warning"><i class="fa-solid fa-wrench"></i> Manutenção</span>'
};

function eventRow(e, { withDesc = true } = {}) {
    const v = splitVehicleLabel(e.vehicle);
    return `
        <tr data-row>
            <td class="cell-muted nowrap">${escapeHtml(e.date)}</td>
            <td>${vehicleCell(v.name, v.plate)}</td>
            <td>${EVENT_BADGE[e.kind]}</td>
            ${withDesc ? `<td class="cell-muted">${escapeHtml(e.desc)}</td>` : ''}
            <td class="num cell-strong">${formatBRL(e.cost)}</td>
        </tr>`;
}

// ==========================================
// Indicadores das telas de cadastro
// ==========================================
async function updateRecordKpis() {
    if (document.getElementById('vehTotal')) {
        const vehicles = await fetchTable('vehicles');
        const count = s => vehicles.filter(v => v.status === s).length;
        setText('vehTotal', vehicles.length);
        setText('vehInactive', `${count('inactive')} inativo(s)`);
        setText('vehActive', count('available'));
        setText('vehInTrip', count('in_trip'));
        setText('vehMaintenance', count('maintenance'));
    }

    if (document.getElementById('fuelMonthCost')) {
        const [vehicles, fuels] = await Promise.all([fetchTable('vehicles'), fetchTable('fuels')]);
        const month = fuels.filter(inCurrentMonth);
        setText('fuelMonthCost', formatBRL(sumCost(month)));
        setText('fuelMonthCount', `${month.length} abastecimento(s) neste mês`);
        setText('fuelMonthLiters', `${formatNumber(month.reduce((a, f) => a + (parseFloat(f.liters) || 0), 0), 0)} L`);

        const recent = NexusAnalytics.filterByPeriod(fuels, 90).filter(f => f.price_per_liter > 0);
        const liters = recent.reduce((a, f) => a + (parseFloat(f.liters) || 0), 0);
        setText('fuelAvgPrice', liters > 0 ? formatBRL(sumCost(recent) / liters) : '—');

        const eff = NexusAnalytics.fleetEfficiency(vehicles, fuels);
        setText('fuelFleetEff', eff ? `${formatNumber(eff)} km/L` : '—');
    }

    if (document.getElementById('maintMonthCost')) {
        const [vehicles, fuels, manuts] = await Promise.all([fetchTable('vehicles'), fetchTable('fuels'), fetchTable('maintenances')]);
        const done = completedMaintenances(manuts);
        const month = done.filter(inCurrentMonth);
        const scheduled = manuts.filter(m => m.status === 'scheduled');
        const soon = scheduled.filter(m => {
            const d = parseAnyDate(m.scheduled_date);
            return d && (d - new Date()) / 86400000 <= 3;
        });

        setText('maintMonthCost', formatBRL(sumCost(month)));
        setText('maintMonthCount', `${month.length} serviço(s) concluído(s) neste mês`);
        setText('maintScheduled', scheduled.length);
        setText('maintScheduledInfo', `${soon.length} nos próximos 3 dias · ${manuts.filter(m => m.status === 'in_progress').length} em andamento`);
        setText('maintRatio', `${done.filter(m => m.kind === 'preventiva').length} × ${done.filter(m => m.kind !== 'preventiva').length}`);
        setText('maintAlerts', buildHealthAlerts(vehicles, manuts, fuels).length);
    }
}

// ==========================================
// Dashboard
// ==========================================
async function setupDashboard() {
    const [vehicles, fuels, allManuts, reminders] = await Promise.all([
        fetchTable('vehicles'), fetchTable('fuels'), fetchTable('maintenances'), fetchTable('reminders')
    ]);
    const manuts = completedMaintenances(allManuts);
    const all = [...fuels, ...manuts];
    const now = new Date();

    const hour = now.getHours();
    const greet = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
    const firstName = (currentUser ? currentUser.name : '').split(' ')[0];
    setText('dashGreeting', firstName ? `${greet}, ${firstName}` : greet);
    setText('dashDate', `${capitalize(now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }))} · ${currentUser && currentUser.company_name ? currentUser.company_name : 'resumo da sua frota'}`);

    // Custo do mês
    const totals = NexusAnalytics.monthlyTotals(all);
    const current = totals[NexusAnalytics.monthKey(now)] || 0;
    const previous = totals[NexusAnalytics.monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1))] || 0;
    setText('dashTotalCost', formatBRL(current));
    if (previous > 0) {
        const change = pct(current - previous, previous);
        const up = change > 0;
        setHTML('dashCostTrend', `<span class="trend ${up ? 'up' : 'down'}"><i class="fa-solid fa-arrow-${up ? 'up' : 'down'}"></i> ${formatNumber(Math.abs(change))}%</span> vs. mês anterior`);
    } else {
        setText('dashCostTrend', `Acumulado total: ${formatBRL(sumCost(all))}`);
    }

    // Eficiência
    const eff = NexusAnalytics.fleetEfficiency(vehicles, fuels);
    setText('dashEfficiency', eff ? `${formatNumber(eff)} km/L` : '—');
    setText('dashEfficiencyInfo', eff ? 'Calculada pela quilometragem' : 'Registre abastecimentos com quilometragem');

    // Frota
    const byStatus = s => vehicles.filter(v => v.status === s).length;
    setText('dashFleet', `${byStatus('available') + byStatus('in_trip')}/${vehicles.length}`);
    setText('dashFleetInfo', `${byStatus('in_trip')} em viagem · ${byStatus('maintenance')} em manutenção`);

    // Alertas
    const alerts = buildHealthAlerts(vehicles, allManuts, fuels);
    const pending = reminders.filter(r => !r.completed).sort((a, b) => (parseAnyDate(a.date) || 0) - (parseAnyDate(b.date) || 0));
    const due = pending.filter(r => ['overdue', 'urgent'].includes(reminderUrgency(r)));
    setText('dashAlertsCount', alerts.length + due.length);
    setText('dashAlertsInfo', `${alerts.length} de manutenção · ${due.length} prazo(s)`);
    setAlertBadge(alerts.length);

    // Gráfico de barras: 12 meses por categoria
    const months = NexusAnalytics.lastMonths([], 12);
    const idx = Object.fromEntries(months.map((m, i) => [m.key, i]));
    const series = { gasolina: Array(12).fill(0), etanol: Array(12).fill(0), diesel: Array(12).fill(0), outros: Array(12).fill(0), manutencao: Array(12).fill(0) };
    const addTo = (bucket, record) => {
        const d = parseAnyDate(record.date);
        const i = d ? idx[NexusAnalytics.monthKey(d)] : undefined;
        if (i !== undefined) series[bucket][i] += parseFloat(record.cost) || 0;
    };
    fuels.forEach(f => addTo(fuelCategory(f.fuel_type), f));
    manuts.forEach(m => addTo('manutencao', m));

    const p = chartTheme().palette;
    const categories = [
        { key: 'gasolina', label: 'Gasolina', color: p.blue },
        { key: 'etanol', label: 'Etanol', color: p.green },
        { key: 'diesel', label: 'Diesel', color: p.amber },
        { key: 'outros', label: 'GNV / Elétrico', color: p.violet },
        { key: 'manutencao', label: 'Manutenção', color: p.red }
    ];

    renderChart('dashboardChart', {
        type: 'bar',
        data: {
            labels: months.map(m => m.label),
            datasets: categories.map(c => ({ label: c.label, data: series[c.key], backgroundColor: c.color, borderRadius: 4, maxBarThickness: 26, stack: 'custos' }))
        },
        options: baseChartOptions({ stacked: true })
    });

    // Distribuição no ano
    const yearTotals = Object.fromEntries(categories.map(c => [c.key, 0]));
    fuels.filter(f => parseAnyDate(f.date)?.getFullYear() === now.getFullYear()).forEach(f => { yearTotals[fuelCategory(f.fuel_type)] += parseFloat(f.cost) || 0; });
    manuts.filter(m => parseAnyDate(m.date)?.getFullYear() === now.getFullYear()).forEach(m => { yearTotals.manutencao += parseFloat(m.cost) || 0; });
    const yearSum = Object.values(yearTotals).reduce((a, b) => a + b, 0);
    const used = categories.filter(c => yearTotals[c.key] > 0);

    if (yearSum === 0) {
        const box = document.getElementById('dashCostSplit')?.parentElement;
        if (box) box.outerHTML = emptyBlock({ icon: 'fa-chart-pie', text: 'Sem custos registrados neste ano.' });
    } else {
        renderChart('dashCostSplit', {
            type: 'doughnut',
            data: { labels: used.map(c => c.label), datasets: [{ data: used.map(c => yearTotals[c.key]), backgroundColor: used.map(c => c.color), borderWidth: 0, hoverOffset: 6 }] },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '72%',
                plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${formatBRL(ctx.parsed)}` } } }
            }
        });
        setHTML('dashCostSplitLegend', used.map(c => `
            <div class="row-between" style="padding: 7px 0; border-bottom: 1px solid var(--border);">
                <span class="row" style="gap: 8px; font-size: 13px;"><i style="width: 10px; height: 10px; border-radius: 3px; background: ${c.color};"></i> ${c.label}</span>
                <span style="font-size: 13px;"><strong class="tabular">${formatBRL(yearTotals[c.key])}</strong> <span class="text-subtle">· ${formatNumber(pct(yearTotals[c.key], yearSum), 0)}%</span></span>
            </div>`).join(''));
    }

    // Últimos lançamentos
    const recent = buildEvents(fuels, manuts).slice(0, 6);
    setHTML('dashRecentBody', recent.length
        ? recent.map(e => eventRow(e, { withDesc: false })).join('')
        : emptyRow(4, 'Nenhum lançamento ainda. Comece cadastrando um veículo.', 'fa-receipt'));

    // Alertas de manutenção
    setHTML('dashAlertsList', alerts.length
        ? alerts.slice(0, 4).map(a => `
            <button class="list-item" onclick="navigateTo('diagnostico')">
                <div class="list-icon ${a.type === 'critical' ? 'danger' : 'warning'}"><i class="fa-solid ${a.icon}"></i></div>
                <div class="list-content">
                    <div class="list-title">${escapeHtml(a.component)}</div>
                    <div class="list-sub">${escapeHtml(a.vehicle)}</div>
                </div>
                <span class="badge ${a.type === 'critical' ? 'badge-danger' : 'badge-warning'}">${a.value}%</span>
            </button>`).join('')
        : emptyBlock({ icon: 'fa-check', tone: 'success', title: 'Tudo em dia', text: 'Nenhum componente fora do intervalo.' }));

    // Prazos
    const URG = { overdue: ['danger', 'badge-danger'], urgent: ['warning', 'badge-warning'], normal: ['', ''] };
    setHTML('dashRemindersList', pending.length
        ? pending.slice(0, 4).map(r => {
            const u = URG[reminderUrgency(r)] || URG.normal;
            const d = parseAnyDate(r.date);
            return `
                <button class="list-item" onclick="navigateTo('agenda')">
                    <div class="list-icon ${u[0]}"><i class="fa-regular fa-calendar"></i></div>
                    <div class="list-content">
                        <div class="list-title">${escapeHtml(r.title)}</div>
                        <div class="list-sub">${d ? d.toLocaleDateString('pt-BR') : ''}</div>
                    </div>
                    <span class="badge ${u[1]}">${relativeDays(d)}</span>
                </button>`;
        }).join('')
        : emptyBlock({ icon: 'fa-calendar-check', tone: 'success', title: 'Sem prazos pendentes' }));
}

// ==========================================
// Cadastros
// ==========================================
async function setupVeiculos() {
    attachTableSearch('tableSearch', 'vehicleLogBody');
    await Promise.all([renderVehicleTable(), updateRecordKpis()]);
}

async function setupAbastecimento() {
    attachTableSearch('tableSearch', 'fuelLogBody');
    await Promise.all([renderFuelTable(), updateRecordKpis()]);
}

async function setupManutencao() {
    attachTableSearch('tableSearch', 'maintenanceLogBody');
    await Promise.all([renderMaintenanceTable(), updateRecordKpis()]);
}

// ==========================================
// Histórico
// ==========================================
async function setupHistorico() {
    const tbody = document.getElementById('historicoGeralBody');
    if (!tbody) return;

    const [vehicles, fuels, manuts] = await Promise.all([fetchTable('vehicles'), fetchTable('fuels'), fetchCompletedMaintenances()]);
    const events = buildEvents(fuels, manuts);

    const vehicleSel = document.getElementById('historicoVehicle');
    vehicleSel.innerHTML = '<option value="">Todos os veículos</option>' +
        vehicles.map(v => `<option value="${Number(v.id)}">${escapeHtml(`${v.plate} — ${v.brand} ${v.model}`)}</option>`).join('');

    const render = () => {
        const period = parseInt(document.getElementById('historicoPeriod').value, 10) || null;
        const vehicleId = vehicleSel.value;
        const kind = document.getElementById('historicoType').value;

        const filtered = NexusAnalytics.filterByPeriod(events, period)
            .filter(e => !vehicleId || String(e.vehicle_id) === vehicleId)
            .filter(e => !kind || e.kind === kind);

        setHTML('historicoResumo', `
            <span class="badge">${filtered.length} evento(s)</span>
            <span class="badge badge-primary">Total ${formatBRL(sumCost(filtered))}</span>`);

        tbody.innerHTML = filtered.length
            ? filtered.map(e => eventRow(e)).join('')
            : emptyRow(5, 'Nenhum evento encontrado para os filtros selecionados.', 'fa-filter');
    };

    ['historicoPeriod', 'historicoVehicle', 'historicoType'].forEach(id => document.getElementById(id).addEventListener('change', render));
    render();
}

// ==========================================
// Financeiro
// ==========================================
async function setupFinanceiro() {
    const tbody = document.getElementById('financeiroLogBody');
    if (!tbody) return;

    const [vehicles, fuels, manuts] = await Promise.all([fetchTable('vehicles'), fetchTable('fuels'), fetchCompletedMaintenances()]);
    const events = buildEvents(fuels, manuts);
    attachTableSearch('tableSearch', 'financeiroLogBody');

    const fuelMonths = NexusAnalytics.lastMonths(fuels, 6);
    const maintMonths = NexusAnalytics.lastMonths(manuts, 6);
    const p = chartTheme().palette;
    renderChart('finMonthlyChart', {
        type: 'bar',
        data: {
            labels: fuelMonths.map(m => m.label),
            datasets: [
                { label: 'Combustível', data: fuelMonths.map(m => m.total), backgroundColor: p.blue, borderRadius: 4, maxBarThickness: 34 },
                { label: 'Manutenção', data: maintMonths.map(m => m.total), backgroundColor: p.amber, borderRadius: 4, maxBarThickness: 34 }
            ]
        },
        options: baseChartOptions()
    });
    const sixMonthTotal = fuelMonths.reduce((a, m) => a + m.total, 0) + maintMonths.reduce((a, m) => a + m.total, 0);
    setText('finMonthlyAvg', formatBRL(sixMonthTotal / 6));

    const render = () => {
        const period = parseInt(document.getElementById('financeiroPeriod').value, 10) || null;
        const filtered = NexusAnalytics.filterByPeriod(events, period);
        const fuelTotal = sumCost(filtered.filter(e => e.kind === 'fuel'));
        const maintTotal = sumCost(filtered.filter(e => e.kind === 'maint'));
        const total = fuelTotal + maintTotal;

        setText('finTotal', formatBRL(total));
        setText('finCount', `${filtered.length} lançamento(s)`);
        setText('finFuel', formatBRL(fuelTotal));
        setText('finFuelShare', `${formatNumber(pct(fuelTotal, total), 0)}% do total`);
        setText('finMaint', formatBRL(maintTotal));
        setText('finMaintShare', `${formatNumber(pct(maintTotal, total), 0)}% do total`);

        tbody.innerHTML = filtered.length
            ? filtered.map(e => eventRow(e)).join('')
            : emptyRow(5, 'Nenhum gasto registrado no período.', 'fa-receipt');
        applyTableSearch('tableSearch', 'financeiroLogBody');

        const rows = vehicles.map(v => ({ v, t: sumCost(filtered.filter(e => String(e.vehicle_id) === String(v.id))) }))
            .filter(r => r.t > 0).sort((a, b) => b.t - a.t);
        const max = rows[0]?.t || 0;

        setHTML('finVehicleList', rows.length
            ? rows.map(r => `
                <div class="list-item">
                    <div class="list-content">
                        <div class="row-between">
                            <span class="list-title">${escapeHtml(`${r.v.brand} ${r.v.model}`)}</span>
                            <strong class="tabular" style="font-size: 13.5px;">${formatBRL(r.t)}</strong>
                        </div>
                        <div class="row-between" style="margin: 2px 0 6px;">
                            <span class="list-sub">${escapeHtml(r.v.plate)}</span>
                            <span class="list-sub">${formatNumber(pct(r.t, total), 0)}%</span>
                        </div>
                        <div class="progress"><div class="progress-bar" style="width: ${pct(r.t, max)}%;"></div></div>
                    </div>
                </div>`).join('')
            : emptyBlock({ icon: 'fa-car-side', text: 'Sem custos por veículo no período.' }));
    };

    document.getElementById('financeiroPeriod').addEventListener('change', render);
    render();
}

// ==========================================
// Saúde da frota
// ==========================================
async function setupSaude() {
    const container = document.getElementById('healthReportsContainer');
    if (!container) return;

    const [vehicles, fuels, manuts] = await Promise.all([fetchTable('vehicles'), fetchTable('fuels'), fetchTable('maintenances')]);
    const counts = { ok: 0, warn: 0, crit: 0 };

    if (vehicles.length === 0) {
        container.innerHTML = `<div class="card" style="grid-column: 1 / -1;">${emptyBlock({ icon: 'fa-car-side', title: 'Nenhum veículo cadastrado', text: 'Cadastre veículos para acompanhar a saúde da frota.' })}</div>`;
    } else {
        const tone = hp => hp >= 65 ? 'success' : hp >= 30 ? 'warning' : 'danger';
        const STATUS = { ok: ['badge-success', 'Em dia'], warn: ['badge-warning', 'Atenção'], crit: ['badge-danger', 'Crítico'] };
        const row = (icon, label, hp) => `
            <div class="health-row">
                <div class="health-row-top"><span><i class="fa-solid ${icon}"></i> ${label}</span><strong class="text-${tone(hp)}">${hp}%</strong></div>
                <div class="progress"><div class="progress-bar ${tone(hp)}" style="width: ${hp}%;"></div></div>
            </div>`;

        container.innerHTML = vehicles.map(v => {
            const h = evaluateVehicleHealth(v, manuts, fuels);
            counts[h.status]++;
            return `
                <div class="card health-card" data-status="${h.status}">
                    <div class="health-head">
                        <div>
                            <div class="health-name">${escapeHtml(v.brand)} ${escapeHtml(v.model)}</div>
                            <span class="plate" style="margin-top: 6px;">${escapeHtml(v.plate)}</span>
                        </div>
                        <span class="badge badge-dot ${STATUS[h.status][0]}">${STATUS[h.status][1]}</span>
                    </div>
                    ${row('fa-oil-can', 'Óleo do motor', h.engineHp)}
                    ${row('fa-circle-dot', 'Pneus', h.tiresHp)}
                    ${row('fa-compact-disc', 'Freios', h.breaksHp)}
                    <div class="cell-sub" style="margin-top: 12px;">${formatNumber(v.current_odometer, 0)} km · revisão a cada ${formatNumber(v.maintenance_interval_km, 0)} km</div>
                </div>`;
        }).join('');
    }

    setText('saudeOkCount', counts.ok);
    setText('saudeWarnCount', counts.warn);
    setText('saudeCritCount', counts.crit);
}

function filterHealthCards(targetStatus) {
    const container = document.getElementById('healthReportsContainer');
    if (!container) return;
    const kpis = document.querySelectorAll('.kpi[data-active-filter]');
    const target = Array.from(kpis).find(k => k.dataset.activeFilter === targetStatus);
    const deactivate = target && target.classList.contains('is-active');

    kpis.forEach(k => {
        const isTarget = k === target && !deactivate;
        k.classList.toggle('is-active', isTarget);
        k.classList.toggle('is-dimmed', !deactivate && !isTarget);
    });
    container.querySelectorAll('.health-card').forEach(card => {
        card.hidden = !deactivate && card.dataset.status !== targetStatus;
    });
}

// ==========================================
// Diagnóstico
// ==========================================
async function setupDiagnostico() {
    const container = document.getElementById('alertasContent');
    if (!container) return;

    const [vehicles, fuels, manuts] = await Promise.all([fetchTable('vehicles'), fetchTable('fuels'), fetchTable('maintenances')]);
    const alerts = buildHealthAlerts(vehicles, manuts, fuels);
    setAlertBadge(alerts.length);

    setText('diagCritical', alerts.filter(a => a.type === 'critical').length);
    setText('diagWarning', alerts.filter(a => a.type === 'warning').length);
    setText('diagVehicles', new Set(alerts.map(a => a.vehicleId)).size);
    setText('diagVehiclesInfo', `de ${vehicles.filter(v => v.status !== 'inactive').length} veículo(s) ativo(s)`);
    setText('diagCount', `${alerts.length} alerta(s)`);

    if (vehicles.length === 0) {
        container.innerHTML = emptyBlock({ icon: 'fa-car-side', title: 'Nenhum veículo cadastrado', text: 'Cadastre veículos para que o sistema acompanhe as manutenções.' });
        return;
    }
    if (alerts.length === 0) {
        container.innerHTML = emptyBlock({ icon: 'fa-check-double', tone: 'success', title: 'Nenhum alerta de manutenção', text: 'Todos os componentes estão dentro dos intervalos recomendados.' });
        return;
    }

    container.innerHTML = alerts.map(a => {
        const critical = a.type === 'critical';
        return `
            <div class="alert-item">
                <div class="list-icon ${critical ? 'danger' : 'warning'}"><i class="fa-solid ${a.icon}"></i></div>
                <div class="alert-item-body">
                    <div class="alert-item-title">
                        ${escapeHtml(a.component)}
                        <span class="badge ${critical ? 'badge-danger' : 'badge-warning'}">${critical ? 'Crítico' : 'Atenção'} · ${a.value}%</span>
                    </div>
                    <div class="list-sub" style="margin-top: 2px;">${escapeHtml(a.vehicle)}</div>
                    <div class="progress" style="max-width: 280px; margin-top: 8px;"><div class="progress-bar ${critical ? 'danger' : 'warning'}" style="width: ${a.value}%;"></div></div>
                    <div class="alert-item-desc">${escapeHtml(a.desc)}</div>
                    <div class="alert-item-rec"><i class="fa-solid fa-lightbulb"></i> ${escapeHtml(a.rec)}</div>
                </div>
                ${canManage() ? `<button class="btn btn-secondary btn-sm" onclick="navigateTo('manutencao')">Agendar</button>` : ''}
            </div>`;
    }).join('');
}

// ==========================================
// Eficiência
// ==========================================
async function setupComparador() {
    const tbody = document.getElementById('eficienciaLogBody');
    if (!tbody) return;

    const [vehicles, fuels, manuts] = await Promise.all([fetchTable('vehicles'), fetchTable('fuels'), fetchCompletedMaintenances()]);
    if (vehicles.length === 0) {
        tbody.innerHTML = emptyRow(6, 'Cadastre veículos para gerar o ranking.', 'fa-car-side');
        return;
    }

    const ranking = vehicles.map(v => ({
        v,
        eff: NexusAnalytics.vehicleEfficiency(v, fuels),
        cpk: NexusAnalytics.costPerKm(v, fuels, manuts)
    })).sort((a, b) => (b.eff?.kmPerLiter || -1) - (a.eff?.kmPerLiter || -1));

    const withData = ranking.filter(r => r.eff);
    const best = withData[0];
    const worst = withData[withData.length - 1];
    const fleet = NexusAnalytics.fleetEfficiency(vehicles, fuels);

    setText('cmpBest', best ? `${formatNumber(best.eff.kmPerLiter)} km/L` : '—');
    setText('cmpBestInfo', best ? `${best.v.brand} ${best.v.model} · ${best.v.plate}` : 'Dados insuficientes');
    setText('cmpFleet', fleet ? `${formatNumber(fleet)} km/L` : '—');
    setText('cmpFleetInfo', `${withData.length} de ${vehicles.length} veículo(s) com dados`);
    setText('cmpWorst', worst && withData.length > 1 ? `${formatNumber(worst.eff.kmPerLiter)} km/L` : '—');
    setText('cmpWorstInfo', worst && withData.length > 1 ? `${worst.v.brand} ${worst.v.model} · ${worst.v.plate}` : 'Necessário 2+ veículos com dados');

    const LABEL_BADGE = { 'Eficiência ótima': 'badge-success', 'Normal': 'badge-primary', 'Alto consumo': 'badge-danger' };
    tbody.innerHTML = ranking.map((r, idx) => {
        const has = !!r.eff;
        const label = efficiencyLabel(r.eff);
        return `
            <tr>
                <td><span class="rank ${has && idx === 0 ? 'gold' : ''}">${has ? idx + 1 : '—'}</span></td>
                <td>${vehicleCell(`${r.v.brand} ${r.v.model}`, r.v.plate, VEHICLE_TYPE_ICONS[r.v.vehicle_type] || 'fa-car-side')}</td>
                <td>
                    ${has ? `
                        <strong class="tabular">${formatNumber(r.eff.kmPerLiter, 2)} km/L</strong>
                        <div class="progress" style="max-width: 160px; margin-top: 6px;"><div class="progress-bar ${idx === 0 ? 'success' : ''}" style="width: ${pct(r.eff.kmPerLiter, best.eff.kmPerLiter)}%;"></div></div>`
                    : '<span class="text-subtle">Sem dados</span>'}
                </td>
                <td class="num">${r.cpk !== null ? formatBRL(r.cpk) : '—'}</td>
                <td class="num cell-muted">${has ? formatNumber(r.eff.distance, 0) + ' km' : '—'}</td>
                <td><span class="badge ${LABEL_BADGE[label] || ''}">${label}</span></td>
            </tr>`;
    }).join('');
}

// ==========================================
// Previsão
// ==========================================
async function setupPrevisao() {
    const [vehicles, fuels, allManuts] = await Promise.all([fetchTable('vehicles'), fetchTable('fuels'), fetchTable('maintenances')]);
    const manuts = completedMaintenances(allManuts);
    const months = NexusAnalytics.lastMonths([...fuels, ...manuts], 6);
    const values = months.map(m => m.total);
    const monthsWithData = values.filter(v => v > 0).length;
    const forecast = NexusAnalytics.linearForecast(values, 3);
    const lastRealized = values[values.length - 1];

    setText('prevMensal', formatBRL(forecast[0]));
    setText('prevBase', monthsWithData >= 2 ? `Base: ${monthsWithData} meses com lançamentos` : 'Poucos dados — use como referência');
    setText('prevTrimestral', formatBRL(forecast.reduce((a, b) => a + b, 0)));
    if (lastRealized > 0) {
        const change = pct(forecast[0] - lastRealized, lastRealized);
        setHTML('prevTrend', `<span class="trend ${change > 0 ? 'up' : 'down'}"><i class="fa-solid fa-arrow-${change > 0 ? 'up' : 'down'}"></i> ${formatNumber(Math.abs(change))}%</span> vs. mês atual`);
    } else {
        setText('prevTrend', 'Soma dos próximos 3 meses');
    }

    const alerts = buildHealthAlerts(vehicles, allManuts, fuels);
    setText('prevRisk', alerts.length ? alerts[0].component : 'Nenhuma pendente');
    setText('prevRiskInfo', alerts.length ? `${alerts[0].vehicle} · ${alerts[0].value}%` : 'Componentes dentro do intervalo');

    const theme = chartTheme();
    const options = baseChartOptions({ legend: false });
    options.plugins.tooltip.filter = item => item.parsed.y !== null;
    renderChart('forecastChart', {
        type: 'line',
        data: {
            labels: [...months.map(m => m.label), 'Mês +1', 'Mês +2', 'Mês +3'],
            datasets: [
                {
                    label: 'Realizado',
                    data: [...values, null, null, null],
                    borderColor: theme.palette.blue,
                    backgroundColor: 'rgba(59, 130, 246, 0.12)',
                    fill: true, tension: 0.35, borderWidth: 2.5, pointRadius: 4, pointBackgroundColor: theme.palette.blue
                },
                {
                    label: 'Projeção',
                    data: [...Array(values.length - 1).fill(null), lastRealized, ...forecast],
                    borderColor: theme.palette.amber,
                    borderDash: [6, 5],
                    fill: false, tension: 0.35, borderWidth: 2.5, pointRadius: 4, pointBackgroundColor: theme.palette.amber
                }
            ]
        },
        options
    });

    setHTML('prevTableBody', [
        ...months.map(m => ({ label: m.label, value: m.total, projected: false })),
        ...forecast.map((v, i) => ({ label: `Mês +${i + 1}`, value: v, projected: true }))
    ].map(r => `
        <tr>
            <td class="cell-strong">${escapeHtml(r.label)}</td>
            <td><span class="badge ${r.projected ? 'badge-warning' : 'badge-primary'}">${r.projected ? 'Projeção' : 'Realizado'}</span></td>
            <td class="num">${formatBRL(r.value)}</td>
        </tr>`).join(''));
}

// ==========================================
// Agenda
// ==========================================
async function setupAgenda() {
    const container = document.getElementById('agendaTimeline');
    if (!container) return;
    let activeTab = 'pending';

    // Migra lembretes antigos que ficavam só no navegador
    try {
        const legacy = JSON.parse(localStorage.getItem('fcs_reminders') || '[]');
        if (canManage() && Array.isArray(legacy) && legacy.length) {
            for (const r of legacy) {
                await apiSend('/api/data/reminders', 'POST', { title: r.title, date: r.date, description: r.desc, completed: !!r.completed });
            }
            localStorage.removeItem('fcs_reminders');
            showToast(`${legacy.length} lembrete(s) antigo(s) importado(s).`, 'info');
        }
    } catch (e) { /* ignora dados antigos inválidos */ }

    const dateInput = document.getElementById('reminderDate');
    if (dateInput) dateInput.min = todayIso();

    const render = async () => {
        const reminders = await fetchTable('reminders');
        const pendingList = reminders.filter(r => !r.completed);
        setText('agendaPendingCount', pendingList.length);
        setText('agendaDoneCount', reminders.length - pendingList.length);

        const filtered = reminders
            .filter(r => activeTab === 'pending' ? !r.completed : r.completed)
            .sort((a, b) => (parseAnyDate(a.date) || 0) - (parseAnyDate(b.date) || 0));

        if (filtered.length === 0) {
            container.innerHTML = activeTab === 'pending'
                ? emptyBlock({ icon: 'fa-calendar-check', tone: 'success', title: 'Nenhum compromisso pendente', text: 'Adicione prazos como IPVA, licenciamento e seguros.' })
                : emptyBlock({ icon: 'fa-box-archive', title: 'Nenhum compromisso concluído' });
            return;
        }

        const TAG = { overdue: '<span class="badge badge-danger">Vencido</span>', urgent: '<span class="badge badge-warning">Próximo</span>' };
        container.innerHTML = filtered.map(r => {
            const d = parseAnyDate(r.date);
            const urgency = reminderUrgency(r);
            const id = Number(r.id);
            let actions = '';
            if (canManage()) {
                actions = (r.completed
                    ? iconButton(`toggleReminder(${id}, false)`, 'fa-solid fa-rotate-left', 'Reativar')
                    : `<button class="btn btn-success-soft btn-sm" onclick="toggleReminder(${id}, true)"><i class="fa-solid fa-check"></i> Concluir</button>`)
                    + iconButton(`deleteReminder(${id})`, 'fa-regular fa-trash-can', 'Excluir', 'danger');
            }

            return `
                <div class="agenda-item is-${urgency}">
                    <div class="agenda-date">
                        <span class="month">${d ? d.toLocaleString('pt-BR', { month: 'short' }).replace('.', '') : '--'}</span>
                        <span class="day">${d ? String(d.getDate()).padStart(2, '0') : '--'}</span>
                    </div>
                    <div class="list-content">
                        <div class="row" style="gap: 8px;"><span class="list-title">${escapeHtml(r.title)}</span>${TAG[urgency] || ''}</div>
                        <div class="list-sub">${escapeHtml(r.description || 'Sem descrição')}</div>
                        <div class="list-sub text-subtle">${r.completed ? `Concluído em ${escapeHtml(r.completed_at || '')}` : `${d ? d.getFullYear() : ''} · ${relativeDays(d)}`}</div>
                    </div>
                    <div class="agenda-actions">${actions}</div>
                </div>`;
        }).join('');
    };

    window.switchAgendaTab = (tab) => {
        activeTab = tab;
        document.getElementById('btnAgendaPending').classList.toggle('active', tab === 'pending');
        document.getElementById('btnAgendaCompleted').classList.toggle('active', tab === 'completed');
        render();
    };

    window.toggleReminder = async (id, completed) => {
        const { ok, data } = await apiSend(`/api/data/reminders/${id}`, 'PUT', { completed });
        if (!ok) return showToast(data.error || 'Não foi possível atualizar o compromisso.', 'error');
        showToast(completed ? 'Compromisso concluído.' : 'Compromisso reativado.');
        render();
    };

    window.deleteReminder = async (id) => {
        if (!confirm('Excluir este compromisso?')) return;
        const { ok, data } = await apiSend(`/api/data/reminders/${id}`, 'DELETE');
        if (!ok) return showToast(data.error || 'Não foi possível excluir o compromisso.', 'error');
        render();
    };

    const form = document.getElementById('reminderForm');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = form.elements; // evita conflito com form.title (propriedade nativa)
        if (!f.title.value.trim() || !f.date.value) return showToast('Informe o título e a data limite.', 'error');

        const { ok, data } = await apiSend('/api/data/reminders', 'POST', {
            title: f.title.value,
            date: f.date.value,
            description: f.desc.value
        });
        if (!ok) return showToast(data.error || 'Não foi possível salvar o compromisso.', 'error');
        showToast('Compromisso agendado.');
        form.reset();
        if (activeTab !== 'pending') window.switchAgendaTab('pending');
        else render();
        loadNotifications();
    });

    await render();
}

// ==========================================
// Mapa de postos
// ==========================================
function stationPopupHtml(name, prices, lat, lng, extraHtml = '') {
    const rows = prices
        .filter(([, value]) => value)
        .map(([label, value]) => `
            <div style="display:flex; justify-content:space-between; gap:16px; font-size:13px; padding:3px 0;">
                <span style="color:#64748b;">${escapeHtml(label)}</span>
                <strong style="color:#0f172a;">${formatBRL(value)}</strong>
            </div>`).join('');
    return `
        <div style="font-family: Inter, sans-serif; min-width: 200px;">
            <div style="font-weight:600; font-size:14px; color:#0f172a; margin-bottom:8px;">${escapeHtml(name)}</div>
            ${rows}
            <a href="https://www.google.com/maps/dir/?api=1&destination=${Number(lat)},${Number(lng)}" target="_blank" rel="noopener noreferrer"
               style="display:block; margin-top:10px; text-align:center; background:#2563eb; color:#fff; padding:7px 0; border-radius:8px; font-size:13px; font-weight:600; text-decoration:none;">
                Abrir rota no GPS
            </a>
            ${extraHtml}
        </div>`;
}

async function setupMapaPostos() {
    if (!document.getElementById('fleetMap') || typeof L === 'undefined') return;

    const map = L.map('fleetMap', { zoomControl: true }).setView([-22.8, -47.15], 11);
    L.tileLayer(tileLayerUrl(), { attribution: '&copy; OpenStreetMap &copy; CARTO', maxZoom: 19 }).addTo(map);

    const marker = (lat, lng, color) => L.circleMarker([lat, lng], { radius: 8, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1 });

    DEFAULT_STATIONS.forEach(st => {
        marker(st.lat, st.lng, '#2563eb').addTo(map).bindPopup(
            stationPopupHtml(st.name, [['Gasolina', st.gas], ['Etanol', st.eta], ['Diesel S10', st.die]], st.lat, st.lng)
        );
    });

    const userLayer = L.layerGroup().addTo(map);
    let tempMarker = null;

    const renderUserStations = async () => {
        const stations = await fetchTable('stations');
        userLayer.clearLayers();
        stations.forEach(s => {
            marker(s.lat, s.lng, '#16a34a').addTo(userLayer).bindPopup(stationPopupHtml(
                s.name,
                [['Gasolina', s.price_gas], ['Gasolina aditivada', s.price_gas_ad], ['Etanol', s.price_alcool], ['Diesel S10', s.price_diesel], ['GNV', s.price_gnv]],
                s.lat, s.lng,
                canManage() ? `<button onclick="deleteStation(${Number(s.id)})" style="width:100%; margin-top:6px; background:#fef2f2; color:#dc2626; border:0; padding:7px; border-radius:8px; cursor:pointer; font-weight:600;">Remover posto</button>` : ''
            ));
        });

        setHTML('myStationsBody', stations.length
            ? stations.map(s => `
                <tr>
                    <td>${vehicleCell(s.name, `${Number(s.lat).toFixed(4)}, ${Number(s.lng).toFixed(4)}`, 'fa-gas-pump')}</td>
                    <td class="num">${s.price_gas ? formatBRL(s.price_gas) : '—'}</td>
                    <td class="num">${s.price_alcool ? formatBRL(s.price_alcool) : '—'}</td>
                    <td class="num">${s.price_diesel ? formatBRL(s.price_diesel) : '—'}</td>
                    <td class="actions">
                        ${iconButton(`focusStation(${Number(s.lat)}, ${Number(s.lng)})`, 'fa-solid fa-location-crosshairs', 'Ver no mapa')}
                        ${canManage() ? iconButton(`deleteStation(${Number(s.id)})`, 'fa-regular fa-trash-can', 'Remover', 'danger') : ''}
                    </td>
                </tr>`).join('')
            : emptyRow(5, 'Nenhum posto cadastrado. Clique no mapa para começar.', 'fa-gas-pump'));
    };

    map.on('click', e => {
        const { lat, lng } = e.latlng;
        document.getElementById('formLat').value = lat.toFixed(6);
        document.getElementById('formLng').value = lng.toFixed(6);
        document.getElementById('formCoords').value = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        if (tempMarker) tempMarker.setLatLng(e.latlng);
        else tempMarker = L.marker(e.latlng).addTo(map);
        tempMarker.bindPopup('O novo posto será cadastrado aqui').openPopup();
        document.getElementById('stationName').focus({ preventScroll: true });
    });

    window.deleteStation = async (id) => {
        if (!confirm('Remover este posto do mapa?')) return;
        const { ok, data } = await apiSend(`/api/data/stations/${id}`, 'DELETE');
        if (!ok) return showToast(data.error || 'Não foi possível remover o posto.', 'error');
        map.closePopup();
        showToast('Posto removido.');
        renderUserStations();
    };

    window.focusStation = (lat, lng) => {
        map.setView([lat, lng], 16);
        document.getElementById('fleetMap').scrollIntoView({ behavior: 'smooth', block: 'center' });
    };

    const form = document.getElementById('stationForm');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = form.elements; // evita conflito com form.name (atributo nativo)
        if (!f.lat.value || !f.lng.value) return showToast('Clique no mapa para definir a localização do posto.', 'error');
        const payload = {};
        ['name', 'lat', 'lng', 'price_gas', 'price_gas_ad', 'price_alcool', 'price_diesel', 'price_gnv'].forEach(k => { payload[k] = f[k].value; });

        const { ok, data } = await apiSend('/api/data/stations', 'POST', payload);
        if (!ok) return showToast(data.error || 'Não foi possível cadastrar o posto.', 'error');

        showToast('Posto adicionado ao mapa!');
        form.reset();
        f.lat.value = f.lng.value = '';
        if (tempMarker) { map.removeLayer(tempMarker); tempMarker = null; }
        renderUserStations();
    });

    await renderUserStations();
    setTimeout(() => map.invalidateSize(), 300);
}

// ==========================================
// Assistente (responde com base nos dados reais)
// ==========================================
function normalizeText(text) {
    // Remove acentos: "manutenção" -> "manutencao"
    return text.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

function answerQuestion(question, { vehicles, fuels, manuts, allManuts, reminders }) {
    const q = normalizeText(question);
    const has = (...words) => words.some(w => q.includes(w));
    const label = v => `${v.brand} ${v.model} (${v.plate})`;

    if (has('ajuda', 'o que voce faz', 'comandos')) {
        return 'Posso responder sobre:\n- *Resumo geral da operação*\n- *Gasto do mês* ou *gasto total*\n- *Veículo mais econômico*\n- *Veículo com mais gastos* ou *mais manutenções*\n- *Preço médio do combustível*\n- *Veículos que precisam de revisão*\n- *Próximos prazos da agenda*';
    }
    if (/^(ola|oi|bom dia|boa tarde|boa noite)\b/.test(q)) {
        return 'Olá! Como posso ajudar com a sua frota hoje? Digite **ajuda** para ver o que posso responder.';
    }
    if (has('resumo', 'visao geral')) {
        const total = sumCost(fuels) + sumCost(manuts);
        const eff = NexusAnalytics.fleetEfficiency(vehicles, fuels);
        const alerts = buildHealthAlerts(vehicles, allManuts, fuels);
        return `**Resumo da operação**\n- Veículos: **${vehicles.length}** (${vehicles.filter(v => v.status === 'in_trip').length} em viagem, ${vehicles.filter(v => v.status === 'maintenance').length} em manutenção)\n- Despesa total: **${formatBRL(total)}**\n- Abastecimentos: **${fuels.length}** · Manutenções concluídas: **${manuts.length}**\n- Eficiência média: **${eff ? formatNumber(eff) + ' km/L' : 'sem dados suficientes'}**\n- Alertas de manutenção: **${alerts.length}**`;
    }
    if (has('economico', 'eficien', 'melhor consumo', 'km/l')) {
        const ranked = vehicles.map(v => ({ v, e: NexusAnalytics.vehicleEfficiency(v, fuels) })).filter(r => r.e)
            .sort((a, b) => b.e.kmPerLiter - a.e.kmPerLiter);
        if (!ranked.length) return 'Ainda não há dados suficientes. Registre pelo menos **2 abastecimentos com quilometragem** por veículo.';
        const best = ranked[0], worst = ranked[ranked.length - 1];
        return `O veículo mais econômico é o **${label(best.v)}**, com **${formatNumber(best.e.kmPerLiter, 2)} km/L**.` +
            (ranked.length > 1 ? `\nO de maior consumo é o **${label(worst.v)}**, com **${formatNumber(worst.e.kmPerLiter, 2)} km/L**.` : '');
    }
    if (has('mais manutencao', 'mais quebra', 'oficina', 'pior veiculo')) {
        if (!manuts.length) return 'Não há manutenções concluídas na frota.';
        const count = {};
        manuts.forEach(m => { count[m.vehicle] = (count[m.vehicle] || 0) + 1; });
        const [name, n] = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
        return `O veículo com mais manutenções é o **${name}**, com **${n}** registro(s).`;
    }
    if (has('mais gasto', 'mais caro', 'maior custo', 'mais custo')) {
        if (!fuels.length && !manuts.length) return 'Ainda não há custos registrados.';
        const costs = {};
        [...fuels, ...manuts].forEach(r => { costs[r.vehicle] = (costs[r.vehicle] || 0) + (parseFloat(r.cost) || 0); });
        const [name, value] = Object.entries(costs).sort((a, b) => b[1] - a[1])[0];
        return `O maior centro de custos é o **${name}**, com **${formatBRL(value)}** (combustível + manutenção). Veja o detalhamento com pedágios e multas em **Relatórios de custos**.`;
    }
    if (has('preco medio', 'media de preco', 'preco do combustivel', 'litro')) {
        const priced = fuels.filter(f => f.price_per_liter > 0);
        if (!priced.length) return 'Ainda não há abastecimentos com preço registrado.';
        const liters = priced.reduce((a, f) => a + (parseFloat(f.liters) || 0), 0);
        return `O preço médio pago é de **${formatBRL(sumCost(priced) / liters)}** por litro, considerando ${priced.length} abastecimento(s).`;
    }
    if (has('revisao', 'risco', 'quebrar', 'saude', 'alerta', 'manutencao')) {
        const alerts = buildHealthAlerts(vehicles, allManuts, fuels);
        const scheduled = allManuts.filter(m => m.status === 'scheduled').length;
        if (!vehicles.length) return 'Não há veículos cadastrados.';
        if (!alerts.length) return `Nenhum veículo está fora dos intervalos de manutenção recomendados. Há **${scheduled}** manutenção(ões) agendada(s).`;
        return `Há **${alerts.length}** alerta(s) e **${scheduled}** manutenção(ões) agendada(s). Os mais urgentes:\n` +
            alerts.slice(0, 3).map(a => `- **${a.vehicle}**: ${a.component} (${a.value}%)`).join('\n');
    }
    if (has('agenda', 'prazo', 'vencimento', 'ipva', 'licenciamento', 'seguro')) {
        const pending = reminders.filter(r => !r.completed).sort((a, b) => (parseAnyDate(a.date) || 0) - (parseAnyDate(b.date) || 0));
        if (!pending.length) return 'Não há compromissos pendentes na agenda. Documentos como licenciamento e seguro ficam na tela **Documentos**.';
        return 'Próximos compromissos:\n' + pending.slice(0, 3)
            .map(r => `- **${r.title}** em ${parseAnyDate(r.date)?.toLocaleDateString('pt-BR')}${reminderUrgency(r) === 'overdue' ? ' (vencido!)' : ''}`).join('\n');
    }
    if (has('mes')) {
        const key = NexusAnalytics.monthKey(new Date());
        const f = NexusAnalytics.monthlyTotals(fuels)[key] || 0;
        const m = NexusAnalytics.monthlyTotals(manuts)[key] || 0;
        return `Neste mês foram gastos **${formatBRL(f + m)}** (${formatBRL(f)} em combustível e ${formatBRL(m)} em manutenção).`;
    }
    if (has('gasto', 'custo', 'despesa', 'total')) {
        const f = sumCost(fuels), m = sumCost(manuts);
        return `O gasto total registrado é **${formatBRL(f + m)}** (${formatBRL(f)} em combustível e ${formatBRL(m)} em manutenção).`;
    }
    if (has('veiculo', 'frota', 'carro')) {
        const byStatus = s => vehicles.filter(v => v.status === s).length;
        return `Você possui **${vehicles.length}** veículo(s): ${byStatus('available')} disponível(is), ${byStatus('in_trip')} em viagem, ${byStatus('maintenance')} em manutenção e ${byStatus('inactive')} inativo(s).`;
    }
    return 'Desculpe, não entendi. Digite **ajuda** para ver exemplos de perguntas.';
}

async function setupAssistente() {
    const btn = document.getElementById('aiChatSend');
    const inp = document.getElementById('aiChatInput');
    const box = document.getElementById('aiChatBox');
    if (!btn || !inp || !box) return;

    const appendMessage = (html, fromUser) => {
        const wrapper = document.createElement('div');
        wrapper.className = `chat-msg ${fromUser ? 'chat-user' : 'chat-bot'}`;
        wrapper.innerHTML = `
            <div class="chat-avatar"><i class="fa-solid ${fromUser ? 'fa-user' : 'fa-wand-magic-sparkles'}"></i></div>
            <div class="chat-bubble">${html}</div>`;
        box.appendChild(wrapper);
        box.scrollTop = box.scrollHeight;
        return wrapper;
    };

    const sendMsg = async (preset) => {
        const text = (preset ?? inp.value).trim();
        if (!text || btn.disabled) return;
        appendMessage(escapeHtml(text), true);
        inp.value = '';
        btn.disabled = true;

        const typing = appendMessage('<span class="spinner" style="width:14px;height:14px;display:inline-block;vertical-align:middle;"></span>', false);
        const [vehicles, fuels, allManuts, reminders] = await Promise.all([
            fetchTable('vehicles'), fetchTable('fuels'), fetchTable('maintenances'), fetchTable('reminders')
        ]);
        typing.remove();
        appendMessage(renderRichText(answerQuestion(text, { vehicles, fuels, manuts: completedMaintenances(allManuts), allManuts, reminders })), false);
        btn.disabled = false;
        inp.focus();
    };

    btn.addEventListener('click', () => sendMsg());
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMsg(); });
    document.querySelectorAll('[data-question]').forEach(chip => {
        chip.addEventListener('click', () => sendMsg(chip.dataset.question));
    });
}
