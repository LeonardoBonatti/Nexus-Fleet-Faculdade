// Agenda de obrigações e postos de combustível
const ErrorResponse = require('../utils/errorResponse');
const v = require('../utils/validators');
const { queueCheck } = require('../services/notification.service');

const MANAGERS = ['admin', 'gestor'];

const reminders = {
    table: 'reminders',
    label: 'Compromisso',
    trash: false,
    orderBy: 'date ASC',
    roles: { read: ['admin', 'gestor', 'financeiro'], create: MANAGERS, update: MANAGERS, delete: MANAGERS },
    describe: row => row.title,

    present(row) {
        return { ...row, completed: !!row.completed };
    },

    async build(body, current) {
        const m = { ...(current || {}), ...v.pickDefined(body, ['title', 'date', 'description', 'completed']) };
        const completed = m.completed === true || m.completed === 1 || m.completed === 'true' ? 1 : 0;
        let completedAt = current ? current.completed_at : null;
        if (completed && !(current && current.completed)) completedAt = v.formatBR(new Date());
        if (!completed) completedAt = null;

        return {
            title: v.requireText(m.title, 'Título', { max: 120 }),
            date: v.parseDateISO(m.date, 'Data limite'),
            description: v.optionalText(m.description, 'Descrição', 255),
            completed,
            completed_at: completedAt
        };
    },

    async afterWrite(action, row, ctx) {
        queueCheck(ctx.companyId);
    }
};

const stations = {
    table: 'stations',
    label: 'Posto',
    trash: false,
    orderBy: 'name COLLATE NOCASE ASC',
    roles: {
        read: ['admin', 'gestor', 'motorista', 'financeiro'],
        create: ['admin', 'gestor', 'motorista'],
        update: MANAGERS,
        delete: MANAGERS
    },
    describe: row => row.name,

    async build(body, current) {
        const m = { ...(current || {}), ...v.pickDefined(body, ['name', 'lat', 'lng', 'price_gas', 'price_gas_ad', 'price_alcool', 'price_diesel', 'price_gnv']) };
        const priceOpts = { min: 0.01, max: 100, required: false };
        const data = {
            name: v.requireText(m.name, 'Nome do posto', { max: 120 }),
            lat: v.requireNumber(m.lat, 'Latitude', { min: -90, max: 90 }),
            lng: v.requireNumber(m.lng, 'Longitude', { min: -180, max: 180 }),
            price_gas: v.requireNumber(m.price_gas, 'Preço da gasolina comum', priceOpts),
            price_gas_ad: v.requireNumber(m.price_gas_ad, 'Preço da gasolina aditivada', priceOpts),
            price_alcool: v.requireNumber(m.price_alcool, 'Preço do etanol', priceOpts),
            price_diesel: v.requireNumber(m.price_diesel, 'Preço do diesel', priceOpts),
            price_gnv: v.requireNumber(m.price_gnv, 'Preço do GNV', priceOpts)
        };
        if ([data.price_gas, data.price_gas_ad, data.price_alcool, data.price_diesel, data.price_gnv].every(p => p === null)) {
            throw new ErrorResponse('Informe ao menos um preço de combustível.', 400);
        }
        return data;
    }
};

module.exports = { reminders, stations };
