/**
 * api/index.js
 * Ponto de entrada da API na Vercel.
 *
 * O roteamento usa dois caminhos, porque a Vercel se comporta de formas
 * diferentes conforme a configuração do projeto:
 *
 *  1. api/[...path].js atende /api/<qualquer>/<coisa> quando a plataforma
 *     reconhece a rota curinga — aí a URL original chega intacta.
 *  2. Quando não reconhece, o rewrite do vercel.json encaminha para cá
 *     passando o caminho verdadeiro em "__path", que src/app.js restaura
 *     antes de qualquer rota.
 *
 * Nos dois casos o Express enxerga /api/users/login, /api/data/vehicles etc.,
 * exatamente como no servidor local.
 */
module.exports = require('../src/handler');
