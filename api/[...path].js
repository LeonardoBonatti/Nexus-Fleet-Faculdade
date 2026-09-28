/**
 * api/[...path].js
 * Rota "catch-all": atende /api/<qualquer>/<coisa>.
 *
 * A Vercel entrega a requisição com a URL original preservada, então o Express
 * enxerga "/api/users/login", "/api/data/vehicles", "/api/cron" etc. — igual
 * ao servidor local.
 */
module.exports = require('../src/handler');
