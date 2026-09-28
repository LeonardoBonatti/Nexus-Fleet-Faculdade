/**
 * api/index.js
 * Atende exatamente a rota "/api".
 *
 * As rotas com mais segmentos ("/api/users/login", "/api/data/vehicles"...)
 * são atendidas por api/[...path].js. As duas funções usam a MESMA aplicação
 * Express (src/handler.js).
 *
 * Usamos um arquivo por padrão de rota, em vez de um rewrite "catch-all" no
 * vercel.json, porque a Vercel passou a encaminhar a requisição usando o
 * caminho de DESTINO do rewrite — o que faria o Express receber sempre "/api"
 * e perder a rota original.
 */
module.exports = require('../src/handler');
