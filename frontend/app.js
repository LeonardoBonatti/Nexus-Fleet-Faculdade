// =========================================================================
// NexusFleet — Núcleo do Frontend
// Organização dos scripts:
//   app.js          → utilitários, API, perfis de acesso, layout, roteador, notificações
//   js/records.js   → cadastros básicos (veículos, abastecimentos, manutenções, lixeira)
//   js/pages.js     → telas analíticas (dashboard, financeiro, saúde, agenda, mapas...)
//   js/fleet.js     → motoristas, viagens, checklists, rastreamento, multas, documentos, ocorrências
//   js/admin.js     → relatórios de custos, usuários, auditoria e status do sistema
//   js/export.js    → exportação em PDF e Excel
// =========================================================================

// ==========================================
// API
// ==========================================
async function apiFetch(url, options = {}) {
    const token = localStorage.getItem('fcs_auth');
    const headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    };

    const response = await fetch(url, { ...options, headers });

    if (response.status === 401) {
        localStorage.removeItem('fcs_auth');
        window.location.href = 'login.html';
        throw new Error('Sessão expirada. Redirecionando...');
    }
    return response;
}

// Lista um recurso de /api/data; em caso de falha ou sem permissão devolve lista vazia
async function fetchTable(table) {
    try {
        const res = await apiFetch(`/api/data/${table}`);
        if (!res.ok) return [];
        const data = await res.json();
        return Array.isArray(data) ? data : [];
    } catch (e) {
        console.error(`Erro ao carregar ${table}:`, e);
        return [];
    }
}

async function fetchJSON(url, fallback = null) {
    try {
        const res = await apiFetch(url);
        if (!res.ok) return fallback;
        return await res.json();
    } catch (e) {
        return fallback;
    }
}

async function apiSend(url, method, body) {
    try {
        const res = await apiFetch(url, { method, body: body ? JSON.stringify(body) : undefined });
        const data = await res.json().catch(() => ({}));
        return { ok: res.ok, status: res.status, data };
    } catch (e) {
        return { ok: false, status: 0, data: { error: 'Falha de conexão com o servidor.' } };
    }
}

// ==========================================
// Segurança: escapa HTML antes de inserir dados via innerHTML (evita XSS)
// ==========================================
function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderRichText(text) {
    return escapeHtml(text)
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/\n/g, '<br>');
}

// ==========================================
// Notificações rápidas (toast)
// ==========================================
function showToast(message, type = 'success') {
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        document.body.appendChild(container);
    }
    const icons = { success: 'fa-circle-check', error: 'fa-circle-exclamation', info: 'fa-circle-info' };
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
    toast.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}"></i><span>${escapeHtml(message)}</span>`;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, type === 'error' ? 6000 : 4000);
}

// ==========================================
// Datas e números
// ==========================================
function parseAnyDate(str) {
    if (!str) return null;
    let m = String(str).match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
    m = String(str).match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
    return null;
}

// Datas gravadas pelo banco (UTC, "AAAA-MM-DD HH:MM:SS")
function parseUtc(value) {
    if (!value) return null;
    if (/T.*Z$/.test(value)) return new Date(value);
    return new Date(`${String(value).replace(' ', 'T')}Z`);
}

function brToIsoDate(value) {
    const d = value instanceof Date ? value : parseAnyDate(value);
    if (!d) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function todayIso() {
    return brToIsoDate(new Date());
}

// "AAAA-MM-DDTHH:MM" local
function localDateTimeValue(date = new Date()) {
    const pad = n => String(n).padStart(2, '0');
    return `${brToIsoDate(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDateBR(value) {
    const d = parseAnyDate(value);
    return d ? d.toLocaleDateString('pt-BR') : '—';
}

function formatDateTimeBR(value) {
    const d = parseAnyDate(value);
    return d ? `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : '—';
}

// Data/hora gravada em UTC pelo banco, exibida no horário local
function formatUtcDateTime(value) {
    const d = parseUtc(value);
    return d && !Number.isNaN(d.getTime())
        ? d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : '—';
}

function formatBRL(value) {
    return 'R$ ' + (parseFloat(value) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatNumber(value, decimals = 1) {
    return (parseFloat(value) || 0).toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function relativeDays(date) {
    if (!date) return '';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(date);
    target.setHours(0, 0, 0, 0);
    const diff = Math.round((target - today) / 86400000);
    if (diff === 0) return 'Hoje';
    if (diff === 1) return 'Amanhã';
    if (diff === -1) return 'Ontem';
    return diff > 0 ? `Em ${diff} dias` : `Há ${Math.abs(diff)} dias`;
}

function timeAgo(date) {
    if (!date) return '';
    const seconds = Math.round((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return 'agora';
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `há ${minutes} min`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `há ${hours} h`;
    return `há ${Math.round(hours / 24)} dia(s)`;
}

function maskCurrency(input) {
    let value = input.value.replace(/\D/g, '');
    if (value === '') {
        input.value = '';
        return;
    }
    value = (parseInt(value, 10) / 100).toFixed(2).replace('.', ',');
    input.value = value.replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1.');
}

function parseBrazilianValue(val) {
    if (val === null || val === undefined || val === '') return 0;
    if (typeof val === 'number') return val;
    return parseFloat(String(val).replace(/\./g, '').replace(',', '.')) || 0;
}

function chartTheme() {
    const dark = document.body.classList.contains('dark-mode');
    return {
        text: dark ? '#a3adbd' : '#64748b',
        grid: dark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.06)',
        surface: dark ? '#111827' : '#ffffff',
        primary: dark ? '#3b82f6' : '#2563eb',
        palette: { blue: '#3b82f6', green: '#10b981', amber: '#f59e0b', violet: '#8b5cf6', red: '#ef4444', slate: '#94a3b8' }
    };
}

// ==========================================
// Indicadores calculados a partir dos dados cadastrados
// ==========================================
const NexusAnalytics = {
    vehicleEfficiency(vehicle, fuels) {
        const list = fuels
            .filter(f => String(f.vehicle_id) === String(vehicle.id) && parseFloat(f.odometer) > 0 && f.fuel_type !== 'Eletricidade')
            .sort((a, b) => parseFloat(a.odometer) - parseFloat(b.odometer));
        if (list.length < 2) return null;
        const distance = parseFloat(list[list.length - 1].odometer) - parseFloat(list[0].odometer);
        const liters = list.slice(1).reduce((acc, f) => acc + (parseFloat(f.liters) || 0), 0);
        if (distance <= 0 || liters <= 0) return null;
        return { kmPerLiter: distance / liters, distance, liters, samples: list.length };
    },

    fleetEfficiency(vehicles, fuels) {
        let distance = 0, liters = 0;
        vehicles.forEach(v => {
            const e = this.vehicleEfficiency(v, fuels);
            if (e) { distance += e.distance; liters += e.liters; }
        });
        return liters > 0 ? distance / liters : null;
    },

    costPerKm(vehicle, fuels, manuts) {
        const eff = this.vehicleEfficiency(vehicle, fuels);
        if (!eff) return null;
        const same = r => String(r.vehicle_id) === String(vehicle.id);
        const total = [...fuels.filter(same), ...manuts.filter(same)].reduce((a, r) => a + (parseFloat(r.cost) || 0), 0);
        return total / eff.distance;
    },

    monthKey(date) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    },

    monthlyTotals(records) {
        const map = {};
        records.forEach(r => {
            const d = parseAnyDate(r.date);
            if (!d) return;
            const key = this.monthKey(d);
            map[key] = (map[key] || 0) + (parseFloat(r.cost) || 0);
        });
        return map;
    },

    lastMonths(records, n = 6) {
        const totals = this.monthlyTotals(records);
        const now = new Date();
        const out = [];
        for (let i = n - 1; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const key = this.monthKey(d);
            const label = d.toLocaleString('pt-BR', { month: 'short' }).replace('.', '') + '/' + String(d.getFullYear()).slice(2);
            out.push({ key, label, total: totals[key] || 0 });
        }
        return out;
    },

    linearForecast(values, ahead = 3) {
        const n = values.length;
        if (n === 0) return Array(ahead).fill(0);
        const meanX = (n - 1) / 2;
        const meanY = values.reduce((a, b) => a + b, 0) / n;
        let num = 0, den = 0;
        values.forEach((y, x) => { num += (x - meanX) * (y - meanY); den += (x - meanX) ** 2; });
        const slope = den === 0 ? 0 : num / den;
        const intercept = meanY - slope * meanX;
        return Array.from({ length: ahead }, (_, k) => Math.max(0, intercept + slope * (n + k)));
    },

    filterByPeriod(records, days) {
        if (!days) return records;
        const limit = new Date();
        limit.setHours(0, 0, 0, 0);
        limit.setDate(limit.getDate() - days);
        return records.filter(r => {
            const d = parseAnyDate(r.date);
            return d && d >= limit;
        });
    }
};

// Somente manutenções concluídas contam como custo e para a saúde dos componentes
const completedMaintenances = manuts => (manuts || []).filter(m => (m.status || 'completed') === 'completed');

async function fetchCompletedMaintenances() {
    return completedMaintenances(await fetchTable('maintenances'));
}

const HEALTH_RULES = {
    engine: { keywords: ['óleo', 'oleo', 'revisão geral', 'revisao geral'], maxDays: 180, maxKm: 10000 },
    tires:  { keywords: ['pneu', 'alinhamento', 'revisão geral', 'revisao geral'], maxDays: 730, maxKm: 40000 },
    brakes: { keywords: ['freio', 'revisão geral', 'revisao geral'], maxDays: 365, maxKm: 30000 }
};

function evaluateVehicleHealth(vehicle, allMaintenances, allFuels = []) {
    const now = new Date();
    const sameVehicle = r => String(r.vehicle_id) === String(vehicle.id);
    const vManuts = completedMaintenances(allMaintenances).filter(sameVehicle);
    const vFuels = (allFuels || []).filter(sameVehicle);

    const readings = [...vFuels, ...vManuts].map(r => parseFloat(r.odometer) || 0).filter(o => o > 0);
    if (vehicle.current_odometer > 0) readings.push(parseFloat(vehicle.current_odometer));
    const currentOdo = readings.length ? Math.max(...readings) : 0;
    const firstOdo = readings.length ? Math.min(...readings) : 0;
    const baseDate = parseAnyDate(vehicle.created_at) || now;

    const componentHealth = ({ keywords, maxDays, maxKm }) => {
        const last = vManuts
            .filter(m => keywords.some(k => String(m.service || '').toLowerCase().includes(k)))
            .sort((a, b) => (parseAnyDate(b.date) || 0) - (parseAnyDate(a.date) || 0))[0];

        const lastDate = last ? (parseAnyDate(last.date) || baseDate) : baseDate;
        let wear = Math.max(0, (now - lastDate) / 86400000) / maxDays;

        if (currentOdo > 0) {
            const startOdo = last && parseFloat(last.odometer) > 0 ? parseFloat(last.odometer) : firstOdo;
            const km = currentOdo - startOdo;
            if (km > 0) wear = Math.max(wear, km / maxKm);
        }
        return Math.max(0, Math.min(100, Math.round(100 - wear * 100)));
    };

    const engineHp = componentHealth(HEALTH_RULES.engine);
    const tiresHp = componentHealth(HEALTH_RULES.tires);
    const breaksHp = componentHealth(HEALTH_RULES.brakes);
    const minHp = Math.min(engineHp, tiresHp, breaksHp);

    let status = 'ok';
    if (minHp < 30) status = 'crit';
    else if (minHp < 65) status = 'warn';

    return { engineHp, tiresHp, breaksHp, minHp, status };
}

function buildHealthAlerts(vehicles, manuts, fuels) {
    const alerts = [];
    vehicles.filter(v => v.status !== 'inactive').forEach(v => {
        const h = evaluateVehicleHealth(v, manuts, fuels);
        const name = `${v.brand} ${v.model} (${v.plate})`;
        const push = (hp, component, icon, desc, rec) => {
            if (hp >= 65) return;
            alerts.push({ type: hp < 30 ? 'critical' : 'warning', vehicle: name, vehicleId: v.id, plate: v.plate, component, icon, value: hp, desc, rec });
        };
        push(h.engineHp, 'Óleo do motor', 'fa-oil-can', `Vida útil estimada do óleo em ${h.engineHp}% (intervalo: 6 meses ou 10.000 km).`, 'Registrar uma Troca de Óleo e Filtro.');
        push(h.tiresHp, 'Pneus e alinhamento', 'fa-circle-dot', `Vida útil estimada dos pneus em ${h.tiresHp}% (intervalo: 2 anos ou 40.000 km).`, 'Registrar Troca de Pneus ou Alinhamento e Balanceamento.');
        push(h.breaksHp, 'Freios', 'fa-compact-disc', `Vida útil estimada das pastilhas em ${h.breaksHp}% (intervalo: 1 ano ou 30.000 km).`, 'Registrar revisão de Freios (Pastilhas/Discos).');
    });
    return alerts.sort((a, b) => a.value - b.value);
}

function reminderUrgency(reminder) {
    if (reminder.completed) return 'done';
    const date = parseAnyDate(reminder.date);
    if (!date) return 'normal';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffDays = Math.round((date - today) / 86400000);
    if (diffDays < 0) return 'overdue';
    if (diffDays <= 7) return 'urgent';
    return 'normal';
}

const DEFAULT_STATIONS = [
    { lat: -22.7380, lng: -47.3300, name: 'Posto Ipiranga Centro (Americana)', gas: 5.39, eta: 3.89, die: 5.89 },
    { lat: -22.7445, lng: -47.3201, name: 'Petrobras Av. Brasil (Americana)', gas: 5.55, eta: 3.95, die: 5.99 },
    { lat: -22.7530, lng: -47.3350, name: 'Posto Shell Jd. Ipiranga (Americana)', gas: 5.42, eta: 3.92, die: 5.92 },
    { lat: -22.7310, lng: -47.3450, name: 'Auto Posto Galeria (Americana)', gas: 5.35, eta: 3.85, die: 5.85 },
    { lat: -22.7600, lng: -47.3100, name: 'Posto Ipiranga Portal (Americana)', gas: 5.48, eta: 3.88, die: 5.95 },
    { lat: -22.7505, lng: -47.4100, name: 'Petrobras Tivoli (SBO)', gas: 5.38, eta: 3.88, die: 5.88 },
    { lat: -22.7650, lng: -47.4000, name: 'Shell Rua da Agricultura (SBO)', gas: 5.40, eta: 3.90, die: 5.90 },
    { lat: -22.7550, lng: -47.3900, name: 'Posto Ale Pérola (SBO)', gas: 5.30, eta: 3.80, die: 5.80 },
    { lat: -22.7800, lng: -47.2900, name: 'Petrobras Centro (Nova Odessa)', gas: 5.45, eta: 3.95, die: 5.95 },
    { lat: -22.7750, lng: -47.3000, name: 'Posto Ipiranga Ampélio (Nova Odessa)', gas: 5.49, eta: 3.99, die: 5.99 },
    { lat: -22.8800, lng: -47.0600, name: 'Petrobras Taquaral (Campinas)', gas: 5.65, eta: 4.15, die: 6.15 },
    { lat: -22.8900, lng: -47.0500, name: 'Shell Norte-Sul (Campinas)', gas: 5.69, eta: 4.19, die: 6.19 },
    { lat: -22.9050, lng: -47.0650, name: 'Posto Ipiranga Centro (Campinas)', gas: 5.59, eta: 4.09, die: 6.09 },
    { lat: -22.9150, lng: -47.0700, name: 'Petrobras Amoreiras (Campinas)', gas: 5.52, eta: 4.02, die: 6.02 },
    { lat: -22.8700, lng: -47.0400, name: 'Auto Posto Dom Pedro (Campinas)', gas: 5.75, eta: 4.25, die: 6.25 },
    { lat: -22.8550, lng: -47.0300, name: 'Shell Barão Geraldo (Campinas)', gas: 5.60, eta: 4.10, die: 6.10 },
    { lat: -22.8600, lng: -47.0500, name: 'Posto Ale Unicamp (Campinas)', gas: 5.45, eta: 3.95, die: 5.95 },
    { lat: -22.9200, lng: -47.0800, name: 'Petrobras John Boyd (Campinas)', gas: 5.48, eta: 3.98, die: 5.98 },
    { lat: -22.9500, lng: -47.1000, name: 'Posto Ipiranga Viracopos (Campinas)', gas: 5.80, eta: 4.30, die: 6.30 },
    { lat: -22.9300, lng: -47.0200, name: 'Shell Valinhos (Rodovia)', gas: 5.62, eta: 4.12, die: 6.12 }
];

// Imagens do mapa: servidor oficial do OpenStreetMap, sem chave de acesso.
// (O CARTO, usado antes, passou a exigir API key e os blocos vinham marcados.)
// No tema escuro os blocos são invertidos por CSS — ver .leaflet-tile-pane em
// styles.css — para não depender de um segundo provedor.
const TILE_LAYER_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

function tileLayerUrl() {
    return TILE_LAYER_URL;
}

// ==========================================
// Perfis de acesso (RF14)
// ==========================================
const ROLE_LABELS = {
    admin: 'Administrador',
    gestor: 'Gestor de Frota',
    motorista: 'Motorista',
    financeiro: 'Financeiro / Diretoria'
};

let currentUser = null;

function currentRole() {
    return currentUser ? currentUser.role : null;
}

function hasRole(...roles) {
    return !!currentUser && roles.includes(currentUser.role);
}

// Gestores e administradores podem editar cadastros; financeiro apenas consulta
function canManage() {
    return hasRole('admin', 'gestor');
}

// Oculta tudo que tiver data-roles incompatível com o perfil logado
function applyRoleVisibility(root = document) {
    const role = currentRole();
    root.querySelectorAll('[data-roles]').forEach(el => {
        const roles = el.dataset.roles.split(',').map(r => r.trim());
        el.hidden = !role || !roles.includes(role);
    });
    if (root === document) {
        document.querySelectorAll('#sidebar-nav .nav-section').forEach(section => {
            if (section.dataset.roles && section.hidden) return;
            section.hidden = !section.querySelector('.nav-link:not([hidden])');
        });
    }
}

// ==========================================
// Layout: tema, sidebar e busca do menu
// ==========================================
const isMobileLayout = () => window.matchMedia('(max-width: 1024px)').matches;

function syncThemeIcon() {
    const btn = document.getElementById('themeToggle');
    if (!btn) return;
    btn.innerHTML = document.body.classList.contains('dark-mode') ? '<i class="fa-regular fa-sun"></i>' : '<i class="fa-regular fa-moon"></i>';
}

function toggleTheme() {
    document.body.classList.toggle('dark-mode');
    localStorage.setItem('theme', document.body.classList.contains('dark-mode') ? 'dark' : 'light');
    syncThemeIcon();
    if (['dashboard', 'previsao', 'financeiro', 'mapa_postos', 'rastreamento', 'viagens', 'relatorios'].includes(currentPage)) loadPage(currentPage);
}

function toggleSidebar() {
    if (isMobileLayout()) {
        document.body.classList.toggle('sidebar-open');
    } else {
        document.body.classList.toggle('sidebar-collapsed');
        localStorage.setItem('fcs_sidebar_collapsed', document.body.classList.contains('sidebar-collapsed') ? '1' : '0');
    }
}

function closeMobileSidebar() {
    document.body.classList.remove('sidebar-open');
}

function filterMenu() {
    const term = document.getElementById('menuSearch').value.trim().toLowerCase();
    document.querySelectorAll('#sidebar-nav .nav-section').forEach(section => {
        let visible = 0;
        section.querySelectorAll('.nav-link:not([hidden])').forEach(link => {
            const match = link.textContent.toLowerCase().includes(term);
            link.classList.toggle('is-hidden', !match);
            if (match) visible++;
        });
        section.classList.toggle('is-hidden', visible === 0);
    });
}

// Contador de alertas de manutenção estimados (item "Diagnóstico" do menu)
function setAlertBadge(count) {
    const el = document.getElementById('navAlertBadge');
    if (!el) return;
    el.textContent = count > 99 ? '99+' : String(count);
    el.hidden = count === 0;
}

async function refreshAlertBadge() {
    if (!hasRole('admin', 'gestor', 'financeiro')) return;
    const [vehicles, fuels, manuts] = await Promise.all([fetchTable('vehicles'), fetchTable('fuels'), fetchTable('maintenances')]);
    setAlertBadge(buildHealthAlerts(vehicles, manuts, fuels).length);
}

// ==========================================
// Central de notificações (RF05 / RF13 / HU03)
// ==========================================
const NOTIFICATION_ICONS = {
    cnh: 'fa-id-card', document: 'fa-file-shield', maintenance: 'fa-screwdriver-wrench', preventive: 'fa-gauge-high',
    reminder: 'fa-calendar', fuel_anomaly: 'fa-gas-pump', checklist: 'fa-list-check', occurrence: 'fa-circle-exclamation', fine: 'fa-receipt'
};
const SEVERITY_TONE = { danger: 'danger', warning: 'warning', info: '' };

let notificationTimer = null;

async function loadNotifications() {
    const data = await fetchJSON('/api/notifications?limit=30', null);
    if (!data) return;

    const badge = document.getElementById('topbarAlertBadge');
    badge.textContent = data.unread > 99 ? '99+' : String(data.unread);
    badge.hidden = data.unread === 0;

    const list = document.getElementById('notificationsList');
    if (!data.items.length) {
        list.innerHTML = `
            <div class="empty-state" style="padding: 32px 16px;">
                <div class="empty-icon success"><i class="fa-solid fa-check"></i></div>
                <h3>Nenhuma notificação</h3>
                <p>Alertas de CNH, documentos e manutenções aparecem aqui.</p>
            </div>`;
        return;
    }

    list.innerHTML = data.items.map(n => `
        <button class="notif-item ${n.read_at ? '' : 'is-unread'}" data-id="${Number(n.id)}" data-link="${escapeHtml(n.link_page || '')}">
            <span class="list-icon ${SEVERITY_TONE[n.severity] || ''}"><i class="fa-solid ${NOTIFICATION_ICONS[n.type] || 'fa-bell'}"></i></span>
            <span class="notif-body">
                <span class="notif-title">${escapeHtml(n.title)}</span>
                ${n.message ? `<span class="notif-message">${escapeHtml(n.message)}</span>` : ''}
                <span class="notif-time">${timeAgo(parseUtc(n.created_at))}</span>
            </span>
        </button>`).join('');

    list.querySelectorAll('.notif-item').forEach(item => {
        item.addEventListener('click', async () => {
            await apiSend(`/api/notifications/${item.dataset.id}/read`, 'POST');
            toggleNotificationsPanel(false);
            if (item.dataset.link && PAGE_META[item.dataset.link]) loadPage(item.dataset.link);
            loadNotifications();
        });
    });
}

function toggleNotificationsPanel(force) {
    const panel = document.getElementById('notificationsPanel');
    const btn = document.getElementById('notificationsBtn');
    const open = force !== undefined ? force : !panel.classList.contains('open');
    panel.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', String(open));
    if (open) loadNotifications();
}

async function markAllNotificationsRead() {
    await apiSend('/api/notifications/read-all', 'POST');
    loadNotifications();
}

async function runNotificationCheck() {
    const { ok } = await apiSend('/api/notifications/check', 'POST');
    showToast(ok ? 'Verificação de alertas concluída.' : 'Não foi possível verificar os alertas.', ok ? 'success' : 'error');
    loadNotifications();
}

// ==========================================
// Roteador de telas (SPA)
// ==========================================
const MANAGERS_AND_FINANCE = ['admin', 'gestor', 'financeiro'];
const EVERYONE = ['admin', 'gestor', 'motorista', 'financeiro'];

const PAGE_META = {
    dashboard:     { title: 'Dashboard',           section: 'Visão geral',  roles: MANAGERS_AND_FINANCE },
    assistente:    { title: 'Assistente',          section: 'Visão geral',  roles: MANAGERS_AND_FINANCE },
    viagens:       { title: 'Viagens',             section: 'Operação',     roles: EVERYONE },
    veiculos:      { title: 'Veículos',            section: 'Operação',     roles: MANAGERS_AND_FINANCE },
    motoristas:    { title: 'Motoristas',          section: 'Operação',     roles: MANAGERS_AND_FINANCE },
    abastecimento: { title: 'Abastecimentos',      section: 'Operação',     roles: EVERYONE },
    manutencao:    { title: 'Manutenções',         section: 'Operação',     roles: MANAGERS_AND_FINANCE },
    ocorrencias:   { title: 'Ocorrências',         section: 'Operação',     roles: ['admin', 'gestor', 'motorista'] },
    rastreamento:  { title: 'Rastreamento',        section: 'Monitoramento', roles: ['admin', 'gestor'] },
    saude:         { title: 'Saúde da Frota',      section: 'Monitoramento', roles: MANAGERS_AND_FINANCE },
    diagnostico:   { title: 'Diagnóstico',         section: 'Monitoramento', roles: MANAGERS_AND_FINANCE },
    documentos:    { title: 'Documentos',          section: 'Documentação', roles: MANAGERS_AND_FINANCE },
    multas:        { title: 'Multas',              section: 'Documentação', roles: EVERYONE },
    agenda:        { title: 'Agenda',              section: 'Documentação', roles: MANAGERS_AND_FINANCE },
    relatorios:    { title: 'Relatórios de custos', section: 'Análises',    roles: MANAGERS_AND_FINANCE },
    financeiro:    { title: 'Financeiro',          section: 'Análises',     roles: MANAGERS_AND_FINANCE },
    historico:     { title: 'Histórico',           section: 'Análises',     roles: MANAGERS_AND_FINANCE },
    comparador:    { title: 'Eficiência',          section: 'Análises',     roles: MANAGERS_AND_FINANCE },
    previsao:      { title: 'Previsão de Gastos',  section: 'Análises',     roles: MANAGERS_AND_FINANCE },
    mapa_postos:   { title: 'Mapa de Postos',      section: 'Logística',    roles: EVERYONE },
    usuarios:      { title: 'Usuários e perfis',   section: 'Administração', roles: ['admin'] },
    auditoria:     { title: 'Auditoria',           section: 'Administração', roles: ['admin'] },
    sistema:       { title: 'Status do sistema',   section: 'Administração', roles: ['admin'] }
};

let currentPage = null;
let pageCleanup = null;

function defaultPage() {
    return hasRole('motorista') ? 'viagens' : 'dashboard';
}

// Telas com atualização periódica (ex.: rastreamento) registram aqui como parar
function onPageLeave(fn) {
    pageCleanup = fn;
}

async function loadPage(page) {
    if (!PAGE_META[page]) page = defaultPage();
    if (!PAGE_META[page].roles.includes(currentRole())) {
        showToast('Seu perfil de acesso não permite abrir esta tela.', 'error');
        page = defaultPage();
    }

    if (pageCleanup) {
        try { pageCleanup(); } catch (e) { /* ignora */ }
        pageCleanup = null;
    }

    currentPage = page;
    const meta = PAGE_META[page];
    const pageContainer = document.querySelector('.page-container');

    document.querySelectorAll('#sidebar-nav .nav-link').forEach(link => {
        const active = link.dataset.page === page;
        link.classList.toggle('active', active);
        if (active) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
    });

    document.getElementById('breadcrumbSection').textContent = meta.section;
    document.getElementById('breadcrumbTitle').textContent = page === 'viagens' && hasRole('motorista') ? 'Minhas viagens' : meta.title;
    document.title = `${meta.title} | NexusFleet`;
    closeMobileSidebar();

    pageContainer.innerHTML = '<div class="page-loading"><span class="spinner"></span> Carregando...</div>';

    try {
        const response = await fetch(`/pages/${page}.html`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const html = await response.text();
        if (currentPage !== page) return;

        pageContainer.innerHTML = html;
        applyRoleVisibility(pageContainer);
        window.scrollTo({ top: 0 });
        await setupPageScripts(page);
        if (typeof injectExportButtons === 'function') injectExportButtons(page);
        history.replaceState(null, '', `#${page}`);
    } catch (err) {
        console.error('Erro ao carregar página', err);
        pageContainer.innerHTML = `
            <div class="card">
                <div class="empty-state">
                    <div class="empty-icon"><i class="fa-solid fa-plug-circle-exclamation"></i></div>
                    <h3>Não foi possível carregar esta tela</h3>
                    <p>Verifique sua conexão com o servidor e tente novamente.</p>
                    <button class="btn btn-secondary btn-sm" onclick="loadPage('${page}')"><i class="fa-solid fa-rotate-right"></i> Tentar novamente</button>
                </div>
            </div>`;
    }
}

function navigateTo(pageName) {
    loadPage(pageName);
}

document.addEventListener('DOMContentLoaded', async () => {
    if (window.Chart) {
        Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
        Chart.defaults.font.size = 12;
    }

    syncThemeIcon();
    document.getElementById('themeToggle').addEventListener('click', toggleTheme);
    document.getElementById('toggleSidebar').addEventListener('click', toggleSidebar);
    document.getElementById('sidebarBackdrop').addEventListener('click', closeMobileSidebar);

    document.getElementById('notificationsBtn').addEventListener('click', (e) => {
        e.stopPropagation();
        toggleNotificationsPanel();
    });
    document.addEventListener('click', (e) => {
        const panel = document.getElementById('notificationsPanel');
        if (panel.classList.contains('open') && !panel.contains(e.target)) toggleNotificationsPanel(false);
    });

    document.querySelectorAll('#sidebar-nav .nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            if (link.dataset.action === 'trash') {
                closeMobileSidebar();
                return openProfileModal('trashModal');
            }
            if (link.dataset.page) loadPage(link.dataset.page);
        });
    });

    // O perfil precisa ser conhecido antes de montar o menu e abrir a primeira tela
    const loaded = await loadProfile();
    if (!loaded) return logout();

    applyRoleVisibility(document);
    if (hasRole('motorista')) document.getElementById('navTripsLabel').textContent = 'Minhas viagens';

    const initial = location.hash.replace('#', '');
    loadPage(PAGE_META[initial] ? initial : defaultPage());

    loadNotifications();
    notificationTimer = setInterval(loadNotifications, 60000);
    refreshAlertBadge();
});

// ==========================================
// Perfil do usuário
// ==========================================
function applyProfileToHeader(user) {
    const name = user.name || 'Usuário';
    const roleLabel = user.role_label || ROLE_LABELS[user.role] || user.role;
    ['userNameDisplay', 'dropdownName', 'sidebarUserName'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = name;
    });
    const sidebarRole = document.getElementById('sidebarUserRole');
    if (sidebarRole) sidebarRole.textContent = roleLabel;
    const roleBadge = document.getElementById('dropdownRole');
    if (roleBadge) roleBadge.textContent = roleLabel;
    const emailEl = document.getElementById('dropdownEmail');
    if (emailEl) emailEl.textContent = user.email || '';
    const companyEl = document.getElementById('dropdownCompany');
    if (companyEl) companyEl.textContent = user.company_name || '';

    if (!localStorage.getItem('fcs_avatar') && typeof setAvatars === 'function') setAvatars(avatarUrl(name));
    localStorage.setItem('fcs_username', name);
    localStorage.setItem('fcs_role', user.cargo || '');
}

async function loadProfile() {
    try {
        const res = await apiFetch('/api/users/profile');
        if (!res.ok) return false;
        const { data } = await res.json();
        currentUser = data;
        applyProfileToHeader(data);
        return true;
    } catch (e) {
        return false;
    }
}

async function saveProfileSettings() {
    const name = document.getElementById('settingNameInput').value.trim();
    const cargo = document.getElementById('settingRoleInput').value.trim();
    const { ok, data } = await apiSend('/api/users/profile', 'PUT', { name, cargo });
    if (!ok) return showToast(data.error || 'Não foi possível salvar o perfil.', 'error');
    currentUser = { ...currentUser, ...data.data };
    applyProfileToHeader(data.data);
    closeProfileModal('settingsModal');
    showToast('Perfil atualizado com sucesso!');
}

async function changePassword() {
    const currentEl = document.getElementById('currentPasswordInput');
    const newEl = document.getElementById('newPasswordInput');
    const confirmEl = document.getElementById('confirmPasswordInput');
    if (!currentEl.value || !newEl.value) return showToast('Preencha a senha atual e a nova senha.', 'error');
    if (newEl.value.length < 8) return showToast('A nova senha deve ter no mínimo 8 caracteres.', 'error');
    if (newEl.value !== confirmEl.value) return showToast('A confirmação não confere com a nova senha.', 'error');

    const { ok, data } = await apiSend('/api/users/password', 'PUT', { currentPassword: currentEl.value, newPassword: newEl.value });
    if (!ok) return showToast(data.error || 'Não foi possível alterar a senha.', 'error');
    currentEl.value = newEl.value = confirmEl.value = '';
    showToast('Senha alterada com sucesso!');
}

function logout() {
    if (typeof stopLocationSharing === 'function') stopLocationSharing();
    clearInterval(notificationTimer);
    ['fcs_auth', 'fcs_username', 'fcs_role'].forEach(k => localStorage.removeItem(k));
    window.location.href = 'login.html';
}
