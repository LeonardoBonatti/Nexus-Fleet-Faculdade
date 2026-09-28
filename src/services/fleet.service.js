// Regras compartilhadas da frota (odômetro, aptidão do motorista, viagens)
const { get, run } = require('../database/query');
const ErrorResponse = require('../utils/errorResponse');
const { REQUIRED_CATEGORY, categoryAllows } = require('../utils/validators');

const VEHICLE_TYPE_LABELS = {
    carro: 'Carro', moto: 'Moto', utilitario: 'Utilitário', van: 'Van', caminhao: 'Caminhão', onibus: 'Ônibus'
};

const vehicleLabel = v => `${v.brand} ${v.model} (${v.plate})`;

// "AAAA-MM-DD" → "DD/MM/AAAA"
function isoToBr(iso) {
    if (!iso) return '';
    const [y, m, d] = String(iso).slice(0, 10).split('-');
    return `${d}/${m}/${y}`;
}

// "AAAA-MM-DDTHH:MM" → "DD/MM/AAAA HH:MM"
function formatDateTimeBr(value) {
    if (!value) return '';
    return `${isoToBr(value)} ${String(value).slice(11, 16)}`.trim();
}

async function getOwned(table, id, companyId, label) {
    const row = id ? await get(`SELECT * FROM ${table} WHERE id = ? AND company_id = ?`, [id, companyId]) : null;
    if (!row) throw new ErrorResponse(`${label} não encontrado(a).`, 404);
    return row;
}

// Maior quilometragem conhecida do veículo (cadastro, abastecimentos, manutenções e viagens)
async function lastOdometer(companyId, vehicleId) {
    const vehicle = await get(`SELECT current_odometer FROM vehicles WHERE id = ? AND company_id = ?`, [vehicleId, companyId]);
    const fuel = await get(`SELECT MAX(odometer) AS m FROM fuels WHERE vehicle_id = ? AND company_id = ?`, [vehicleId, companyId]);
    const maint = await get(`SELECT MAX(odometer) AS m FROM maintenances WHERE vehicle_id = ? AND company_id = ? AND status = 'completed'`, [vehicleId, companyId]);
    const trip = await get(`SELECT MAX(start_odometer) AS s, MAX(end_odometer) AS e FROM trips WHERE vehicle_id = ? AND company_id = ?`, [vehicleId, companyId]);
    return Math.max(
        (vehicle && vehicle.current_odometer) || 0,
        (fuel && fuel.m) || 0,
        (maint && maint.m) || 0,
        (trip && trip.s) || 0,
        (trip && trip.e) || 0
    );
}

async function lastFuelOdometer(companyId, vehicleId, excludeId = -1) {
    const row = await get(`SELECT MAX(odometer) AS m FROM fuels WHERE vehicle_id = ? AND company_id = ? AND id <> ?`, [vehicleId, companyId, excludeId]);
    return (row && row.m) || 0;
}

// RF03 — mantém a quilometragem atual do veículo sempre atualizada
async function bumpOdometer(companyId, vehicleId, value) {
    if (!value || value <= 0) return;
    await run(
        `UPDATE vehicles SET current_odometer = GREATEST(COALESCE(current_odometer, 0), ?) WHERE id = ? AND company_id = ?`,
        [value, vehicleId, companyId]
    );
}

// Restrição do projeto: apenas motoristas habilitados e aptos podem dirigir
function assertDriverFit(driver, vehicle, atDateISO) {
    if (driver.status !== 'active') {
        throw new ErrorResponse(`O motorista ${driver.name} está inativo.`, 400);
    }
    if (driver.cnh_expiry < atDateISO) {
        throw new ErrorResponse(`CNH de ${driver.name} vencida em ${isoToBr(driver.cnh_expiry)}. Motoristas com CNH vencida não podem ser escalados.`, 400);
    }
    const required = REQUIRED_CATEGORY[vehicle.vehicle_type] || 'B';
    if (!categoryAllows(driver.cnh_category, required)) {
        const typeLabel = (VEHICLE_TYPE_LABELS[vehicle.vehicle_type] || 'veículo').toLowerCase();
        throw new ErrorResponse(`A CNH categoria ${driver.cnh_category} de ${driver.name} não permite conduzir ${typeLabel} (exige categoria ${required}).`, 400);
    }
}

// RF09 — descobre qual viagem (e motorista) usava o veículo em uma data/hora
async function findTripAt(companyId, vehicleId, dateISO, time = null) {
    const from = `${dateISO}T${time || '00:00'}`;
    const to = `${dateISO}T${time || '23:59'}`;
    return get(
        `SELECT t.*, d.name AS driver_name
         FROM trips t LEFT JOIN drivers d ON d.id = t.driver_id
         WHERE t.company_id = ? AND t.vehicle_id = ? AND t.status IN ('in_progress', 'completed')
           AND IFNULL(t.actual_start, t.planned_start) <= ?
           AND IFNULL(t.actual_end, t.planned_end) >= ?
         ORDER BY t.id DESC LIMIT 1`,
        [companyId, vehicleId, to, from]
    );
}

// Libera o veículo quando não há mais manutenção em andamento
async function releaseVehicleFromMaintenance(companyId, vehicleId) {
    const vehicle = await get(`SELECT status FROM vehicles WHERE id = ? AND company_id = ?`, [vehicleId, companyId]);
    if (!vehicle || vehicle.status !== 'maintenance') return vehicle ? vehicle.status : null;
    const pending = await get(
        `SELECT COUNT(*) AS n FROM maintenances WHERE company_id = ? AND vehicle_id = ? AND status = 'in_progress'`,
        [companyId, vehicleId]
    );
    if (pending.n > 0) return 'maintenance';
    await run(`UPDATE vehicles SET status = 'available' WHERE id = ? AND company_id = ?`, [vehicleId, companyId]);
    return 'available';
}

module.exports = {
    VEHICLE_TYPE_LABELS, vehicleLabel, isoToBr, formatDateTimeBr, getOwned,
    lastOdometer, lastFuelOdometer, bumpOdometer, assertDriverFit, findTripAt, releaseVehicleFromMaintenance
};
