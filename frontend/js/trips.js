// =========================================================================
// NexusFleet — Viagens (RF10/RF11), checklist (RF12), quilometragem (RF03)
// e rastreamento em tempo real (RF07)
// =========================================================================

Object.assign(PAGE_SETUP, {
    viagens: setupViagens,
    rastreamento: setupRastreamento
});

const TRIP_STATUS = {
    planned: ['Planejada', 'badge-info'],
    in_progress: ['Em andamento', 'badge-primary'],
    completed: ['Concluída', 'badge-success'],
    cancelled: ['Cancelada', '']
};

function formatDuration(minutes) {
    if (!minutes && minutes !== 0) return '';
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return h ? `${h}h ${String(m).padStart(2, '0')}min` : `${m} min`;
}

function tripRouteLabel(trip) {
    return `${trip.origin_name} → ${trip.destination_name}`;
}

// ==========================================
// Lista de viagens
// ==========================================
let tripFilter = 'all';

async function setupViagens() {
    fleetRefresher = renderTrips;
    tripFilter = hasRole('motorista') ? 'active' : 'all';
    attachTableSearch('tableSearch', 'tripLogBody');

    document.querySelectorAll('#tripTabs button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === tripFilter);
        btn.addEventListener('click', () => {
            tripFilter = btn.dataset.filter;
            document.querySelectorAll('#tripTabs button').forEach(b => b.classList.toggle('active', b === btn));
            renderTrips();
        });
    });

    await Promise.all([renderTrips(), updateGpsCard()]);
}

async function renderTrips() {
    const tbody = document.getElementById('tripLogBody');
    if (!tbody) return;
    const trips = await fetchTable('trips');
    const now = new Date();
    const inMonth = t => {
        const d = parseAnyDate(t.actual_end);
        return d && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    };
    const doneMonth = trips.filter(t => t.status === 'completed' && inMonth(t));

    setText('tripPlanned', trips.filter(t => t.status === 'planned').length);
    setText('tripActive', trips.filter(t => t.status === 'in_progress').length);
    setText('tripDoneMonth', doneMonth.length);
    setText('tripKmMonth', `${formatNumber(doneMonth.reduce((a, t) => a + Math.max(0, (t.end_odometer || 0) - (t.start_odometer || 0)), 0), 0)} km`);

    const FILTERS = {
        all: () => true,
        active: t => ['planned', 'in_progress'].includes(t.status),
        planned: t => t.status === 'planned',
        in_progress: t => t.status === 'in_progress',
        completed: t => t.status === 'completed',
        cancelled: t => t.status === 'cancelled'
    };
    const order = { in_progress: 0, planned: 1, completed: 2, cancelled: 3 };
    const list = trips.filter(FILTERS[tripFilter] || FILTERS.all)
        .sort((a, b) => (order[a.status] - order[b.status]) || (a.status === 'planned'
            ? a.planned_start.localeCompare(b.planned_start)
            : (b.actual_start || b.planned_start).localeCompare(a.actual_start || a.planned_start)));

    if (!list.length) {
        tbody.innerHTML = emptyRow(7, hasRole('motorista') ? 'Você não possui viagens nesta situação.' : 'Nenhuma viagem nesta situação.', 'fa-diamond-turn-right');
        return;
    }

    tbody.innerHTML = list.map(t => {
        const [label, cls] = TRIP_STATUS[t.status] || TRIP_STATUS.planned;
        const details = [
            t.stops.length ? `${t.stops.length} parada(s)` : '',
            t.distance_km ? `${formatNumber(t.distance_km, 0)} km` : '',
            t.duration_min ? formatDuration(t.duration_min) : ''
        ].filter(Boolean).join(' · ');
        let actions = `<button class="btn btn-secondary btn-sm" onclick="openTripDetail(${Number(t.id)})">Abrir</button>`;
        if (canManage() && t.status === 'planned') actions += iconButton(`openTripModal(${Number(t.id)})`, 'fa-regular fa-pen-to-square', 'Editar');
        if (canManage() && t.status !== 'in_progress') actions += iconButton(`deleteRecord('trips', ${Number(t.id)})`, 'fa-regular fa-trash-can', 'Excluir', 'danger');

        return `
            <tr data-row>
                <td class="cell-muted">#${Number(t.id)}</td>
                <td>
                    <div class="route-inline"><strong>${escapeHtml(t.origin_name)}</strong><i class="fa-solid fa-arrow-right"></i><strong>${escapeHtml(t.destination_name)}</strong></div>
                    ${details ? `<span class="cell-sub">${escapeHtml(details)}</span>` : ''}
                </td>
                <td>${vehicleCell(t.vehicle_name, t.vehicle_plate)}</td>
                <td>${escapeHtml(t.driver_name)}</td>
                <td class="nowrap">${formatDateTimeBR(t.actual_start || t.planned_start)}<span class="cell-sub">até ${formatDateTimeBR(t.actual_end || t.planned_end)}</span></td>
                <td>${badge(label, cls)}${t.checklist_issues ? ' <i class="fa-solid fa-triangle-exclamation text-warning" title="Checklist com pendências"></i>' : ''}</td>
                <td class="actions">${actions}</td>
            </tr>`;
    }).join('');
    applyTableSearch('tableSearch', 'tripLogBody');
}

// ==========================================
// Cadastro/edição de viagem com rota (origem, paradas, destino)
// ==========================================
const tripForm = { map: null, layer: null, editingId: null, route: { distance_km: null, duration_min: null }, vehicles: [], drivers: [], endTouched: false };

async function geocodeAddress(query, limit = 5) {
    const url = `https://nominatim.openstreetmap.org/search?format=json&countrycodes=br&limit=${limit}&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'pt-BR' } });
    if (!res.ok) throw new Error('Falha na busca de endereço');
    return res.json();
}

function attachAddressAutocomplete(input, list) {
    let timer = null;
    input.addEventListener('input', () => {
        clearTimeout(timer);
        delete input.dataset.lat;
        delete input.dataset.lng;
        const query = input.value.trim();
        if (query.length < 4) { list.style.display = 'none'; return; }
        timer = setTimeout(async () => {
            try {
                const results = await geocodeAddress(query);
                list.innerHTML = '';
                results.forEach(r => {
                    const li = document.createElement('li');
                    li.innerHTML = '<i class="fa-solid fa-location-dot"></i><span></span>';
                    li.querySelector('span').textContent = r.display_name;
                    li.addEventListener('mousedown', (e) => {
                        e.preventDefault();
                        input.value = r.display_name;
                        input.dataset.lat = r.lat;
                        input.dataset.lng = r.lon;
                        list.style.display = 'none';
                        input.dispatchEvent(new Event('change'));
                    });
                    list.appendChild(li);
                });
                list.style.display = results.length ? 'block' : 'none';
            } catch (e) {
                list.style.display = 'none';
            }
        }, 600);
    });
    input.addEventListener('blur', () => setTimeout(() => { list.style.display = 'none'; }, 150));
}

function setPointInput(input, point) {
    input.value = point && point.name ? point.name : '';
    delete input.dataset.lat;
    delete input.dataset.lng;
    if (point && point.lat !== null && point.lat !== undefined) {
        input.dataset.lat = point.lat;
        input.dataset.lng = point.lng;
    }
}

function addTripStop(stop = null) {
    const container = document.getElementById('tripStops');
    if (container.children.length >= 10) return showToast('A rota pode ter no máximo 10 paradas.', 'error');

    const row = document.createElement('div');
    row.className = 'route-point';
    row.innerHTML = `
        <span class="route-dot"><i class="fa-solid fa-circle" style="font-size: 8px; color: var(--warning-solid);"></i></span>
        <div class="field">
            <div class="autocomplete">
                <input type="text" class="input stop-input" placeholder="Parada intermediária" autocomplete="off" aria-label="Parada">
                <ul class="autocomplete-list"></ul>
            </div>
        </div>
        <button type="button" class="btn-icon danger" title="Remover parada" aria-label="Remover parada" style="margin-top: 4px;"><i class="fa-solid fa-xmark"></i></button>`;

    const input = row.querySelector('input');
    setPointInput(input, stop);
    attachAddressAutocomplete(input, row.querySelector('ul'));
    input.addEventListener('change', () => drawTripRoute());
    row.querySelector('button').addEventListener('click', () => { row.remove(); drawTripRoute(); });
    container.appendChild(row);
    if (!stop) input.focus();
}

function pointFromInput(input) {
    if (!input || !input.value.trim()) return null;
    return {
        name: input.value.trim(),
        lat: input.dataset.lat ? Number(input.dataset.lat) : null,
        lng: input.dataset.lng ? Number(input.dataset.lng) : null
    };
}

async function openTripModal(id = null) {
    const form = document.getElementById('tripForm');
    if (!form) return;
    form.reset();
    document.getElementById('tripStops').innerHTML = '';
    tripForm.editingId = id;
    tripForm.route = { distance_km: null, duration_min: null };
    tripForm.endTouched = !!id;

    const [vehicles, drivers] = await Promise.all([fetchTable('vehicles'), fetchTable('drivers')]);
    tripForm.vehicles = vehicles;
    tripForm.drivers = drivers;

    let trip = null;
    if (id) {
        trip = await fetchJSON(`/api/data/trips/${id}`, null);
        if (!trip) return showToast('Viagem não encontrada.', 'error');
    }

    const usableVehicles = vehicles.filter(v => v.status !== 'inactive' || (trip && trip.vehicle_id === v.id));
    form.elements.vehicle_id.innerHTML = '<option value="">Selecione o veículo</option>' + usableVehicles.map(v =>
        `<option value="${Number(v.id)}" ${v.status === 'maintenance' ? 'disabled' : ''}>${escapeHtml(`${v.plate} — ${v.brand} ${v.model} (${VEHICLE_TYPES[v.vehicle_type] || 'Veículo'})`)}${v.status === 'maintenance' ? ' · em manutenção' : ''}</option>`).join('');

    form.elements.driver_id.innerHTML = '<option value="">Selecione o motorista</option>' + drivers.filter(d => d.status === 'active').map(d =>
        `<option value="${Number(d.id)}">${escapeHtml(`${d.name} — Cat. ${d.cnh_category}`)}${d.cnh_status === 'expired' ? ' · CNH vencida' : ''}</option>`).join('');

    const origin = document.getElementById('tripOrigin');
    const dest = document.getElementById('tripDest');

    if (trip) {
        form.elements.vehicle_id.value = trip.vehicle_id;
        form.elements.driver_id.value = trip.driver_id;
        form.elements.planned_start.value = trip.planned_start;
        form.elements.planned_end.value = trip.planned_end;
        form.elements.toll_cost.value = trip.toll_cost || '';
        form.elements.notes.value = trip.notes || '';
        setPointInput(origin, { name: trip.origin_name, lat: trip.origin_lat, lng: trip.origin_lng });
        setPointInput(dest, { name: trip.destination_name, lat: trip.destination_lat, lng: trip.destination_lng });
        trip.stops.forEach(s => addTripStop(s));
        tripForm.route = { distance_km: trip.distance_km, duration_min: trip.duration_min };
    } else {
        const start = new Date(Date.now() + 3600000);
        start.setMinutes(0, 0, 0);
        form.elements.planned_start.value = localDateTimeValue(start);
        form.elements.planned_end.value = localDateTimeValue(new Date(start.getTime() + 3 * 3600000));
        setPointInput(origin, null);
        setPointInput(dest, null);
    }
    form.elements.planned_start.min = id ? '' : localDateTimeValue(new Date(Date.now() - 3600000));

    document.getElementById('tripModalTitle').textContent = id ? `Editar viagem #${id}` : 'Nova viagem';
    openModal('tripModal');
    checkTripAptitude();

    setTimeout(() => {
        if (tripForm.map) {
            try { tripForm.map.remove(); } catch (e) { /* mapa já removido da tela */ }
        }
        tripForm.map = L.map('tripMap').setView([-22.8, -47.2], 10);
        L.tileLayer(tileLayerUrl(), { attribution: '&copy; OpenStreetMap &copy; CARTO', maxZoom: 19 }).addTo(tripForm.map);
        tripForm.layer = L.layerGroup().addTo(tripForm.map);
        drawTripRoute();
    }, 200);
}

// Calcula a rota (OSRM) passando por origem → paradas → destino
async function drawTripRoute() {
    if (!tripForm.map) return;
    const summary = document.getElementById('tripRouteSummary');
    tripForm.layer.clearLayers();

    const origin = pointFromInput(document.getElementById('tripOrigin'));
    const dest = pointFromInput(document.getElementById('tripDest'));
    const stops = Array.from(document.querySelectorAll('#tripStops .stop-input')).map(pointFromInput).filter(Boolean);
    const points = [origin, ...stops, dest].filter(p => p && p.lat !== null);

    points.forEach((p, i) => {
        const color = i === 0 ? '#16a34a' : (i === points.length - 1 && dest && p === dest ? '#dc2626' : '#f59e0b');
        L.circleMarker([p.lat, p.lng], { radius: 8, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1 })
            .bindTooltip(p.name).addTo(tripForm.layer);
    });

    if (points.length < 2 || !origin || origin.lat === null || !dest || dest.lat === null) {
        if (points.length === 1) tripForm.map.setView([points[0].lat, points[0].lng], 12);
        summary.innerHTML = '<span class="text-subtle"><i class="fa-solid fa-circle-info"></i> Selecione origem e destino nas sugestões para calcular distância e tempo.</span>';
        return;
    }

    tripForm.map.fitBounds(L.latLngBounds(points.map(p => [p.lat, p.lng])), { padding: [30, 30] });
    summary.innerHTML = '<span class="text-subtle"><span class="spinner" style="width:12px;height:12px;display:inline-block;vertical-align:middle;"></span> Calculando rota...</span>';

    try {
        const coords = points.map(p => `${p.lng},${p.lat}`).join(';');
        const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`);
        const json = await res.json();
        if (json.code !== 'Ok' || !json.routes || !json.routes.length) throw new Error('rota indisponível');

        const route = json.routes[0];
        tripForm.route = { distance_km: Math.round(route.distance / 100) / 10, duration_min: Math.round(route.duration / 60) };
        L.geoJSON(route.geometry, { style: { color: '#2563eb', weight: 5, opacity: 0.85 } }).addTo(tripForm.layer);

        // Sugere a chegada prevista com base no tempo de percurso (+20% de folga)
        const form = document.getElementById('tripForm');
        if (!tripForm.endTouched && form.elements.planned_start.value) {
            const start = parseAnyDate(form.elements.planned_start.value);
            form.elements.planned_end.value = localDateTimeValue(new Date(start.getTime() + tripForm.route.duration_min * 1.2 * 60000 + 15 * 60000));
        }

        summary.innerHTML = `
            <div class="stat-grid">
                <div class="stat"><div class="stat-label">Distância</div><div class="stat-value">${formatNumber(tripForm.route.distance_km, 1)} km</div></div>
                <div class="stat"><div class="stat-label">Tempo estimado</div><div class="stat-value">${formatDuration(tripForm.route.duration_min)}</div></div>
            </div>`;
    } catch (e) {
        tripForm.route = { distance_km: null, duration_min: null };
        L.polyline(points.map(p => [p.lat, p.lng]), { color: '#94a3b8', dashArray: '6 6' }).addTo(tripForm.layer);
        summary.innerHTML = '<span class="text-warning"><i class="fa-solid fa-triangle-exclamation"></i> Serviço de rotas indisponível. A viagem pode ser salva sem distância calculada.</span>';
    }
}

// Aviso imediato: CNH vencida ou categoria incompatível
function checkTripAptitude() {
    const form = document.getElementById('tripForm');
    if (!form) return true;
    const vehicle = tripForm.vehicles.find(v => String(v.id) === form.elements.vehicle_id.value);
    const driver = tripForm.drivers.find(d => String(d.id) === form.elements.driver_id.value);
    if (!vehicle || !driver) {
        setHint('tripDriverHint', '');
        return true;
    }
    const required = REQUIRED_CATEGORY[vehicle.vehicle_type] || 'B';
    const endDate = (form.elements.planned_end.value || todayIso()).slice(0, 10);

    if (driver.cnh_expiry < endDate) {
        setHint('tripDriverHint', `CNH vencida em ${formatDateBR(driver.cnh_expiry)} — motorista não pode ser escalado.`, 'error');
        return false;
    }
    if (!categoryAllows(driver.cnh_category, required)) {
        setHint('tripDriverHint', `Categoria ${driver.cnh_category} não permite conduzir ${(VEHICLE_TYPES[vehicle.vehicle_type] || 'veículo').toLowerCase()} (exige ${required}).`, 'error');
        return false;
    }
    if (driver.vehicle_ids.length && !driver.vehicle_ids.includes(vehicle.id)) {
        setHint('tripDriverHint', `Habilitação compatível (Cat. ${driver.cnh_category}), mas este veículo não está vinculado ao motorista.`);
        return true;
    }
    setHint('tripDriverHint', `Habilitado: categoria ${driver.cnh_category}, CNH válida até ${formatDateBR(driver.cnh_expiry)}.`, 'success');
    return true;
}

document.addEventListener('DOMContentLoaded', () => {
    // Liga o autocompletar sempre que a tela de viagens for carregada
    const observer = new MutationObserver(() => {
        const origin = document.getElementById('tripOrigin');
        if (origin && !origin.dataset.bound) {
            origin.dataset.bound = '1';
            const dest = document.getElementById('tripDest');
            attachAddressAutocomplete(origin, document.getElementById('tripOriginSugg'));
            attachAddressAutocomplete(dest, document.getElementById('tripDestSugg'));
            origin.addEventListener('change', () => drawTripRoute());
            dest.addEventListener('change', () => drawTripRoute());
            const form = document.getElementById('tripForm');
            ['vehicle_id', 'driver_id'].forEach(n => form.elements[n].addEventListener('change', checkTripAptitude));
            form.elements.planned_end.addEventListener('input', () => { tripForm.endTouched = true; checkTripAptitude(); });
        }
    });
    observer.observe(document.querySelector('.page-container'), { childList: true });
});

document.addEventListener('submit', async (e) => {
    if (e.target.id !== 'tripForm') return;
    e.preventDefault();
    const form = e.target;
    const f = form.elements;
    if (!requireFields(form)) return;

    const origin = pointFromInput(document.getElementById('tripOrigin'));
    const dest = pointFromInput(document.getElementById('tripDest'));
    if (!origin || !dest) return showToast('Informe a origem e o destino.', 'error');
    if (f.planned_end.value <= f.planned_start.value) return showToast('A chegada prevista deve ser posterior à saída.', 'error');
    if (!checkTripAptitude()) return showToast('O motorista selecionado não está apto para este veículo.', 'error');

    const payload = {
        vehicle_id: f.vehicle_id.value,
        driver_id: f.driver_id.value,
        planned_start: f.planned_start.value,
        planned_end: f.planned_end.value,
        origin_name: origin.name, origin_lat: origin.lat, origin_lng: origin.lng,
        destination_name: dest.name, destination_lat: dest.lat, destination_lng: dest.lng,
        stops: Array.from(document.querySelectorAll('#tripStops .stop-input')).map(pointFromInput).filter(Boolean),
        distance_km: tripForm.route.distance_km,
        duration_min: tripForm.route.duration_min,
        toll_cost: f.toll_cost.value,
        notes: f.notes.value
    };

    await submitWithButton(form, async () => {
        const id = tripForm.editingId;
        const { ok, data } = await apiSend(id ? `/api/data/trips/${id}` : '/api/data/trips', id ? 'PUT' : 'POST', payload);
        if (!ok) return showToast(data.error || 'Não foi possível salvar a viagem.', 'error');
        closeModal('tripModal');
        showToast(id ? 'Viagem atualizada.' : `Viagem #${data.id} planejada.`);
        renderTrips();
    });
});

// ==========================================
// Detalhes e execução da viagem
// ==========================================
async function openTripDetail(id) {
    const [trip, checklists, positions] = await Promise.all([
        fetchJSON(`/api/data/trips/${id}`, null),
        fetchJSON(`/api/trips/${id}/checklists`, []),
        fetchJSON(`/api/trips/${id}/positions`, [])
    ]);
    if (!trip) return showToast('Viagem não encontrada.', 'error');

    const pre = checklists.find(c => c.type === 'pre');
    const post = checklists.find(c => c.type === 'post');
    const [statusLabel, statusClass] = TRIP_STATUS[trip.status];
    const isOwner = hasRole('motorista');
    const canOperate = canManage() || isOwner;

    const steps = [
        ['Planejada', true],
        ['Checklist de saída', !!pre],
        ['Em andamento', ['in_progress', 'completed'].includes(trip.status)],
        ['Checklist de chegada', !!post],
        ['Concluída', trip.status === 'completed']
    ];
    const currentIndex = steps.findIndex(s => !s[1]);
    const stepper = trip.status === 'cancelled' ? '' : `
        <div class="stepper" style="margin-bottom: 18px;">
            ${steps.map(([label, done], i) => `
                ${i ? '<span class="step-sep"></span>' : ''}
                <span class="step ${done ? 'done' : i === currentIndex ? 'current' : ''}"><i class="fa-solid ${done ? 'fa-check' : 'fa-circle'}"></i>${label}</span>`).join('')}
        </div>`;

    const distance = trip.end_odometer && trip.start_odometer ? trip.end_odometer - trip.start_odometer : null;
    const actions = [];
    if (canOperate && trip.status === 'planned') {
        actions.push(pre
            ? ['start', 'btn-primary', 'fa-play', 'Iniciar viagem']
            : ['pre', 'btn-primary', 'fa-clipboard-check', 'Preencher checklist de saída']);
    }
    if (canOperate && trip.status === 'in_progress') {
        actions.push(post
            ? ['finish', 'btn-primary', 'fa-flag-checkered', 'Finalizar viagem']
            : ['post', 'btn-primary', 'fa-clipboard-check', 'Checklist de chegada']);
        actions.push(['fuel', 'btn-secondary', 'fa-gas-pump', 'Abastecimento']);
        actions.push(['occurrence', 'btn-secondary', 'fa-circle-exclamation', 'Ocorrência']);
        if (isOwner) {
            actions.push(isSharingLocation() ? ['gps-stop', 'btn-danger-soft', 'fa-location-crosshairs', 'Parar localização'] : ['gps', 'btn-secondary', 'fa-location-crosshairs', 'Compartilhar localização']);
        }
        if (!isOwner) {
            actions.push(isSharingLocation() ? ['gps-stop', 'btn-danger-soft', 'fa-stop', 'Parar simulação'] : ['sim', 'btn-ghost', 'fa-route', 'Simular GPS (demonstração)']);
        }
    }
    if (canManage() && trip.status === 'planned') {
        actions.push(['edit', 'btn-secondary', 'fa-pen-to-square', 'Editar']);
        actions.push(['cancel', 'btn-danger-soft', 'fa-ban', 'Cancelar viagem']);
    }
    if (canManage() && trip.status === 'completed') actions.push(['tolls', 'btn-secondary', 'fa-coins', 'Pedágios e observações']);

    document.getElementById('tripDetailModal')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'tripDetailModal';
    overlay.className = 'modal-overlay';
    overlay.dataset.dynamic = '1';
    overlay.innerHTML = `
        <div class="modal modal-xl" role="dialog" aria-modal="true" aria-labelledby="tripDetailTitle">
            <div class="modal-header">
                <div>
                    <h3 class="modal-title" id="tripDetailTitle">Viagem #${Number(trip.id)} ${badge(statusLabel, statusClass)}</h3>
                    <p class="modal-subtitle">${escapeHtml(tripRouteLabel(trip))}</p>
                </div>
                <button type="button" class="btn-icon" data-close aria-label="Fechar"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="modal-body">
                ${stepper}
                <div class="grid grid-2">
                    <div class="stack" style="gap: 16px;">
                        <dl class="kv">
                            <div><dt>Veículo</dt><dd>${escapeHtml(trip.vehicle_name)} · ${escapeHtml(trip.vehicle_plate || '')}</dd></div>
                            <div><dt>Motorista</dt><dd>${escapeHtml(trip.driver_name)}</dd></div>
                            <div><dt>Saída prevista</dt><dd>${formatDateTimeBR(trip.planned_start)}</dd></div>
                            <div><dt>Chegada prevista</dt><dd>${formatDateTimeBR(trip.planned_end)}</dd></div>
                            <div><dt>Início real</dt><dd>${trip.actual_start ? formatDateTimeBR(trip.actual_start) : '—'}</dd></div>
                            <div><dt>Fim real</dt><dd>${trip.actual_end ? formatDateTimeBR(trip.actual_end) : '—'}</dd></div>
                            <div><dt>Quilometragem</dt><dd>${trip.start_odometer ? `${formatNumber(trip.start_odometer, 0)} → ${trip.end_odometer ? formatNumber(trip.end_odometer, 0) : '…'} km` : '—'}</dd></div>
                            <div><dt>Percorrido / planejado</dt><dd>${distance ? `${formatNumber(distance, 0)} km` : '—'} / ${trip.distance_km ? `${formatNumber(trip.distance_km, 0)} km` : '—'}</dd></div>
                            <div><dt>Pedágios</dt><dd>${formatBRL(trip.toll_cost)}</dd></div>
                            <div><dt>Tempo estimado</dt><dd>${trip.duration_min ? formatDuration(trip.duration_min) : '—'}</dd></div>
                        </dl>
                        <div>
                            <div class="label" style="margin-bottom: 6px;">Rota</div>
                            <div class="route-inline">
                                <span><i class="fa-solid fa-circle text-success"></i> ${escapeHtml(trip.origin_name)}</span>
                                ${trip.stops.map(s => `<span><i class="fa-solid fa-circle text-warning"></i> ${escapeHtml(s.name)}</span>`).join('')}
                                <span><i class="fa-solid fa-circle text-danger"></i> ${escapeHtml(trip.destination_name)}</span>
                            </div>
                        </div>
                        ${trip.notes ? `<div class="callout"><i class="fa-regular fa-note-sticky"></i><span>${escapeHtml(trip.notes)}</span></div>` : ''}
                    </div>
                    <div id="tripDetailMap" class="map rounded" style="height: 300px;"></div>
                </div>
                <div class="grid grid-2" style="margin-top: 20px;">
                    ${renderChecklistSummary(pre, 'Checklist de saída')}
                    ${renderChecklistSummary(post, 'Checklist de chegada')}
                </div>
            </div>
            ${actions.length ? `<div class="modal-footer" style="flex-wrap: wrap;">
                ${actions.map(([action, cls, icon, label]) => `<button type="button" class="btn ${cls}" data-action="${action}"><i class="fa-solid ${icon}"></i> ${label}</button>`).join('')}
            </div>` : ''}
        </div>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('active'));

    const close = () => {
        overlay.classList.remove('active');
        setTimeout(() => overlay.remove(), 200);
    };
    overlay.addEventListener('mousedown', e => { if (e.target === overlay) close(); });
    overlay.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));

    const handlers = {
        pre: () => openChecklistModal(trip, 'pre'),
        post: () => openChecklistModal(trip, 'post'),
        start: () => openStartTrip(trip),
        finish: () => openFinishTrip(trip),
        fuel: () => openFuelFromTrip(trip),
        occurrence: () => openOccurrenceModal({ vehicle_id: trip.vehicle_id, trip_id: trip.id }),
        gps: () => startLocationSharing(),
        sim: () => startSimulation(trip),
        'gps-stop': () => stopLocationSharing(),
        edit: () => openTripModal(trip.id),
        cancel: () => cancelTrip(trip.id),
        tolls: () => openTripCostsModal(trip)
    };
    overlay.querySelectorAll('[data-action]').forEach(btn => btn.addEventListener('click', () => {
        close();
        handlers[btn.dataset.action]();
    }));

    // Mapa: rota planejada + trajeto do GPS
    setTimeout(() => {
        const mapEl = document.getElementById('tripDetailMap');
        if (!mapEl || typeof L === 'undefined') return;
        const map = L.map(mapEl, { zoomControl: false }).setView([-22.8, -47.2], 9);
        L.tileLayer(tileLayerUrl(), { attribution: '&copy; OpenStreetMap &copy; CARTO' }).addTo(map);
        const points = [
            { name: trip.origin_name, lat: trip.origin_lat, lng: trip.origin_lng, color: '#16a34a' },
            ...trip.stops.map(s => ({ ...s, color: '#f59e0b' })),
            { name: trip.destination_name, lat: trip.destination_lat, lng: trip.destination_lng, color: '#dc2626' }
        ].filter(p => p.lat !== null && p.lat !== undefined);
        const bounds = [];
        points.forEach(p => {
            L.circleMarker([p.lat, p.lng], { radius: 7, color: '#fff', weight: 2, fillColor: p.color, fillOpacity: 1 }).bindTooltip(p.name).addTo(map);
            bounds.push([p.lat, p.lng]);
        });
        if (positions.length) {
            const path = positions.map(p => [p.lat, p.lng]);
            L.polyline(path, { color: '#2563eb', weight: 4 }).addTo(map);
            L.circleMarker(path[path.length - 1], { radius: 9, color: '#fff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 })
                .bindTooltip(`Última posição · ${timeAgo(parseUtc(positions[positions.length - 1].recorded_at))}`).addTo(map);
            bounds.push(...path);
        }
        if (bounds.length) map.fitBounds(bounds, { padding: [20, 20] });
        else mapEl.innerHTML = emptyBlock({ icon: 'fa-map', text: 'Sem coordenadas para exibir no mapa.' });
    }, 250);
}

function renderChecklistSummary(checklist, title) {
    if (!checklist) {
        return `<div class="card"><div class="card-header"><div class="card-title"><i class="fa-regular fa-clipboard"></i> ${title}</div>${badge('Pendente')}</div><div class="card-body text-subtle">Ainda não preenchido.</div></div>`;
    }
    return `
        <div class="card">
            <div class="card-header">
                <div>
                    <div class="card-title"><i class="fa-solid fa-clipboard-check"></i> ${title}</div>
                    <div class="card-subtitle">Por ${escapeHtml(checklist.user_name)} em ${formatUtcDateTime(checklist.created_at)}</div>
                </div>
                ${checklist.has_issues ? badge('Com pendências', 'badge-warning') : badge('Tudo OK', 'badge-success')}
            </div>
            <div class="card-body" style="padding-top: 8px; padding-bottom: 8px;">
                ${checklist.items.map(i => `
                    <div class="row-between" style="padding: 6px 0; border-bottom: 1px solid var(--border); font-size: 13px;">
                        <span>${escapeHtml(i.label)}${i.note ? ` <span class="text-subtle">— ${escapeHtml(i.note)}</span>` : ''}</span>
                        <i class="fa-solid ${i.ok ? 'fa-circle-check text-success' : 'fa-circle-xmark text-danger'}"></i>
                    </div>`).join('')}
                ${checklist.odometer ? `<div class="text-subtle" style="font-size: 12.5px; margin-top: 8px;">Quilometragem informada: ${formatNumber(checklist.odometer, 0)} km</div>` : ''}
                ${checklist.notes ? `<div class="text-subtle" style="font-size: 12.5px; margin-top: 4px;">${escapeHtml(checklist.notes)}</div>` : ''}
            </div>
        </div>`;
}

// RF12 — preenchimento do checklist de inspeção
async function openChecklistModal(trip, type) {
    const template = await fetchJSON('/api/trips/checklist-template', []);
    const title = type === 'pre' ? 'Checklist de saída' : 'Checklist de chegada';

    document.getElementById('checklistModal')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'checklistModal';
    overlay.className = 'modal-overlay';
    overlay.dataset.dynamic = '1';
    overlay.innerHTML = `
        <div class="modal modal-lg" role="dialog" aria-modal="true" aria-labelledby="checklistTitle">
            <form novalidate>
                <div class="modal-header">
                    <div>
                        <h3 class="modal-title" id="checklistTitle"><i class="fa-solid fa-clipboard-check text-primary"></i> ${title}</h3>
                        <p class="modal-subtitle">Viagem #${Number(trip.id)} · ${escapeHtml(trip.vehicle_plate || '')} · ${escapeHtml(tripRouteLabel(trip))}</p>
                    </div>
                    <button type="button" class="btn-icon" data-close aria-label="Fechar"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <div class="modal-body">
                    <div class="row-between" style="margin-bottom: 8px;">
                        <span class="text-subtle">Inspecione o veículo e responda cada item. Problemas precisam de descrição.</span>
                        <button type="button" class="btn btn-ghost btn-sm" data-all-ok><i class="fa-solid fa-check-double"></i> Marcar todos OK</button>
                    </div>
                    <div class="checklist">
                        ${template.map(item => `
                            <div class="checklist-item" data-key="${escapeHtml(item.key)}">
                                <div class="checklist-row">
                                    <span class="label">${escapeHtml(item.label)}</span>
                                    <div class="choice">
                                        <button type="button" class="ok" data-answer="ok"><i class="fa-solid fa-check"></i> OK</button>
                                        <button type="button" class="nok" data-answer="nok"><i class="fa-solid fa-xmark"></i> Problema</button>
                                    </div>
                                </div>
                                <input type="text" class="input note" maxlength="200" placeholder="Descreva o problema encontrado" hidden>
                            </div>`).join('')}
                    </div>
                    <div class="form-grid" style="margin-top: 16px;">
                        <div class="field">
                            <label for="checklistOdometer">Quilometragem no painel</label>
                            <div class="input-affix"><input type="number" id="checklistOdometer" min="0" step="1" value="${Number(trip.vehicle_odometer) || ''}"><span class="affix">km</span></div>
                        </div>
                        <div class="field">
                            <label for="checklistNotes">Observações</label>
                            <input type="text" id="checklistNotes" maxlength="500">
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <span class="modal-footer-note">Registrado com seu nome, data e hora.</span>
                    <button type="button" class="btn btn-ghost" data-close>Cancelar</button>
                    <button type="submit" class="btn btn-primary"><i class="fa-solid fa-check"></i> Registrar checklist</button>
                </div>
            </form>
        </div>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('active'));

    const close = () => {
        overlay.classList.remove('active');
        setTimeout(() => overlay.remove(), 200);
    };
    overlay.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));

    const setAnswer = (row, answer) => {
        row.dataset.answer = answer;
        row.querySelectorAll('.choice button').forEach(b => b.classList.toggle('active', b.dataset.answer === answer));
        const note = row.querySelector('.note');
        note.hidden = answer !== 'nok';
        if (answer === 'nok') note.focus();
    };
    overlay.querySelectorAll('.checklist-item').forEach(row => {
        row.querySelectorAll('.choice button').forEach(btn => btn.addEventListener('click', () => setAnswer(row, btn.dataset.answer)));
    });
    overlay.querySelector('[data-all-ok]').addEventListener('click', () => {
        overlay.querySelectorAll('.checklist-item').forEach(row => setAnswer(row, 'ok'));
    });

    overlay.querySelector('form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const rows = Array.from(overlay.querySelectorAll('.checklist-item'));
        const unanswered = rows.find(r => !r.dataset.answer);
        if (unanswered) {
            unanswered.scrollIntoView({ block: 'center' });
            return showToast(`Responda o item "${unanswered.querySelector('.label').textContent}".`, 'error');
        }
        const items = rows.map(r => ({ key: r.dataset.key, ok: r.dataset.answer === 'ok', note: r.querySelector('.note').value.trim() }));
        const missingNote = items.find(i => !i.ok && !i.note);
        if (missingNote) return showToast('Descreva cada problema encontrado.', 'error');

        const btn = e.target.querySelector('button[type="submit"]');
        btn.disabled = true;
        const { ok, data } = await apiSend(`/api/trips/${trip.id}/checklists`, 'POST', {
            type,
            items,
            odometer: document.getElementById('checklistOdometer').value,
            notes: document.getElementById('checklistNotes').value
        });
        btn.disabled = false;
        if (!ok) return showToast(data.error || 'Não foi possível registrar o checklist.', 'error');

        close();
        showToast(data.has_issues ? 'Checklist registrado com pendências. O gestor foi notificado.' : 'Checklist registrado.', data.has_issues ? 'info' : 'success');
        renderTrips();
        openTripDetail(trip.id);
    });
}

function openStartTrip(trip) {
    openFormModal({
        title: 'Iniciar viagem',
        subtitle: `#${trip.id} · ${tripRouteLabel(trip)}`,
        size: 'modal-sm',
        submitLabel: 'Iniciar viagem',
        fields: [
            {
                name: 'start_odometer', label: 'Quilometragem inicial', type: 'number', required: true, min: 0, step: '1', affix: 'km', full: true,
                value: trip.vehicle_odometer, hint: `Quilometragem atual do veículo: ${formatNumber(trip.vehicle_odometer, 0)} km`
            }
        ],
        onSubmit: async (values, { setError }) => {
            const { ok, data } = await apiSend(`/api/trips/${trip.id}/start`, 'POST', values);
            if (!ok) { setError(data.error || 'Não foi possível iniciar a viagem.'); return false; }
            showToast('Viagem iniciada. Boa viagem!');
            renderTrips();
            updateGpsCard();
            if (hasRole('motorista') && confirm('Deseja compartilhar sua localização em tempo real durante a viagem?')) startLocationSharing();
        }
    });
}

function openFinishTrip(trip) {
    openFormModal({
        title: 'Finalizar viagem',
        subtitle: `#${trip.id} · ${tripRouteLabel(trip)}`,
        size: '',
        submitLabel: 'Finalizar viagem',
        fields: [
            {
                name: 'end_odometer', label: 'Quilometragem final', type: 'number', required: true, min: (trip.start_odometer || 0) + 1, step: '1', affix: 'km',
                hint: `Deve ser maior que a inicial (${formatNumber(trip.start_odometer, 0)} km)`
            },
            { name: 'toll_cost', label: 'Pedágios (R$)', type: 'number', min: 0, step: '0.01', value: trip.toll_cost || '' },
            { name: 'notes', label: 'Observações', type: 'textarea', full: true }
        ],
        onSubmit: async (values, { setError }) => {
            if (Number(values.end_odometer) <= Number(trip.start_odometer || 0)) {
                setError('Quilometragem inválida: a quilometragem final deve ser maior que a inicial.');
                return false;
            }
            const { ok, data } = await apiSend(`/api/trips/${trip.id}/finish`, 'POST', values);
            if (!ok) { setError(data.error || 'Não foi possível finalizar a viagem.'); return false; }
            if (gps.tripId === trip.id || hasRole('motorista')) stopLocationSharing(true);
            showToast(`Viagem finalizada: ${formatNumber(data.distance_km, 0)} km percorridos. Quilometragem do veículo atualizada.`);
            renderTrips();
            updateGpsCard();
        }
    });
}

function openTripCostsModal(trip) {
    openFormModal({
        title: 'Pedágios e observações',
        subtitle: `#${trip.id} · ${tripRouteLabel(trip)}`,
        size: '',
        submitLabel: 'Salvar',
        fields: [
            { name: 'toll_cost', label: 'Pedágios (R$)', type: 'number', min: 0, step: '0.01', value: trip.toll_cost || '' },
            { name: 'notes', label: 'Observações', type: 'textarea', full: true, value: trip.notes || '' }
        ],
        onSubmit: async (values, { setError }) => {
            const { ok, data } = await apiSend(`/api/data/trips/${trip.id}`, 'PUT', values);
            if (!ok) { setError(data.error || 'Não foi possível salvar.'); return false; }
            showToast('Viagem atualizada.');
            renderTrips();
        }
    });
}

async function cancelTrip(id) {
    const reason = prompt('Motivo do cancelamento (opcional):');
    if (reason === null) return;
    const { ok, data } = await apiSend(`/api/trips/${id}/cancel`, 'POST', { reason });
    if (!ok) return showToast(data.error || 'Não foi possível cancelar a viagem.', 'error');
    showToast('Viagem cancelada.');
    renderTrips();
}

async function openFuelFromTrip(trip) {
    await loadPage('abastecimento');
    await openFuelModal();
    const select = document.getElementById('fuelVehicleSelect');
    if (select) {
        select.value = trip.vehicle_id;
        onVehicleChangeFuel(select);
    }
}

// ==========================================
// Compartilhamento de localização (RF07)
// ==========================================
const gps = { watchId: null, simTimer: null, lastSent: 0, lastAt: null, mode: null, tripId: null };
const GPS_INTERVAL_MS = 10000;

function isSharingLocation() {
    return !!gps.mode;
}

async function sendPosition(payload, force = false) {
    if (!force && Date.now() - gps.lastSent < GPS_INTERVAL_MS) return;
    gps.lastSent = Date.now();
    const { ok, data } = await apiSend('/api/tracking/positions', 'POST', payload);
    if (!ok) {
        showToast(data.error || 'Falha ao enviar a localização.', 'error');
        if (data.error && /viagem/i.test(data.error)) stopLocationSharing(true);
        return;
    }
    gps.lastAt = new Date();
    renderGpsState();
}

function startLocationSharing() {
    if (!navigator.geolocation) return showToast('Seu navegador não suporta geolocalização.', 'error');
    stopLocationSharing(true);
    gps.mode = 'gps';
    gps.watchId = navigator.geolocation.watchPosition(
        pos => sendPosition({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            speed: pos.coords.speed !== null ? Math.round(pos.coords.speed * 3.6) : null,
            accuracy: pos.coords.accuracy
        }),
        err => {
            showToast(err.code === 1
                ? 'Permissão de localização negada. Permita o acesso ou use o modo demonstração.'
                : 'Não foi possível obter a localização do dispositivo.', 'error');
            stopLocationSharing(true);
        },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 }
    );
    renderGpsState();
    showToast('Compartilhando localização em tempo real.');
}

// Modo demonstração: percorre a rota planejada enviando uma posição a cada 10 segundos
function startSimulation(trip) {
    stopLocationSharing(true);
    let waypoints = [
        [trip.origin_lat, trip.origin_lng],
        ...trip.stops.map(s => [s.lat, s.lng]),
        [trip.destination_lat, trip.destination_lng]
    ].filter(p => p[0] !== null && p[0] !== undefined);
    if (waypoints.length < 2) waypoints = [[-22.7392, -47.3314], [-22.9056, -47.0608]];

    const path = [];
    for (let i = 0; i < waypoints.length - 1; i++) {
        const [aLat, aLng] = waypoints[i];
        const [bLat, bLng] = waypoints[i + 1];
        for (let s = 0; s < 20; s++) path.push([aLat + (bLat - aLat) * (s / 20), aLng + (bLng - aLng) * (s / 20)]);
    }
    path.push(waypoints[waypoints.length - 1]);

    let index = 0;
    gps.mode = 'sim';
    gps.tripId = trip.id;
    const tick = () => {
        const [lat, lng] = path[Math.min(index, path.length - 1)];
        sendPosition({ trip_id: trip.id, lat, lng, speed: Math.round(50 + Math.random() * 30), accuracy: 10 }, true);
        index++;
        if (index >= path.length) {
            stopLocationSharing(true);
            showToast('Simulação concluída: destino alcançado.', 'info');
        }
    };
    tick();
    gps.simTimer = setInterval(tick, GPS_INTERVAL_MS);
    renderGpsState();
    showToast('Simulação de GPS iniciada (posição enviada a cada 10 s).');
}

function stopLocationSharing(silent = false) {
    const wasActive = isSharingLocation();
    if (gps.watchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(gps.watchId);
    clearInterval(gps.simTimer);
    Object.assign(gps, { watchId: null, simTimer: null, mode: null, tripId: null });
    renderGpsState();
    if (!silent && wasActive) showToast('Compartilhamento de localização encerrado.', 'info');
}

function renderGpsState() {
    const card = document.getElementById('gpsCard');
    if (!card || card.hidden) return;
    const sharing = isSharingLocation();
    document.getElementById('gpsDot').className = `live-dot ${sharing ? 'online' : ''}`;
    document.getElementById('gpsStatus').textContent = sharing
        ? (gps.mode === 'sim' ? 'Simulação de GPS ativa' : 'Compartilhando localização')
        : 'Localização não compartilhada';
    document.getElementById('gpsLastSent').textContent = gps.lastAt ? `Última posição enviada ${timeAgo(gps.lastAt)}` : 'O gestor acompanha sua posição no rastreamento.';
    document.getElementById('gpsStartBtn').hidden = sharing;
    document.getElementById('gpsDemoBtn').hidden = sharing;
    document.getElementById('gpsStopBtn').hidden = !sharing;
}

async function updateGpsCard() {
    const card = document.getElementById('gpsCard');
    if (!card) return;
    if (!hasRole('motorista')) { card.hidden = true; return; }
    const trips = await fetchTable('trips');
    const active = trips.find(t => t.status === 'in_progress');
    window._activeTrip = active || null;
    card.hidden = !active;
    if (!active) {
        if (isSharingLocation()) stopLocationSharing(true);
        return;
    }
    document.getElementById('gpsTripLabel').textContent = `Viagem #${active.id} · ${tripRouteLabel(active)} · ${active.vehicle_plate}`;
    renderGpsState();
}

// ==========================================
// Rastreamento em tempo real (RF07)
// ==========================================
const TRACK_REFRESH_MS = 10000;
const MARKER_COLORS = { in_trip: '#2563eb', available: '#16a34a', maintenance: '#f59e0b', inactive: '#94a3b8' };
const track = { map: null, markers: {}, pathLayer: null, selected: null, timer: null, vehicles: [], fitted: false };

async function setupRastreamento() {
    const map = L.map('trackMap').setView([-22.8, -47.2], 10);
    L.tileLayer(tileLayerUrl(), { attribution: '&copy; OpenStreetMap &copy; CARTO', maxZoom: 19 }).addTo(map);
    Object.assign(track, { map, markers: {}, pathLayer: L.layerGroup().addTo(map), selected: null, vehicles: [], fitted: false });

    document.getElementById('trackSearch').addEventListener('input', renderTrackList);
    await refreshTracking();
    track.timer = setInterval(refreshTracking, TRACK_REFRESH_MS);
    onPageLeave(() => clearInterval(track.timer));
    setTimeout(() => map.invalidateSize(), 300);
}

function positionFreshness(vehicle) {
    if (vehicle.seconds_since_update === null) return 'none';
    if (vehicle.seconds_since_update <= 60) return 'online';
    return 'stale';
}

function trackPopupHtml(v) {
    const trip = v.trip;
    return `
        <div style="font-family: Inter, sans-serif; min-width: 220px;">
            <div style="font-weight: 700; font-size: 14px; color: #0f172a;">${escapeHtml(v.plate)} · ${escapeHtml(v.brand)} ${escapeHtml(v.model)}</div>
            <div style="font-size: 12.5px; color: #64748b; margin-bottom: 6px;">${STATUS_LABELS[v.status] || v.status} · atualizado ${timeAgo(new Date(v.last_position_at))}</div>
            ${trip ? `
                <div style="font-size: 13px; color: #0f172a;"><strong>Motorista:</strong> ${escapeHtml(trip.driver_name || '—')}</div>
                <div style="font-size: 13px; color: #0f172a;"><strong>Rota:</strong> ${escapeHtml(trip.origin_name)} → ${escapeHtml(trip.destination_name)}</div>` : ''}
            ${v.last_speed !== null ? `<div style="font-size: 13px; color: #0f172a;"><strong>Velocidade:</strong> ${Math.round(v.last_speed)} km/h</div>` : ''}
            ${trip ? `<button onclick="openTripDetail(${Number(trip.id)})" style="margin-top: 8px; width: 100%; background: #2563eb; color: #fff; border: 0; border-radius: 8px; padding: 7px; font-weight: 600; cursor: pointer;">Ver viagem #${Number(trip.id)}</button>` : ''}
        </div>`;
}

async function refreshTracking() {
    if (!document.getElementById('trackMap')) return;
    const data = await fetchJSON('/api/tracking/live', null);
    if (!data) return;
    track.vehicles = data.vehicles;

    const inTrip = data.vehicles.filter(v => v.status === 'in_trip');
    setText('trkInTrip', inTrip.length);
    setText('trkOnline', data.vehicles.filter(v => positionFreshness(v) === 'online').length);
    setText('trkStale', inTrip.filter(v => positionFreshness(v) !== 'online').length);
    setText('trkUpdated', `Atualizado às ${new Date().toLocaleTimeString('pt-BR')}`);

    const seen = new Set();
    data.vehicles.filter(v => v.last_lat !== null).forEach(v => {
        seen.add(v.id);
        const icon = L.divIcon({
            className: '',
            html: `<div class="vehicle-marker" style="background: ${MARKER_COLORS[v.status] || '#64748b'}; opacity: ${positionFreshness(v) === 'online' ? 1 : 0.7};"><i class="fa-solid ${VEHICLE_TYPE_ICONS[v.vehicle_type] || 'fa-car-side'}"></i></div>`,
            iconSize: [34, 34],
            iconAnchor: [17, 17]
        });
        if (track.markers[v.id]) {
            track.markers[v.id].setLatLng([v.last_lat, v.last_lng]).setIcon(icon).setPopupContent(trackPopupHtml(v));
        } else {
            track.markers[v.id] = L.marker([v.last_lat, v.last_lng], { icon }).bindPopup(trackPopupHtml(v)).addTo(track.map);
            track.markers[v.id].on('click', () => selectTrackedVehicle(v.id, false));
        }
    });
    Object.keys(track.markers).forEach(id => {
        if (!seen.has(Number(id))) {
            track.map.removeLayer(track.markers[id]);
            delete track.markers[id];
        }
    });

    if (!track.fitted && seen.size) {
        track.map.fitBounds(L.latLngBounds(Object.values(track.markers).map(m => m.getLatLng())), { padding: [40, 40], maxZoom: 13 });
        track.fitted = true;
    }

    renderTrackList();
    if (track.selected) drawTrackedPath(track.selected);
}

function renderTrackList() {
    const list = document.getElementById('trackList');
    if (!list) return;
    const term = (document.getElementById('trackSearch').value || '').toLowerCase();
    const order = { in_trip: 0, available: 1, maintenance: 2, inactive: 3 };
    const vehicles = track.vehicles
        .filter(v => `${v.plate} ${v.brand} ${v.model} ${v.trip ? v.trip.driver_name : ''}`.toLowerCase().includes(term))
        .sort((a, b) => (order[a.status] - order[b.status]) || a.plate.localeCompare(b.plate));

    if (!vehicles.length) {
        list.innerHTML = emptyBlock({ icon: 'fa-car-side', text: 'Nenhum veículo encontrado.' });
        return;
    }

    list.innerHTML = vehicles.map(v => {
        const fresh = positionFreshness(v);
        const meta = fresh === 'none' ? 'Sem posição' : timeAgo(new Date(v.last_position_at));
        return `
            <button class="live-item ${track.selected === v.id ? 'active' : ''}" onclick="selectTrackedVehicle(${Number(v.id)})">
                <span class="live-dot ${fresh === 'online' ? 'online' : fresh === 'stale' ? 'stale' : ''}"></span>
                <span class="list-content">
                    <span class="list-title">${escapeHtml(v.plate)} · ${escapeHtml(v.brand)} ${escapeHtml(v.model)}</span>
                    <span class="list-sub">${v.trip ? `${escapeHtml(v.trip.driver_name || '')} · ${escapeHtml(v.trip.destination_name)}` : STATUS_LABELS[v.status]}</span>
                </span>
                <span class="list-meta">${escapeHtml(meta)}${v.last_speed !== null && fresh === 'online' ? `<strong>${Math.round(v.last_speed)} km/h</strong>` : ''}</span>
            </button>`;
    }).join('');
}

async function selectTrackedVehicle(id, pan = true) {
    track.selected = id;
    const v = track.vehicles.find(x => x.id === id);
    renderTrackList();
    if (!v) return;
    if (pan && v.last_lat !== null) {
        track.map.setView([v.last_lat, v.last_lng], 13);
        track.markers[id] && track.markers[id].openPopup();
    }
    if (pan && v.last_lat === null) showToast('Este veículo ainda não enviou posição.', 'info');
    drawTrackedPath(id);
}

async function drawTrackedPath(id) {
    const v = track.vehicles.find(x => x.id === id);
    track.pathLayer.clearLayers();
    if (!v || !v.trip) return;
    const positions = await fetchJSON(`/api/trips/${v.trip.id}/positions`, []);
    if (positions.length > 1) {
        L.polyline(positions.map(p => [p.lat, p.lng]), { color: '#2563eb', weight: 4, opacity: 0.8 }).addTo(track.pathLayer);
    }
    if (v.trip.destination_lat !== null && v.trip.destination_lat !== undefined) {
        L.circleMarker([v.trip.destination_lat, v.trip.destination_lng], { radius: 8, color: '#fff', weight: 2, fillColor: '#dc2626', fillOpacity: 1 })
            .bindTooltip(`Destino: ${v.trip.destination_name}`).addTo(track.pathLayer);
    }
}
