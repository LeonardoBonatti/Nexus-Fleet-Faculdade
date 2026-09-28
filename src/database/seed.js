// Dados de demonstração (ativados com SEED_DEMO=true no .env)
// Cria uma empresa com os 4 perfis de acesso e um histórico realista para apresentação.
const bcrypt = require('bcryptjs');
const { get, run, insertRow } = require('./query');
const { encrypt, blindIndex } = require('../utils/crypto');
const { cnhCheckDigits, formatBR, formatISODate, formatLocalDateTime } = require('../utils/validators');

const DEMO_PASSWORD = 'Senha@123';

function randomDigits(n) {
    return Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');
}

function generateCPF() {
    const base = randomDigits(9);
    const digit = (digits) => {
        let sum = 0;
        for (let i = 0; i < digits.length; i++) sum += Number(digits[i]) * (digits.length + 1 - i);
        const rest = (sum * 10) % 11;
        return rest === 10 ? 0 : rest;
    };
    const d1 = digit(base);
    const d2 = digit(base + d1);
    return `${base}${d1}${d2}`;
}

function generateCNH() {
    for (;;) {
        const base = randomDigits(9);
        const dv = cnhCheckDigits(base);
        if (dv && !/^(\d)\1{8}$/.test(base)) return base + dv;
    }
}

const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
const daysAhead = n => daysAgo(-n);
const hoursAgo = h => new Date(Date.now() - h * 3600000);

async function seedDemo() {
    if (await get(`SELECT id FROM users WHERE email = 'admin@nexusfleet.com'`)) return;
    console.log('🌱 Criando dados de demonstração...');

    const companyId = (await run(`INSERT INTO companies (name) VALUES (?)`, ['NexusFleet Transportes (Demonstração)'])).lastID;
    const hash = await bcrypt.hash(DEMO_PASSWORD, 10);

    const user = (name, email, role, cargo) => insertRow('users', { company_id: companyId, name, email, password_hash: hash, role, cargo, active: 1 });
    const adminId = await user('Ana Souza', 'admin@nexusfleet.com', 'admin', 'Administradora do Sistema');
    await user('Gabriel Lima', 'gestor@nexusfleet.com', 'gestor', 'Gestor de Frota');
    const motoristaId = await user('Marcos Oliveira', 'motorista@nexusfleet.com', 'motorista', 'Motorista');
    const motorista2Id = await user('Paula Ribeiro', 'motorista2@nexusfleet.com', 'motorista', 'Motorista');
    await user('Fernanda Costa', 'financeiro@nexusfleet.com', 'financeiro', 'Diretora Financeira');

    // Veículos
    const vehicleSpecs = [
        { plate: 'FLX1A23', brand: 'Volkswagen', model: 'Gol 1.0', year: 2021, vehicle_type: 'carro', load_capacity_kg: 400, fuel_type: 'Flex', capacity: 55, odo: 38200, kmpl: 12.5, step: 480, fuel: 'Gasolina Comum', price: 5.79 },
        { plate: 'UTL2B34', brand: 'Fiat', model: 'Strada Freedom', year: 2022, vehicle_type: 'utilitario', load_capacity_kg: 650, fuel_type: 'Flex', capacity: 55, odo: 25400, kmpl: 11, step: 430, fuel: 'Álcool Comum', price: 3.99 },
        { plate: 'VAN3C45', brand: 'Mercedes-Benz', model: 'Sprinter 416', year: 2020, vehicle_type: 'van', load_capacity_kg: 1500, fuel_type: 'Diesel', capacity: 75, odo: 81250, kmpl: 8.5, step: 520, fuel: 'Diesel S10', price: 6.19 },
        { plate: 'CAM4D56', brand: 'Volvo', model: 'FH 460', year: 2019, vehicle_type: 'caminhao', load_capacity_kg: 25000, fuel_type: 'Diesel', capacity: 600, odo: 152300, kmpl: 2.6, step: 1300, fuel: 'Diesel S10', price: 6.09 },
        { plate: 'MOT5E67', brand: 'Honda', model: 'CG 160 Cargo', year: 2023, vehicle_type: 'moto', load_capacity_kg: 20, fuel_type: 'Gasolina', capacity: 16, odo: 9100, kmpl: 38, step: 350, fuel: 'Gasolina Comum', price: 5.79 }
    ];

    const vehicles = {};
    for (const s of vehicleSpecs) {
        const id = await insertRow('vehicles', {
            company_id: companyId, user_id: adminId, plate: s.plate, brand: s.brand, model: s.model, year: s.year,
            vehicle_type: s.vehicle_type, load_capacity_kg: s.load_capacity_kg, fuel_type: s.fuel_type, capacity: s.capacity,
            current_odometer: s.odo, status: 'available', maintenance_interval_km: 10000, maintenance_interval_days: 180,
            created_at: daysAgo(200).toISOString().slice(0, 19).replace('T', ' ')
        });
        vehicles[s.plate] = { ...s, id, label: `${s.brand} ${s.model} (${s.plate})` };

        // Histórico de abastecimentos (12 abastecimentos em ~6 meses)
        let odometer = s.odo - s.step * 11;
        for (let i = 0; i < 12; i++) {
            const efficiency = s.kmpl * (0.92 + Math.random() * 0.16);
            const liters = Math.min(s.capacity, Math.round((s.step / efficiency) * 100) / 100);
            await insertRow('fuels', {
                company_id: companyId, user_id: adminId, vehicle_id: id, vehicle: vehicles[s.plate].label,
                fuel_type: s.fuel, liters, price_per_liter: s.price, cost: Math.round(liters * s.price * 100) / 100,
                odometer, horimeter: 0, km_per_liter: i === 0 ? null : Math.round((s.step / liters) * 100) / 100,
                date: formatBR(daysAgo((11 - i) * 15 + 2))
            });
            odometer += s.step;
        }
    }

    // Motoristas (CPF e CNH criptografados)
    const driver = async (name, category, expiry, linkedUserId, plates) => {
        const cpf = generateCPF();
        const cnh = generateCNH();
        const id = await insertRow('drivers', {
            company_id: companyId, user_id: adminId, linked_user_id: linkedUserId, name,
            cpf_enc: encrypt(cpf), cpf_hash: blindIndex(`cpf:${cpf}`), cpf_last: cpf.slice(-4),
            cnh_enc: encrypt(cnh), cnh_hash: blindIndex(`cnh:${cnh}`), cnh_last: cnh.slice(-4),
            cnh_category: category, cnh_expiry: formatISODate(expiry), phone: '(19) 9' + randomDigits(4) + '-' + randomDigits(4), status: 'active'
        });
        for (const plate of plates) await run(`INSERT INTO driver_vehicles (driver_id, vehicle_id) VALUES (?, ?)`, [id, vehicles[plate].id]);
        return id;
    };
    const marcos = await driver('Marcos Oliveira', 'AE', daysAhead(700), motoristaId, ['VAN3C45', 'CAM4D56', 'FLX1A23']);
    const paula = await driver('Paula Ribeiro', 'B', daysAhead(20), motorista2Id, ['FLX1A23', 'UTL2B34']);
    await driver('João Carlos Mendes', 'C', daysAgo(10), null, ['CAM4D56']);
    const ricardo = await driver('Ricardo Alves', 'AD', daysAhead(400), null, ['MOT5E67', 'VAN3C45']);

    // Viagens concluídas (com checklists, pedágios e quilometragem)
    const { CHECKLIST_ITEMS } = require('../routes/trips.routes');
    const items = ok => CHECKLIST_ITEMS.map(({ key, label }) => ({
        key, label, ok: ok || key !== 'lataria', note: ok || key !== 'lataria' ? null : 'Risco na porta traseira'
    }));

    const completedTrip = async (vehicle, driverId, driverUserId, driverName, startDaysAgo, origin, destination, km, tolls) => {
        const start = daysAgo(startDaysAgo); start.setHours(7, 30, 0, 0);
        const end = new Date(start.getTime() + (km / 60) * 3600000);
        const startOdo = vehicle.odo - km - startDaysAgo * 3;
        const tripId = await insertRow('trips', {
            company_id: companyId, user_id: adminId, vehicle_id: vehicle.id, driver_id: driverId,
            origin_name: origin.name, origin_lat: origin.lat, origin_lng: origin.lng,
            destination_name: destination.name, destination_lat: destination.lat, destination_lng: destination.lng,
            stops: '[]', distance_km: km, duration_min: Math.round((km / 60) * 60),
            planned_start: formatLocalDateTime(start), planned_end: formatLocalDateTime(end),
            actual_start: formatLocalDateTime(start), actual_end: formatLocalDateTime(end),
            start_odometer: startOdo, end_odometer: startOdo + km, toll_cost: tolls, status: 'completed'
        });
        for (const type of ['pre', 'post']) {
            await insertRow('checklists', {
                company_id: companyId, trip_id: tripId, vehicle_id: vehicle.id, driver_id: driverId,
                user_id: driverUserId || adminId, user_name: driverName, type,
                items: JSON.stringify(items(type === 'pre')), has_issues: type === 'post' ? 1 : 0,
                created_at: (type === 'pre' ? start : end).toISOString().slice(0, 19).replace('T', ' ')
            });
        }
        return { tripId, start };
    };

    const americana = { name: 'Americana, SP', lat: -22.7392, lng: -47.3314 };
    const campinas = { name: 'Campinas, SP', lat: -22.9056, lng: -47.0608 };
    const saoPaulo = { name: 'São Paulo, SP', lat: -23.5505, lng: -46.6333 };
    const piracicaba = { name: 'Piracicaba, SP', lat: -22.7253, lng: -47.6492 };

    const t1 = await completedTrip(vehicles.VAN3C45, marcos, motoristaId, 'Marcos Oliveira', 12, americana, saoPaulo, 135, 38.4);
    await completedTrip(vehicles.FLX1A23, paula, motorista2Id, 'Paula Ribeiro', 6, americana, campinas, 42, 9.2);
    await completedTrip(vehicles.CAM4D56, marcos, motoristaId, 'Marcos Oliveira', 25, campinas, piracicaba, 72, 21.7);

    // Viagem em andamento com posições GPS (rastreamento em tempo real)
    const liveStart = hoursAgo(1);
    const liveTrip = await insertRow('trips', {
        company_id: companyId, user_id: adminId, vehicle_id: vehicles.FLX1A23.id, driver_id: marcos,
        origin_name: americana.name, origin_lat: americana.lat, origin_lng: americana.lng,
        destination_name: campinas.name, destination_lat: campinas.lat, destination_lng: campinas.lng,
        stops: JSON.stringify([{ name: 'Nova Odessa, SP', lat: -22.7797, lng: -47.2958 }]),
        distance_km: 42, duration_min: 55,
        planned_start: formatLocalDateTime(liveStart), planned_end: formatLocalDateTime(new Date(liveStart.getTime() + 2 * 3600000)),
        actual_start: formatLocalDateTime(liveStart), start_odometer: vehicles.FLX1A23.odo, status: 'in_progress'
    });
    await insertRow('checklists', {
        company_id: companyId, trip_id: liveTrip, vehicle_id: vehicles.FLX1A23.id, driver_id: marcos,
        user_id: motoristaId, user_name: 'Marcos Oliveira', type: 'pre', items: JSON.stringify(items(true)), has_issues: 0
    });
    const steps = 12;
    for (let i = 0; i <= steps; i++) {
        const f = i / (steps * 1.6);
        const lat = americana.lat + (campinas.lat - americana.lat) * f;
        const lng = americana.lng + (campinas.lng - americana.lng) * f;
        await run(
            `INSERT INTO vehicle_positions (company_id, vehicle_id, trip_id, driver_id, lat, lng, speed, recorded_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', ?))`,
            [companyId, vehicles.FLX1A23.id, liveTrip, marcos, lat, lng, 55 + Math.round(Math.random() * 30), `-${(steps - i) * 4} minutes`]
        );
        if (i === steps) {
            await run(`UPDATE vehicles SET status = 'in_trip', last_lat = ?, last_lng = ?, last_speed = 72, last_position_at = datetime('now') WHERE id = ?`, [lat, lng, vehicles.FLX1A23.id]);
        }
    }

    // Viagem planejada para amanhã
    const tomorrow = daysAhead(1); tomorrow.setHours(8, 0, 0, 0);
    await insertRow('trips', {
        company_id: companyId, user_id: adminId, vehicle_id: vehicles.UTL2B34.id, driver_id: paula,
        origin_name: americana.name, origin_lat: americana.lat, origin_lng: americana.lng,
        destination_name: piracicaba.name, destination_lat: piracicaba.lat, destination_lng: piracicaba.lng,
        stops: JSON.stringify([{ name: 'Santa Bárbara d\'Oeste, SP', lat: -22.7553, lng: -47.4136 }]),
        distance_km: 38, duration_min: 45,
        planned_start: formatLocalDateTime(tomorrow), planned_end: formatLocalDateTime(new Date(tomorrow.getTime() + 3 * 3600000)),
        status: 'planned'
    });
    await insertRow('trips', {
        company_id: companyId, user_id: adminId, vehicle_id: vehicles.MOT5E67.id, driver_id: ricardo,
        origin_name: americana.name, destination_name: campinas.name, stops: '[]', distance_km: 42, duration_min: 50,
        planned_start: formatLocalDateTime(new Date(tomorrow.getTime() + 5 * 3600000)),
        planned_end: formatLocalDateTime(new Date(tomorrow.getTime() + 8 * 3600000)),
        status: 'planned'
    });

    // Manutenções
    const maintenance = (plate, data) => insertRow('maintenances', {
        company_id: companyId, user_id: adminId, vehicle_id: vehicles[plate].id, vehicle: vehicles[plate].label, horimeter: 0, ...data
    });
    await maintenance('FLX1A23', { kind: 'preventiva', status: 'completed', service: 'Revisão Geral', workshop: 'Auto Center Americana', cost: 890, odometer: 30100, date: formatBR(daysAgo(170)), completed_at: daysAgo(170).toISOString() });
    await maintenance('VAN3C45', { kind: 'preventiva', status: 'completed', service: 'Troca de Óleo e Filtro', workshop: 'Diesel Service', cost: 640, odometer: 79800, date: formatBR(daysAgo(40)), completed_at: daysAgo(40).toISOString() });
    await maintenance('CAM4D56', { kind: 'corretiva', status: 'completed', service: 'Freios (Pastilhas/Discos)', workshop: 'Volvo Truck Center', cost: 3450, odometer: 150900, date: formatBR(daysAgo(18)), completed_at: daysAgo(18).toISOString() });
    await maintenance('UTL2B34', { kind: 'preventiva', status: 'scheduled', service: 'Revisão Geral', workshop: 'Fiat Concessionária', cost: 750, scheduled_date: formatISODate(daysAhead(2)), date: formatBR(daysAhead(2)) });

    // Multa vinculada automaticamente ao motorista da viagem
    await insertRow('fines', {
        company_id: companyId, user_id: adminId, vehicle_id: vehicles.VAN3C45.id, driver_id: marcos, trip_id: t1.tripId, driver_auto: 1,
        infraction_date: formatISODate(t1.start), infraction_time: '09:10', code: '745-50',
        description: 'Transitar em velocidade superior à máxima permitida em até 20%', severity: 'media', points: 4,
        amount: 130.16, due_date: formatISODate(daysAhead(15)), location: 'Rod. Anhanguera, km 98', status: 'pending'
    });

    // Documentos
    const doc = (plate, doc_type, expiry, issuer, cost) => insertRow('vehicle_documents', {
        company_id: companyId, user_id: adminId, vehicle_id: vehicles[plate].id, doc_type, expiry_date: formatISODate(expiry), issuer, cost
    });
    await doc('FLX1A23', 'licenciamento', daysAhead(12), 'DETRAN-SP', 160.22);
    await doc('FLX1A23', 'seguro', daysAhead(210), 'Porto Seguro', 2890);
    await doc('CAM4D56', 'ipva', daysAgo(5), 'SEFAZ-SP', 4200);
    await doc('VAN3C45', 'seguro', daysAhead(95), 'Allianz', 5400);

    // Ocorrência e agenda
    await insertRow('occurrences', {
        company_id: companyId, user_id: motoristaId, user_name: 'Marcos Oliveira', vehicle_id: vehicles.VAN3C45.id, driver_id: marcos, trip_id: t1.tripId,
        type: 'avaria', severity: 'media', description: 'Risco na porta traseira após manobra no centro de distribuição.',
        occurred_at: formatLocalDateTime(new Date(t1.start.getTime() + 3 * 3600000)), status: 'open'
    });
    await insertRow('reminders', { company_id: companyId, user_id: adminId, title: 'Renovação do contrato de rastreamento', date: formatISODate(daysAhead(5)), description: 'Fornecedor TrackBR', completed: 0 });
    await insertRow('reminders', { company_id: companyId, user_id: adminId, title: 'Curso de direção defensiva', date: formatISODate(daysAhead(30)), description: 'Todos os motoristas', completed: 0 });

    console.log('✅ Dados de demonstração criados. Logins (senha: Senha@123):');
    console.log('   admin@nexusfleet.com · gestor@nexusfleet.com · motorista@nexusfleet.com · motorista2@nexusfleet.com · financeiro@nexusfleet.com');
}

module.exports = { seedDemo, DEMO_PASSWORD };
