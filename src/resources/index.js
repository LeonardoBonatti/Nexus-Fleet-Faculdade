// Registro dos recursos acessíveis por /api/data/:recurso
const { reminders, stations } = require('./misc');

module.exports = {
    vehicles: require('./vehicles'),
    drivers: require('./drivers'),
    trips: require('./trips'),
    fuels: require('./fuels'),
    maintenances: require('./maintenances'),
    fines: require('./fines'),
    documents: require('./documents'),
    occurrences: require('./occurrences'),
    reminders,
    stations
};
