// RNF03 — Criptografia de dados sensíveis (CPF e CNH) em repouso.
// AES-256-GCM (confidencialidade + integridade) com IV aleatório por valor.
// Para busca e unicidade sem descriptografar, usa-se um "blind index" (HMAC-SHA256).
const crypto = require('crypto');
const { JWT_SECRET } = require('../config/auth');

function loadKey() {
    const raw = process.env.DATA_ENCRYPTION_KEY;
    if (raw) {
        const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
        if (key.length === 32) return key;
        console.warn('⚠️  DATA_ENCRYPTION_KEY inválida (use 64 caracteres hexadecimais). Derivando chave do JWT_SECRET.');
    } else {
        console.warn('⚠️  DATA_ENCRYPTION_KEY não definida — derivando chave do JWT_SECRET. Defina uma chave própria em produção.');
    }
    return crypto.scryptSync(JWT_SECRET, 'nexusfleet-data-encryption', 32);
}

const KEY = loadKey();
const INDEX_KEY = crypto.createHmac('sha256', KEY).update('blind-index').digest();

function encrypt(plainText) {
    if (plainText === null || plainText === undefined || plainText === '') return null;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
    const encrypted = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decrypt(payload) {
    if (!payload) return null;
    try {
        const [version, iv, tag, data] = String(payload).split(':');
        if (version !== 'v1') return null;
        const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(iv, 'base64'));
        decipher.setAuthTag(Buffer.from(tag, 'base64'));
        return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
    } catch (e) {
        console.error('Falha ao descriptografar um valor (chave alterada?)');
        return null;
    }
}

function blindIndex(value) {
    return crypto.createHmac('sha256', INDEX_KEY).update(String(value)).digest('hex');
}

const onlyDigits = value => String(value || '').replace(/\D/g, '');

function maskCpf(lastDigits) {
    return lastDigits ? `***.***.*${lastDigits.slice(0, 2)}-${lastDigits.slice(2)}` : '—';
}

function maskCnh(lastDigits) {
    return lastDigits ? `*******${lastDigits}` : '—';
}

function formatCpf(cpf) {
    const d = onlyDigits(cpf);
    return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : cpf;
}

module.exports = { encrypt, decrypt, blindIndex, onlyDigits, maskCpf, maskCnh, formatCpf };
