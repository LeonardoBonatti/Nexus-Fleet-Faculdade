// =========================================================================
// NexusFleet — Exportação de relatórios em PDF e Excel (RF15)
// =========================================================================

// Formatos de coluna: money | number0 | number1 | number2 | int | text
function formatReportCell(value, format) {
    if (value === null || value === undefined || value === '') return '—';
    switch (format) {
        case 'money': return formatBRL(value);
        case 'number0': return formatNumber(value, 0);
        case 'number1': return formatNumber(value, 1);
        case 'number2': return formatNumber(value, 2);
        case 'int': return String(Math.round(value));
        default: return String(value);
    }
}

const isNumericFormat = format => ['money', 'number0', 'number1', 'number2', 'int'].includes(format);
const sumColumn = (rows, index) => rows.reduce((a, r) => a + (Number(r[index]) || 0), 0);

// ==========================================
// Montagem dos relatórios de cada tela
// ==========================================
const REPORT_BUILDERS = {
    async dashboard() {
        const [vehicles, fuels, allManuts, reminders] = await Promise.all([fetchTable('vehicles'), fetchTable('fuels'), fetchTable('maintenances'), fetchTable('reminders')]);
        const manuts = completedMaintenances(allManuts);
        const monthCost = NexusAnalytics.monthlyTotals([...fuels, ...manuts])[NexusAnalytics.monthKey(new Date())] || 0;
        const eff = NexusAnalytics.fleetEfficiency(vehicles, fuels);
        const alerts = buildHealthAlerts(vehicles, allManuts, fuels);
        const byStatus = s => vehicles.filter(v => v.status === s).length;
        return {
            title: 'Relatório gerencial da frota',
            headers: ['Indicador', 'Valor', 'Observação'],
            rows: [
                ['Custo do mês atual', formatBRL(monthCost), 'Combustível + manutenção'],
                ['Custo total acumulado', formatBRL([...fuels, ...manuts].reduce((a, r) => a + (parseFloat(r.cost) || 0), 0)), 'Todos os lançamentos'],
                ['Eficiência média da frota', eff ? `${formatNumber(eff)} km/L` : 'Dados insuficientes', 'Calculada pela quilometragem'],
                ['Veículos', String(vehicles.length), `${byStatus('available')} disponíveis · ${byStatus('in_trip')} em viagem · ${byStatus('maintenance')} em manutenção`],
                ['Abastecimentos', String(fuels.length), 'Registros de combustível'],
                ['Manutenções concluídas', String(manuts.length), `${allManuts.filter(m => m.status === 'scheduled').length} agendada(s)`],
                ['Alertas de manutenção', String(alerts.length), `${alerts.filter(a => a.type === 'critical').length} crítico(s)`],
                ['Prazos pendentes na agenda', String(reminders.filter(r => !r.completed).length), '']
            ]
        };
    },

    async veiculos() {
        const vehicles = await fetchTable('vehicles');
        return {
            title: 'Frota cadastrada',
            headers: ['Placa', 'Veículo', 'Tipo', 'Ano', 'Carga (kg)', 'Tanque (L)', 'Quilometragem', 'Combustível', 'Status'],
            formats: ['text', 'text', 'text', 'text', 'number0', 'number0', 'number0', 'text', 'text'],
            rows: vehicles.map(v => [v.plate, `${v.brand} ${v.model}`, VEHICLE_TYPES[v.vehicle_type] || v.vehicle_type, String(v.year || '—'),
                v.load_capacity_kg, v.capacity, v.current_odometer, v.fuel_type, STATUS_LABELS[v.status] || v.status])
        };
    },

    async motoristas() {
        const drivers = await fetchTable('drivers');
        return {
            title: 'Motoristas',
            subtitle: 'CPF e CNH exibidos mascarados (dados armazenados com criptografia).',
            headers: ['Nome', 'CPF', 'CNH', 'Categoria', 'Validade', 'Situação da CNH', 'Veículos', 'Status'],
            rows: drivers.map(d => [d.name, d.cpf_masked, d.cnh_masked, d.cnh_category, formatDateBR(d.cnh_expiry),
                (CNH_STATUS[d.cnh_status] || ['—'])[0], d.vehicle_plates.join(', ') || '—', d.status === 'active' ? 'Ativo' : 'Inativo'])
        };
    },

    async viagens() {
        const trips = await fetchTable('trips');
        const rows = trips.map(t => [
            `#${t.id}`, t.origin_name, t.destination_name, t.stops.length, `${t.vehicle_plate || ''} ${t.vehicle_name}`, t.driver_name,
            formatDateTimeBR(t.actual_start || t.planned_start), formatDateTimeBR(t.actual_end || t.planned_end),
            t.end_odometer && t.start_odometer ? t.end_odometer - t.start_odometer : null, t.toll_cost, (TRIP_STATUS[t.status] || ['—'])[0]
        ]);
        return {
            title: 'Viagens',
            headers: ['#', 'Origem', 'Destino', 'Paradas', 'Veículo', 'Motorista', 'Saída', 'Chegada', 'Km percorridos', 'Pedágios', 'Situação'],
            formats: ['text', 'text', 'text', 'int', 'text', 'text', 'text', 'text', 'number0', 'money', 'text'],
            rows,
            footer: ['Total', '', '', '', '', '', '', '', sumColumn(rows, 8), sumColumn(rows, 9), '']
        };
    },

    async abastecimento() {
        const fuels = await fetchTable('fuels');
        const rows = fuels.map(f => [f.date, f.vehicle, f.driver_name || '—', FUEL_OPTIONS[f.fuel_type] || f.fuel_type, f.liters, f.price_per_liter, f.odometer, f.km_per_liter, f.cost]);
        return {
            title: 'Abastecimentos',
            headers: ['Data', 'Veículo', 'Motorista', 'Combustível', 'Litros', 'Preço/L', 'Quilometragem', 'Consumo (km/L)', 'Total'],
            formats: ['text', 'text', 'text', 'text', 'number2', 'money', 'number0', 'number2', 'money'],
            rows,
            footer: ['Total', '', '', '', sumColumn(rows, 4), '', '', '', sumColumn(rows, 8)]
        };
    },

    async manutencao() {
        const manuts = await fetchTable('maintenances');
        const rows = manuts.map(m => [
            m.status === 'scheduled' ? formatDateBR(m.scheduled_date) : m.date, m.vehicle, m.kind === 'preventiva' ? 'Preventiva' : 'Corretiva',
            m.service, (MAINTENANCE_STATUS[m.status] || ['—'])[0], m.workshop || '—', m.odometer || null, m.cost
        ]);
        return {
            title: 'Manutenções',
            headers: ['Data', 'Veículo', 'Tipo', 'Serviço', 'Situação', 'Oficina', 'Quilometragem', 'Custo'],
            formats: ['text', 'text', 'text', 'text', 'text', 'text', 'number0', 'money'],
            rows,
            footer: ['Total (todas as situações)', '', '', '', '', '', '', sumColumn(rows, 7)]
        };
    },

    async ocorrencias() {
        const items = await fetchTable('occurrences');
        return {
            title: 'Ocorrências',
            headers: ['Data e hora', 'Veículo', 'Motorista', 'Tipo', 'Gravidade', 'Descrição', 'Situação', 'Solução'],
            rows: items.map(o => [formatDateTimeBR(o.occurred_at), `${o.vehicle_plate || ''} ${o.vehicle_name}`, o.driver_name || o.user_name || '—',
                OCCURRENCE_TYPES[o.type] || o.type, (OCCURRENCE_SEVERITY[o.severity] || ['—'])[0], o.description,
                o.status === 'open' ? 'Aberta' : 'Resolvida', o.resolution || '—'])
        };
    },

    async multas() {
        const fines = await fetchTable('fines');
        const rows = fines.map(f => [formatDateBR(f.infraction_date), f.infraction_time || '—', f.vehicle_plate, f.driver_name || 'Não identificado',
            f.description, (FINE_SEVERITY[f.severity] || ['—'])[0], f.points, f.amount, f.due_date ? formatDateBR(f.due_date) : '—', (FINE_STATUS[f.status] || ['—'])[0]]);
        return {
            title: 'Multas',
            headers: ['Data', 'Hora', 'Placa', 'Motorista', 'Infração', 'Gravidade', 'Pontos', 'Valor', 'Vencimento', 'Situação'],
            formats: ['text', 'text', 'text', 'text', 'text', 'text', 'int', 'money', 'text', 'text'],
            rows,
            footer: ['Total', '', '', '', '', '', sumColumn(rows, 6), sumColumn(rows, 7), '', '']
        };
    },

    async documentos() {
        const docs = await fetchTable('documents');
        const STATUS = { valid: 'Em dia', expiring: 'Vence em breve', expired: 'Vencido' };
        return {
            title: 'Documentos dos veículos',
            headers: ['Placa', 'Documento', 'Número', 'Emissor', 'Vencimento', 'Situação', 'Custo'],
            formats: ['text', 'text', 'text', 'text', 'text', 'text', 'money'],
            rows: docs.map(d => [d.vehicle_plate, DOC_LABELS[d.doc_type] || d.doc_type, d.number || '—', d.issuer || '—', formatDateBR(d.expiry_date), STATUS[d.doc_status], d.cost])
        };
    },

    async relatorios() {
        let report = lastCostReport;
        if (!report) report = await fetchJSON('/api/reports/costs', null);
        if (!report) return null;
        const t = report.totals;
        return {
            title: 'Relatório de custos por veículo',
            subtitle: `Período: ${formatDateBR(report.period.start)} a ${formatDateBR(report.period.end)}`,
            summary: [
                ['Custo total', formatBRL(t.total)], ['Combustível', formatBRL(t.fuel)], ['Manutenção', formatBRL(t.maintenance)],
                ['Pedágios', formatBRL(t.tolls)], ['Multas', formatBRL(t.fines)], ['Km em viagens', `${formatNumber(t.km, 0)} km`]
            ],
            headers: ['Placa', 'Veículo', 'Combustível', 'Manutenção', 'Pedágios', 'Multas', 'Total', 'Km', 'Custo/km'],
            formats: ['text', 'text', 'money', 'money', 'money', 'money', 'money', 'number0', 'money'],
            rows: report.rows.map(r => [r.plate, r.name, r.fuel, r.maintenance, r.tolls, r.fines, r.total, r.km, r.cost_per_km]),
            footer: ['Total', '', t.fuel, t.maintenance, t.tolls, t.fines, t.total, t.km, t.km ? t.total / t.km : null]
        };
    },

    async historico() {
        const [fuels, manuts] = await Promise.all([fetchTable('fuels'), fetchCompletedMaintenances()]);
        const rows = buildEvents(fuels, manuts).map(e => [e.date, e.vehicle, e.kind === 'fuel' ? 'Abastecimento' : 'Manutenção', e.desc, e.cost]);
        return {
            title: 'Linha do tempo da frota',
            headers: ['Data', 'Veículo', 'Tipo', 'Descrição', 'Valor'],
            formats: ['text', 'text', 'text', 'text', 'money'],
            rows,
            footer: ['Total', '', '', '', sumColumn(rows, 4)]
        };
    },

    async financeiro() {
        const [fuels, manuts] = await Promise.all([fetchTable('fuels'), fetchCompletedMaintenances()]);
        const rows = buildEvents(fuels, manuts).map(e => [e.date, e.kind === 'fuel' ? 'Combustível' : 'Manutenção', e.vehicle, e.desc, e.cost]);
        return {
            title: 'Extrato financeiro',
            headers: ['Data', 'Categoria', 'Veículo', 'Descrição', 'Valor'],
            formats: ['text', 'text', 'text', 'text', 'money'],
            rows,
            footer: ['Total', '', '', '', sumColumn(rows, 4)]
        };
    },

    async comparador() {
        const [vehicles, fuels, manuts] = await Promise.all([fetchTable('vehicles'), fetchTable('fuels'), fetchCompletedMaintenances()]);
        return {
            title: 'Ranking de eficiência',
            headers: ['Placa', 'Veículo', 'Consumo (km/L)', 'Distância medida (km)', 'Custo por km', 'Avaliação'],
            formats: ['text', 'text', 'number2', 'number0', 'money', 'text'],
            rows: vehicles.map(v => {
                const e = NexusAnalytics.vehicleEfficiency(v, fuels);
                return [v.plate, `${v.brand} ${v.model}`, e ? e.kmPerLiter : null, e ? e.distance : null, NexusAnalytics.costPerKm(v, fuels, manuts), efficiencyLabel(e)];
            }).sort((a, b) => (b[2] || 0) - (a[2] || 0))
        };
    },

    async previsao() {
        const [fuels, manuts] = await Promise.all([fetchTable('fuels'), fetchCompletedMaintenances()]);
        const months = NexusAnalytics.lastMonths([...fuels, ...manuts], 6);
        const forecast = NexusAnalytics.linearForecast(months.map(m => m.total), 3);
        return {
            title: 'Previsão de despesas',
            subtitle: 'Projeção por regressão linear sobre os últimos 6 meses.',
            headers: ['Mês', 'Valor', 'Tipo'],
            formats: ['text', 'money', 'text'],
            rows: [...months.map(m => [m.label, m.total, 'Realizado']), ...forecast.map((v, i) => [`Mês +${i + 1}`, v, 'Projeção'])]
        };
    },

    async saude() {
        const [vehicles, fuels, manuts] = await Promise.all([fetchTable('vehicles'), fetchTable('fuels'), fetchTable('maintenances')]);
        return {
            title: 'Saúde estimada da frota',
            headers: ['Placa', 'Veículo', 'Óleo (%)', 'Pneus (%)', 'Freios (%)', 'Situação'],
            formats: ['text', 'text', 'int', 'int', 'int', 'text'],
            rows: vehicles.map(v => {
                const h = evaluateVehicleHealth(v, manuts, fuels);
                return [v.plate, `${v.brand} ${v.model}`, h.engineHp, h.tiresHp, h.breaksHp, h.status === 'crit' ? 'Crítico' : h.status === 'warn' ? 'Atenção' : 'Em dia'];
            })
        };
    },

    async diagnostico() {
        const [vehicles, fuels, manuts] = await Promise.all([fetchTable('vehicles'), fetchTable('fuels'), fetchTable('maintenances')]);
        const alerts = buildHealthAlerts(vehicles, manuts, fuels);
        return {
            title: 'Diagnóstico de manutenção',
            headers: ['Gravidade', 'Componente', 'Veículo', 'Situação', 'Recomendação'],
            rows: alerts.length
                ? alerts.map(a => [a.type === 'critical' ? 'Crítico' : 'Atenção', a.component, a.vehicle, a.desc, a.rec])
                : [['OK', '—', 'Todos', 'Nenhum alerta de manutenção.', '—']]
        };
    },

    async agenda() {
        const reminders = await fetchTable('reminders');
        return {
            title: 'Agenda de obrigações',
            headers: ['Data limite', 'Título', 'Descrição', 'Situação'],
            rows: reminders.map(r => [formatDateBR(r.date), r.title, r.description || '', r.completed ? `Concluído em ${r.completed_at || ''}` : 'Pendente'])
        };
    },

    async mapa_postos() {
        const stations = await fetchTable('stations');
        return {
            title: 'Postos de combustível',
            headers: ['Posto', 'Origem', 'Gasolina', 'Etanol', 'Diesel S10'],
            formats: ['text', 'text', 'money', 'money', 'money'],
            rows: [
                ...stations.map(s => [s.name, 'Cadastrado', s.price_gas, s.price_alcool, s.price_diesel]),
                ...DEFAULT_STATIONS.map(s => [s.name, 'Referência', s.gas, s.eta, s.die])
            ]
        };
    },

    async usuarios() {
        const users = await fetchJSON('/api/team', []);
        return {
            title: 'Usuários e perfis de acesso',
            headers: ['Nome', 'E-mail', 'Perfil', 'Cargo', 'Motorista vinculado', 'Último acesso', 'Situação'],
            rows: users.map(u => [u.name, u.email, ROLE_LABELS[u.role] || u.role, u.cargo || '—', u.driver_name || '—',
                u.last_login_at ? formatUtcDateTime(u.last_login_at) : 'Nunca', u.active ? 'Ativo' : 'Inativo'])
        };
    },

    async auditoria() {
        return {
            title: 'Auditoria de alterações',
            subtitle: 'Registros exibidos na página atual da consulta.',
            headers: ['Data e hora', 'Usuário', 'Ação', 'Cadastro', 'Registro', 'Resumo'],
            rows: audit.items.map(i => [formatUtcDateTime(i.created_at), i.user_name || 'Sistema', (ACTION_LABELS[i.action] || [i.action])[0],
                ENTITY_LABELS[i.entity] || i.entity, i.entity_id ? `#${i.entity_id}` : '—', i.summary || '—'])
        };
    }
};

// ==========================================
// Botão "Exportar" (PDF / Excel) no cabeçalho das telas
// ==========================================
function injectExportButtons(page) {
    if (!REPORT_BUILDERS[page]) return;
    const header = document.querySelector('.page-header');
    if (!header || header.querySelector('.export-menu')) return;

    let actions = header.querySelector('.page-actions');
    if (!actions) {
        actions = document.createElement('div');
        actions.className = 'page-actions';
        header.appendChild(actions);
    }

    const wrap = document.createElement('div');
    wrap.className = 'menu-wrap export-menu';
    wrap.innerHTML = `
        <button type="button" class="btn btn-secondary" aria-haspopup="true"><i class="fa-solid fa-download"></i> Exportar <i class="fa-solid fa-chevron-down" style="font-size: 10px;"></i></button>
        <div class="dropdown" role="menu">
            <button type="button" class="dropdown-item" data-format="pdf"><i class="fa-regular fa-file-pdf" style="color: #dc2626;"></i> Relatório em PDF</button>
            <button type="button" class="dropdown-item" data-format="excel"><i class="fa-regular fa-file-excel" style="color: #16a34a;"></i> Planilha Excel</button>
        </div>`;

    const trigger = wrap.querySelector('button');
    const menu = wrap.querySelector('.dropdown');
    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.classList.toggle('open');
    });
    document.addEventListener('click', () => menu.classList.remove('open'));
    menu.querySelectorAll('[data-format]').forEach(item => item.addEventListener('click', () => {
        menu.classList.remove('open');
        exportPage(page, item.dataset.format, trigger);
    }));

    const primary = actions.querySelector('.btn-primary');
    if (primary) actions.insertBefore(wrap, primary);
    else actions.appendChild(wrap);
}

async function exportPage(page, format, btn) {
    const original = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;"></span> Gerando...'; }
    try {
        const report = await REPORT_BUILDERS[page]();
        if (!report || !report.rows.length) return showToast('Não há dados para exportar.', 'info');
        const filename = `nexusfleet_${page}_${todayIso()}`;
        if (format === 'pdf') exportToPDF(report, `${filename}.pdf`);
        else exportToExcel(report, `${filename}.xls`);
        showToast(`${format === 'pdf' ? 'PDF' : 'Planilha'} gerado com ${report.rows.length} registro(s).`);
    } catch (err) {
        console.error('Erro na exportação:', err);
        showToast('Ocorreu um erro ao gerar o arquivo.', 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = original; }
    }
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

// ==========================================
// PDF (jsPDF + AutoTable)
// ==========================================
// A fonte padrão do PDF não possui alguns símbolos (ex.: →)
const pdfText = value => String(value ?? '').replace(/→/g, '->').replace(/[^\x00-\xFF]/g, '');

function exportToPDF(report, filename) {
    if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('Biblioteca de PDF não carregada');
    const { jsPDF } = window.jspdf;
    const formats = report.formats || report.headers.map(() => 'text');
    const doc = new jsPDF({ orientation: report.headers.length > 5 ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    // Cabeçalho
    doc.setFillColor(11, 18, 32);
    doc.rect(0, 0, pageWidth, 70, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text('NexusFleet', 40, 32);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.text(pdfText(report.title), 40, 52);
    doc.setFontSize(8.5);
    doc.text(pdfText(`Gerado em ${new Date().toLocaleString('pt-BR')}`), pageWidth - 40, 32, { align: 'right' });
    doc.text(pdfText(`${currentUser ? currentUser.name : ''} · ${currentUser ? currentUser.company_name || '' : ''}`), pageWidth - 40, 46, { align: 'right' });

    let y = 94;
    doc.setTextColor(15, 23, 42);
    if (report.subtitle) {
        doc.setFontSize(10);
        doc.text(pdfText(report.subtitle), 40, y);
        y += 16;
    }

    if (report.summary && report.summary.length) {
        doc.autoTable({
            startY: y,
            body: [report.summary.map(([label, value]) => pdfText(`${label}: ${value}`))],
            theme: 'plain',
            styles: { fontSize: 9, fontStyle: 'bold', textColor: [30, 41, 59], cellPadding: 4 },
            margin: { left: 40, right: 40 }
        });
        y = doc.lastAutoTable.finalY + 10;
    }

    const columnStyles = {};
    formats.forEach((f, i) => { if (isNumericFormat(f)) columnStyles[i] = { halign: 'right' }; });

    doc.autoTable({
        startY: y,
        head: [report.headers.map(pdfText)],
        body: report.rows.map(row => row.map((cell, i) => pdfText(formatReportCell(cell, formats[i])))),
        foot: report.footer ? [report.footer.map((cell, i) => pdfText(cell === '' ? '' : formatReportCell(cell, formats[i])))] : undefined,
        theme: 'striped',
        styles: { fontSize: 8.5, cellPadding: 5, textColor: [30, 41, 59], lineColor: [226, 232, 240] },
        headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold' },
        footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        columnStyles,
        margin: { left: 40, right: 40, bottom: 40 },
        didDrawPage: () => {
            doc.setFontSize(8);
            doc.setTextColor(100, 116, 139);
            doc.text('NexusFleet · Sistema de Gestão de Frota', 40, pageHeight - 20);
            doc.text(`Página ${doc.internal.getNumberOfPages()}`, pageWidth - 40, pageHeight - 20, { align: 'right' });
        }
    });

    doc.save(filename);
}

// ==========================================
// Excel (.xls em HTML compatível)
// ==========================================
function exportToExcel(report, filename) {
    const formats = report.formats || report.headers.map(() => 'text');
    const cell = (value, format) => {
        if (isNumericFormat(format) && value !== null && value !== undefined && value !== '') {
            const numberFormat = format === 'money' ? '"R$ "\\#\\,\\#\\#0\\.00' : format === 'int' || format === 'number0' ? '\\#\\,\\#\\#0' : '\\#\\,\\#\\#0\\.00';
            return `<td style="mso-number-format:'${numberFormat}'; text-align: right;">${Number(value)}</td>`;
        }
        return `<td style="mso-number-format:'\\@';">${escapeHtml(value === null || value === undefined ? '' : value)}</td>`;
    };

    const html = `
        <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
        <head>
            <meta charset="utf-8">
            <!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>
                <x:Name>${escapeHtml(report.title.substring(0, 31))}</x:Name>
                <x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
            </x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
            <style>
                body { font-family: Calibri, 'Segoe UI', sans-serif; }
                th { background: #2563eb; color: #fff; font-weight: bold; text-align: left; padding: 8px; border: 1px solid #cbd5e1; }
                td { padding: 6px 8px; border: 1px solid #e2e8f0; color: #1e293b; }
                .title { font-size: 16pt; font-weight: bold; color: #0b1220; border: none; }
                .meta { font-size: 10pt; color: #64748b; border: none; }
                tfoot td { font-weight: bold; background: #f1f5f9; }
            </style>
        </head>
        <body>
            <table>
                <tr><td colspan="${report.headers.length}" class="title">NexusFleet — ${escapeHtml(report.title)}</td></tr>
                <tr><td colspan="${report.headers.length}" class="meta">Gerado em ${new Date().toLocaleString('pt-BR')} por ${escapeHtml(currentUser ? currentUser.name : '')}${report.subtitle ? ` · ${escapeHtml(report.subtitle)}` : ''}</td></tr>
                ${(report.summary || []).map(([label, value]) => `<tr><td class="meta">${escapeHtml(label)}</td><td class="meta" style="font-weight: bold; color: #0b1220;">${escapeHtml(value)}</td></tr>`).join('')}
                <tr></tr>
                <thead><tr>${report.headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
                <tbody>${report.rows.map(row => `<tr>${row.map((v, i) => cell(v, formats[i])).join('')}</tr>`).join('')}</tbody>
                ${report.footer ? `<tfoot><tr>${report.footer.map((v, i) => v === '' ? '<td></td>' : cell(v, formats[i])).join('')}</tr></tfoot>` : ''}
            </table>
        </body>
        </html>`;

    const BOM = String.fromCharCode(0xFEFF);
    downloadBlob(new Blob([BOM + html], { type: 'application/vnd.ms-excel;charset=utf-8' }), filename);
}

// Atalhos usados por botões das telas
function exportDashboardToPDF() {
    exportPage('dashboard', 'pdf', document.getElementById('btnExportPDF'));
}

async function exportFinanceiroCSV() {
    const report = await REPORT_BUILDERS.financeiro();
    if (!report.rows.length) return showToast('Não há dados financeiros para exportar.', 'info');

    // Prefixa valores iniciados com = + - @ para evitar injeção de fórmulas no Excel
    const safe = value => {
        let s = typeof value === 'number' ? value.toFixed(2).replace('.', ',') : String(value ?? '');
        if (/^[=+\-@]/.test(s)) s = `'${s}`;
        return `"${s.replace(/"/g, '""')}"`;
    };
    const csv = [report.headers, ...report.rows].map(row => row.map(safe).join(';')).join('\r\n');
    const BOM = String.fromCharCode(0xFEFF);
    downloadBlob(new Blob([BOM + csv], { type: 'text/csv;charset=utf-8' }), `nexusfleet_extrato_${todayIso()}.csv`);
}
