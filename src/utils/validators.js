// Funções de validação reutilizáveis pelas rotas da API
const ErrorResponse = require('./errorResponse');

const PLATE_MERCOSUL = /^[A-Z]{3}[0-9][A-Z][0-9]{2}$/;
const PLATE_OLD = /^[A-Z]{3}[0-9]{4}$/;

const VEHICLE_FUEL_TYPES = ['Flex', 'Gasolina', 'Álcool', 'Diesel', 'GNV', 'Elétrico', 'Híbrido'];
const VEHICLE_STATUS = ['available', 'in_trip', 'maintenance', 'inactive'];
const VEHICLE_TYPES = ['carro', 'moto', 'utilitario', 'van', 'caminhao', 'onibus'];
const FUEL_TYPES = [
    'Gasolina Comum', 'Gasolina Aditivada', 'Álcool Comum', 'Álcool Aditivado',
    'Diesel S10', 'Diesel S500', 'Diesel Aditivado', 'GNV', 'Eletricidade'
];

const COMPATIBLE_FUELS = {
    'Flex': ['Gasolina Comum', 'Gasolina Aditivada', 'Álcool Comum', 'Álcool Aditivado'],
    'Gasolina': ['Gasolina Comum', 'Gasolina Aditivada'],
    'Álcool': ['Álcool Comum', 'Álcool Aditivado'],
    'Diesel': ['Diesel S10', 'Diesel S500', 'Diesel Aditivado'],
    'GNV': ['GNV'],
    'Elétrico': ['Eletricidade'],
    'Híbrido': ['Gasolina Comum', 'Gasolina Aditivada', 'Álcool Comum', 'Álcool Aditivado', 'Eletricidade']
};

// Categorias da CNH e categoria mínima exigida por tipo de veículo
const CNH_CATEGORIES = ['A', 'B', 'C', 'D', 'E', 'AB', 'AC', 'AD', 'AE'];
const REQUIRED_CATEGORY = { moto: 'A', carro: 'B', utilitario: 'B', van: 'B', caminhao: 'C', onibus: 'D' };

// Hierarquia: C inclui B; D inclui B e C; E inclui B, C e D. "A" é independente.
function categoryAllows(category, required) {
    const cat = String(category || '').toUpperCase();
    if (required === 'A') return cat.includes('A');
    const rank = { B: 1, C: 2, D: 3, E: 4 };
    const letters = cat.replace('A', '');
    const held = Math.max(0, ...letters.split('').map(l => rank[l] || 0));
    return held >= rank[required];
}

function normalizePlate(plate) {
    return String(plate || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function isValidPlate(plate) {
    return PLATE_MERCOSUL.test(plate) || PLATE_OLD.test(plate);
}

function isValidCPF(value) {
    const cpf = String(value || '').replace(/\D/g, '');
    if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
    const digit = (len) => {
        let sum = 0;
        for (let i = 0; i < len; i++) sum += Number(cpf[i]) * (len + 1 - i);
        const rest = (sum * 10) % 11;
        return rest === 10 ? 0 : rest;
    };
    return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
}

// Algoritmo oficial dos dígitos verificadores da CNH (11 dígitos)
function cnhCheckDigits(base9) {
    let sum = 0;
    for (let i = 0, j = 9; i < 9; i++, j--) sum += Number(base9[i]) * j;
    let dv1 = sum % 11;
    let discount = 0;
    if (dv1 >= 10) { dv1 = 0; discount = 2; }
    sum = 0;
    for (let i = 0, j = 1; i < 9; i++, j++) sum += Number(base9[i]) * j;
    const x = sum % 11;
    const dv2 = x >= 10 ? 0 : x - discount;
    return dv2 < 0 ? null : `${dv1}${dv2}`;
}

function isValidCNH(value) {
    const cnh = String(value || '').replace(/\D/g, '');
    if (cnh.length !== 11 || /^(\d)\1{10}$/.test(cnh)) return false;
    return cnhCheckDigits(cnh.slice(0, 9)) === cnh.slice(9);
}

// Converte "1.234,56", "5,89", "40.5" ou 40.5 em número. Retorna null se vazio e NaN se inválido.
function toNumber(value) {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
    const s = String(value).trim();
    if (s === '') return null;
    const normalized = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
    const n = Number(normalized);
    return Number.isFinite(n) ? n : NaN;
}

function requireText(value, field, { min = 1, max = 120 } = {}) {
    const s = String(value ?? '').trim();
    if (s.length < min) throw new ErrorResponse(`${field} é obrigatório.`, 400);
    if (s.length > max) throw new ErrorResponse(`${field} deve ter no máximo ${max} caracteres.`, 400);
    return s;
}

function optionalText(value, field, max = 255) {
    const s = String(value ?? '').trim();
    if (s.length > max) throw new ErrorResponse(`${field} deve ter no máximo ${max} caracteres.`, 400);
    return s || null;
}

function requireNumber(value, field, { min = -Infinity, max = Infinity, required = true, integer = false } = {}) {
    const n = toNumber(value);
    if (n === null) {
        if (required) throw new ErrorResponse(`${field} é obrigatório.`, 400);
        return null;
    }
    if (Number.isNaN(n)) throw new ErrorResponse(`${field} deve ser um número válido.`, 400);
    if (integer && !Number.isInteger(n)) throw new ErrorResponse(`${field} deve ser um número inteiro.`, 400);
    if (n < min) throw new ErrorResponse(`${field} deve ser no mínimo ${min}.`, 400);
    if (n > max) throw new ErrorResponse(`${field} deve ser no máximo ${max}.`, 400);
    return n;
}

function requireId(value, field) {
    return requireNumber(value, field, { min: 1, integer: true });
}

function oneOf(value, list, field, fallback) {
    const s = value === undefined || value === null || value === '' ? fallback : String(value);
    if (!list.includes(s)) throw new ErrorResponse(`${field} inválido.`, 400);
    return s;
}

function pad(n) {
    return String(n).padStart(2, '0');
}

function formatBR(date) {
    return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

function formatISODate(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// "AAAA-MM-DDTHH:MM" no horário local (mesmo formato do <input type="datetime-local">)
function formatLocalDateTime(date) {
    return `${formatISODate(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function endOfToday() {
    const d = new Date();
    d.setHours(23, 59, 59, 999);
    return d;
}

// Aceita "AAAA-MM-DD" ou "DD/MM/AAAA" e devolve sempre "DD/MM/AAAA"
function parseDateBR(value, field = 'Data', { allowFuture = false } = {}) {
    if (!value) return formatBR(new Date());
    const s = String(value).trim();
    let d, m, y, match;
    if ((match = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) [, y, m, d] = match;
    else if ((match = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/))) [, d, m, y] = match;
    else throw new ErrorResponse(`${field} inválida. Use o formato DD/MM/AAAA.`, 400);

    const date = new Date(Number(y), Number(m) - 1, Number(d));
    if (date.getFullYear() !== Number(y) || date.getMonth() !== Number(m) - 1 || date.getDate() !== Number(d)) {
        throw new ErrorResponse(`${field} inválida.`, 400);
    }
    if (!allowFuture && date > endOfToday()) throw new ErrorResponse(`${field} não pode estar no futuro.`, 400);
    return `${d}/${m}/${y}`;
}

// "AAAA-MM-DD" (aceita também "DD/MM/AAAA")
function parseDateISO(value, field = 'Data', { allowFuture = true, allowPast = true, required = true } = {}) {
    if (!value) {
        if (required) throw new ErrorResponse(`${field} é obrigatória.`, 400);
        return null;
    }
    let s = String(value).trim();
    const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (br) s = `${br[3]}-${br[2]}-${br[1]}`;
    const match = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) throw new ErrorResponse(`${field} inválida.`, 400);

    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) {
        throw new ErrorResponse(`${field} inválida.`, 400);
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (!allowFuture && date > endOfToday()) throw new ErrorResponse(`${field} não pode estar no futuro.`, 400);
    if (!allowPast && date < today) throw new ErrorResponse(`${field} não pode estar no passado.`, 400);
    return s;
}

// "AAAA-MM-DDTHH:MM"
function parseDateTime(value, field = 'Data e hora', { required = true } = {}) {
    if (!value) {
        if (required) throw new ErrorResponse(`${field} é obrigatória.`, 400);
        return null;
    }
    const s = String(value).trim().replace(' ', 'T').slice(0, 16);
    const match = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
    if (!match) throw new ErrorResponse(`${field} inválida.`, 400);
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]));
    if (Number.isNaN(date.getTime()) || date.getDate() !== Number(match[3])) throw new ErrorResponse(`${field} inválida.`, 400);
    return s;
}

// Converte "DD/MM/AAAA" ou "AAAA-MM-DD..." em Date (ou null)
function toDate(value) {
    if (!value) return null;
    let m = String(value).match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
    m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
    return null;
}

function daysBetween(from, to) {
    const a = new Date(from); a.setHours(0, 0, 0, 0);
    const b = new Date(to); b.setHours(0, 0, 0, 0);
    return Math.round((b - a) / 86400000);
}

function pickDefined(obj, keys) {
    const out = {};
    keys.forEach(k => { if (obj && obj[k] !== undefined) out[k] = obj[k]; });
    return out;
}

module.exports = {
    VEHICLE_FUEL_TYPES, VEHICLE_STATUS, VEHICLE_TYPES, FUEL_TYPES, COMPATIBLE_FUELS,
    CNH_CATEGORIES, REQUIRED_CATEGORY, categoryAllows,
    normalizePlate, isValidPlate, isValidCPF, isValidCNH, cnhCheckDigits,
    toNumber, requireText, optionalText, requireNumber, requireId, oneOf,
    formatBR, formatISODate, formatLocalDateTime, parseDateBR, parseDateISO, parseDateTime,
    toDate, daysBetween, pickDefined
};
