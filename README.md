# NexusFleet — SGF | Sistema de Gestão de Frota

Projeto acadêmico da disciplina **Tópicos Integradores II** — Faculdade de Americana (FAM).
Autores: Leonardo Bonatti Ferreira da Silva (RA 20230439) e João Emílio.

Plataforma web (responsiva para desktop e celular) para controle de **veículos, motoristas, viagens, manutenção, abastecimento, multas, documentos e custos** de empresas com frota própria.

---

> **Publicado na Vercel** com banco **PostgreSQL (Neon)**.
> O passo a passo completo do deploy está em [DEPLOY_VERCEL.md](DEPLOY_VERCEL.md).

---

## 🚀 Como rodar

O sistema usa **PostgreSQL**. O mesmo banco serve para a Vercel e para a máquina local.

1. Instale o **Node.js 18.11+**.
2. Crie um banco gratuito no **[Neon](https://neon.tech)** (ou use o do projeto na Vercel)
   e copie a *connection string*.
3. Copie `.env.example` para `.env` e preencha `DATABASE_URL`.
4. Na pasta do projeto:
   ```bash
   npm install
   npm start
   ```
5. Acesse `http://localhost:3000`.

As tabelas e os índices são criados automaticamente na primeira execução —
não é preciso rodar nenhum script de migração.

Com `SEED_DEMO=true` no `.env` (já configurado), a primeira execução cria a empresa de demonstração com dados realistas e **um usuário por perfil** (senha `Senha@123`):

| Perfil | E-mail |
|---|---|
| Administrador | admin@nexusfleet.com |
| Gestor de Frota | gestor@nexusfleet.com |
| Motorista | motorista@nexusfleet.com (Marcos — tem viagem em andamento) |
| Motorista | motorista2@nexusfleet.com (Paula — CNH vencendo em 20 dias) |
| Financeiro / Diretoria | financeiro@nexusfleet.com |

A tela de login tem atalhos para essas contas. Também é possível criar uma empresa nova em **Criar conta** (o primeiro usuário vira administrador).

> Bancos da versão anterior são migrados automaticamente: cada usuário antigo vira administrador da própria empresa.

### Variáveis de ambiente (`.env`)

| Variável | Uso |
|---|---|
| `DATABASE_URL` | **Obrigatória.** Connection string do PostgreSQL (Neon / Vercel Postgres) |
| `JWT_SECRET` / `JWT_EXPIRATION` | Assinatura e validade da sessão |
| `DATA_ENCRYPTION_KEY` | Chave AES-256 (64 hex) para CPF/CNH. Sem ela, a chave é derivada do `JWT_SECRET` |
| `FORCE_HTTPS` | Redireciona HTTP → HTTPS em produção (padrão `true`) |
| `AUDIT_RETENTION_MONTHS` | Retenção do log de auditoria (mínimo 12) |
| `CRON_SECRET` | Protege a rotina automática `GET /api/cron` (Vercel Cron) |
| `PG_POOL_MAX` | Conexões por instância (padrão 3) |
| `SEED_DEMO` | Cria os dados de demonstração |
| `PORT` / `NODE_ENV` | Apenas na execução local |

---

## ✅ Rastreabilidade dos requisitos

### Requisitos funcionais

| RF | Requisito | Onde está no sistema | Como verificar (critério de aceitação) |
|---|---|---|---|
| **RF01** | Cadastro de veículos (placa, modelo, ano, tipo, capacidade de carga) | Tela **Veículos** · `src/resources/vehicles.js` | Cadastrar veículo e ver na listagem imediatamente. Placa inválida ou repetida → "Placa já cadastrada" (UC01, CA_HU01_1..3) |
| **RF02** | Cadastro de motoristas (CNH, categoria, validade, vínculo com veículos) | Tela **Motoristas** · `src/resources/drivers.js` | Cadastrar motorista com CNH vencendo em até 30 dias → notificação automática no sino |
| **RF03** | Quilometragem a cada viagem ou abastecimento | Iniciar/finalizar viagem e abastecimento · `src/routes/trips.routes.js`, `src/resources/fuels.js` | Finalizar viagem → quilometragem do veículo atualizada. Km menor que a anterior → "Quilometragem inválida" (CA_HU02_2) |
| **RF04** | Agendamento e controle de manutenções preventivas e corretivas | Tela **Manutenções** (Agendar / Iniciar / Concluir / Cancelar) · `src/routes/maintenance.routes.js` | Agendar para daqui a 3 dias → notificação (CA_HU03_2). Concluir → veículo volta a "Disponível" (CA_HU03_3) |
| **RF05** | Alertas automáticos por quilometragem ou tempo | Plano de revisão por veículo (km/dias) · `src/services/notification.service.js` | Veículo próximo do intervalo de km → "Revisão preventiva próxima". Telas Saúde e Diagnóstico mostram o desgaste |
| **RF06** | Abastecimentos (litros, valor, tipo de combustível) | Tela **Abastecimentos** | Registrar abastecimento → consumo médio (km/L) calculado automaticamente (CA_HU02_1), vinculado ao motorista e à viagem (CA_HU02_3) |
| **RF07** | Rastreamento em tempo real via GPS | Tela **Rastreamento** (gestor) + "Compartilhar localização" (motorista) · `src/routes/tracking.routes.js` | Motorista em viagem compartilha a localização → posição atualizada no mapa em até 10 s (critério: 30 s). Há modo demonstração que percorre a rota |
| **RF08** | Relatório de custos por veículo (combustível, manutenção, pedágios) | Tela **Relatórios de custos** · `src/routes/reports.routes.js` | Gerar relatório do mês e conferir a soma com a lista de lançamentos do período (inclui também multas) |
| **RF09** | Multas vinculadas a veículo e motorista | Tela **Multas** · `src/resources/fines.js` | Cadastrar multa com data/hora → motorista identificado pela viagem em andamento naquele horário |
| **RF10** | Rotas com origem, destino e paradas | Tela **Viagens → Nova viagem** (mapa) | Criar rota com paradas → distância e tempo estimado calculados (OSRM) |
| **RF11** | Associação motorista × veículo por viagem | Tela **Viagens** · `src/resources/trips.js` | Escalar o mesmo motorista/veículo em horário sobreposto → "Conflito de agenda". CNH vencida ou categoria incompatível também são bloqueadas |
| **RF12** | Checklist de inspeção antes e após a viagem | Detalhe da viagem → Checklist de saída/chegada | Preencher checklist → armazenado com data/hora e responsável. Viagem só inicia/finaliza com o checklist |
| **RF13** | Notificar vencimento de documentos (licenciamento, seguro) | Tela **Documentos** + sino de notificações | Documento vencendo em até 30 dias → notificação ao gestor |
| **RF14** | Níveis de acesso (administrador, gestor, motorista; + financeiro) | Tela **Usuários e perfis** · `src/middlewares/permission.middleware.js` | Entrar com cada conta de demonstração e confirmar menus/ações conforme a matriz de permissões |
| **RF15** | Exportação em PDF e Excel | Botão **Exportar** em todas as telas com dados · `frontend/js/export.js` | Exportar e conferir os dados e totais do arquivo |

### Requisitos não funcionais

| RNF | Requisito | Implementação | Como verificar |
|---|---|---|---|
| **RNF01** | Listagens em até 3 s com 500 veículos | Índices por empresa no PostgreSQL, cabeçalho `X-Response-Time`, métricas por endpoint | **Status do sistema → Executar teste** mede as principais listagens |
| **RNF02** | Disponibilidade ≥ 99% | Endpoint público `/api/system/health`, batimento por minuto gravado durante as requisições e pela rotina diária (`/api/cron`); infraestrutura serverless da Vercel com reinício automático | **Status do sistema** mostra a disponibilidade dos últimos 30 dias. Em produção, monitorar `/api/system/health` (ex.: UptimeRobot) |
| **RNF03** | CPF e CNH criptografados em repouso e em trânsito | AES-256-GCM + índice cego (HMAC) no banco; listagens mascaradas; HTTPS obrigatório e HSTS em produção | Consultar a tabela `drivers` no painel do Neon: colunas `cpf_enc`/`cnh_enc` ilegíveis. **Status do sistema** exibe a situação |
| **RNF04** | Responsivo (desktop, tablet e smartphone) | Layout com grid fluido, menu lateral deslizante e tabelas com rolagem | Testar as telas em diferentes larguras |
| **RNF05** | Log de alterações por no mínimo 12 meses | Tabela `audit_logs` com usuário, data, IP e valores antes/depois | Alterar um cadastro e ver em **Auditoria** |

### Histórias de usuário e caso de uso

| Item | Implementação |
|---|---|
| **HU01 / UC01** — Gestor cadastra veículo | Tela Veículos: validação de formato e duplicidade da placa, campos obrigatórios, cancelamento descarta os dados |
| **HU02** — Motorista registra km final e abastecimento | Motorista finaliza a viagem (km final > inicial) e registra abastecimentos com consumo calculado |
| **HU03** — Gestor agenda manutenção preventiva | Agendamento com data, tipo e veículo; alerta 3 dias antes; conclusão libera o veículo |
| Restrição — apenas motoristas habilitados e aptos | Bloqueio de CNH vencida e categoria incompatível ao escalar e ao iniciar viagem |
| Restrição — reduzir gasto excessivo de combustível | Alerta de "Consumo irregular" quando o km/L fica 20% abaixo da média do veículo |
| Motorista reporta ocorrências | Tela Ocorrências (avaria, pane, acidente...) com notificação ao gestor |

---

## 🧭 Roteiro sugerido para a apresentação

1. **Gestor** → Veículos: cadastrar veículo; tentar repetir a placa (UC01).
2. **Gestor** → Viagens: criar viagem com parada; tentar escalar João Carlos (CNH vencida) → bloqueado.
3. **Motorista** (Marcos) → Minhas viagens: abrir a viagem em andamento, **Modo demonstração** do GPS.
4. **Gestor** → Rastreamento: ver o veículo se movendo (atualiza a cada 10 s).
5. **Motorista** → checklist de chegada → finalizar com km final (testar km menor → erro).
6. **Gestor** → Manutenções: concluir a manutenção agendada → veículo volta a Disponível; sino com alertas.
7. **Financeiro** → Relatórios de custos → Exportar PDF e Excel.
8. **Administrador** → Auditoria (alterações feitas acima) e Status do sistema (teste de listagem).

---

## 🔌 API (resumo)

Todas as rotas (exceto login, cadastro e health) exigem `Authorization: Bearer <token>`.

| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/users/register` · `/api/users/login` | Criar empresa + administrador · Login |
| GET/PUT | `/api/users/profile` · PUT `/api/users/password` | Perfil e senha |
| GET/POST/PUT/DELETE | `/api/data/:recurso[/:id]` | `vehicles`, `drivers`, `trips`, `fuels`, `maintenances`, `fines`, `documents`, `occurrences`, `reminders`, `stations` |
| GET/POST | `/api/trips/:id/checklists` | Checklists de saída/chegada |
| POST | `/api/trips/:id/start` · `/finish` · `/cancel` | Execução da viagem |
| POST | `/api/maintenances/:id/start` · `/complete` · `/cancel` | Ciclo da manutenção |
| GET | `/api/fines/suggest-driver` | Motorista responsável na data/hora |
| POST / GET | `/api/tracking/positions` · `/api/tracking/live` | Envio e painel de posições GPS |
| GET | `/api/reports/costs?start&end&vehicle_id` | Relatório de custos |
| GET/POST | `/api/notifications` · `/read-all` · `/check` | Notificações |
| GET/POST/PUT | `/api/team` | Usuários (administrador) |
| GET | `/api/audit` | Auditoria (administrador) |
| GET | `/api/trash` · POST `/api/trash/:id/restore` · DELETE `/api/trash[/:id]` | Lixeira |
| GET | `/api/system/health` · `/api/system/status` | Disponibilidade e métricas |
| GET | `/api/cron` | Rotina automática diária (Vercel Cron, protegida por `CRON_SECRET`) |

Erros seguem o formato `{ "error": "mensagem" }` com o código HTTP adequado (400, 401, 403, 404, 409, 429, 500).

---

## 📂 Estrutura

```
vercel.json                       Deploy na Vercel: função, arquivos estáticos e cron
api/index.js                      Ponto de entrada serverless (Vercel)
server.js                         Ponto de entrada como servidor permanente (local)
src/
  app.js                          Aplicação Express (HTTPS, segurança, rotas, estáticos)
  bootstrap.js                    Preparação única: esquema do banco + dados demo
  config/db.js                    PostgreSQL: conexão, esquema, índices e tradução do SQL
  config/auth.js                  Configuração do JWT
  database/query.js · seed.js     Acesso ao banco · dados de demonstração
  middlewares/                    Autenticação, perfis, limite de tentativas, erros
  resources/                      Regras de negócio de cada cadastro (validação e permissões)
  routes/                         Rotas da API (dados, viagens, rastreamento, relatórios, cron...)
  services/                       Auditoria, notificações, regras da frota, métricas
  utils/                          Validações (placa, CPF, CNH, datas) e criptografia
frontend/
  index.html · login.html         Painel e tela de acesso
  styles.css                      Design system (tema claro/escuro, responsivo)
  app.js                          Núcleo: API, perfis, roteador, notificações
  js/records.js                   Formulários genéricos, veículos, abastecimentos, manutenções, lixeira
  js/fleet.js                     Motoristas, multas, documentos, ocorrências
  js/trips.js                     Viagens, checklist, GPS e rastreamento
  js/admin.js                     Relatórios de custos, usuários, auditoria, status
  js/pages.js                     Dashboard e telas analíticas
  js/export.js                    Exportação PDF e Excel
  pages/*.html                    Telas carregadas dinamicamente
```

> O arquivo `frontend/pages/integracao_mapas.html` é da versão anterior e não é mais usado (o planejamento de rotas agora fica em **Viagens**). Pode ser apagado.

---

## 🛠 Tecnologias

- **Backend**: Node.js, Express, PostgreSQL (Neon) via `pg`, JWT, bcryptjs, crypto (AES-256-GCM)
- **Infraestrutura**: Vercel (funções serverless + CDN) e Vercel Cron para a rotina diária
- **Frontend**: HTML, CSS e JavaScript puro, Chart.js, Leaflet, OSRM (rotas), Nominatim/OpenStreetMap (endereços), jsPDF + AutoTable (PDF)
