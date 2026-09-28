# Publicar o NexusFleet na Vercel (com banco Neon/Postgres)

Nada precisa ser instalado ou executado na sua máquina. A Vercel instala as
dependências e publica sozinha a cada envio para o GitHub.

**Ordem:** 1) subir para o GitHub → 2) criar o projeto na Vercel → 3) criar o banco
→ 4) cadastrar as variáveis → 5) redeploy.

---

## 1. Subir o código para o GitHub

Siga o [DEPLOY_GITHUB.md](DEPLOY_GITHUB.md). Repositório:
`https://github.com/LeonardoBonatti/Nexus-Fleet-Faculdade`

**Não suba** `.env`, `node_modules/`, `package-lock.json` nem arquivos `.sqlite`
(o `.gitignore` já bloqueia todos eles).

---

## 2. Importar o projeto na Vercel

1. Entre em **https://vercel.com** com a conta do GitHub.
2. **Add New… → Project** → **Import** no repositório `Nexus-Fleet-Faculdade`.
3. Em *Framework Preset* deixe **Other**. Não preencha *Build Command*.
   O `vercel.json` do projeto já define tudo:
   - `outputDirectory: frontend` → as telas são servidas pela CDN
   - a função `api/index.js` → toda a API (e as telas, como reserva)
   - o cron diário → `/api/cron`
4. Clique em **Deploy**.

> O primeiro deploy vai subir, mas o sistema ainda não funciona: falta o banco.
> Isso é esperado — siga para o passo 3.

---

## 3. Criar o banco Postgres (Neon)

1. No projeto da Vercel → aba **Storage** → **Create Database** → **Neon (Postgres)**.
2. Escolha a região mais próxima (ex.: `Washington, D.C.` ou `São Paulo`, se disponível)
   e o plano **Free**.
3. Em **Connect Project**, selecione o projeto `Nexus-Fleet-Faculdade` e confirme.

A Vercel cria automaticamente as variáveis `DATABASE_URL` e `POSTGRES_URL` no projeto.
**Não é preciso criar tabela nenhuma**: o sistema cria o esquema completo sozinho no
primeiro acesso.

---

## 4. Cadastrar as variáveis de ambiente

Projeto → **Settings → Environment Variables**. Marque **Production**, **Preview** e
**Development** em todas:

| Variável | Valor |
|---|---|
| `JWT_SECRET` | uma frase longa e aleatória (mín. 32 caracteres) |
| `DATA_ENCRYPTION_KEY` | 64 caracteres hexadecimais (chave AES-256 do CPF/CNH) |
| `CRON_SECRET` | outro valor aleatório qualquer |
| `SEED_DEMO` | `true` para carregar a empresa de demonstração |
| `NODE_ENV` | `production` |

`DATABASE_URL` já foi criada pelo Neon no passo 3 — não mexa nela.

**Como gerar a `DATA_ENCRYPTION_KEY`:** 64 caracteres entre `0-9` e `a-f`.
No próprio navegador (F12 → Console) você pode colar:

```
crypto.getRandomValues(new Uint8Array(32)).reduce((s,b)=>s+b.toString(16).padStart(2,'0'),'')
```

> ⚠️ Depois de cadastrar motoristas, **nunca troque** a `DATA_ENCRYPTION_KEY`:
> os CPF/CNH guardados ficam ilegíveis. Se ela não for definida, a chave é derivada
> do `JWT_SECRET` (aceitável só para demonstração).

---

## 5. Redeploy

Aba **Deployments** → no deploy mais recente, menu `···` → **Redeploy**
(desmarque *Use existing build cache*).

Ao abrir a URL do projeto, o primeiro acesso demora alguns segundos: é quando o
esquema é criado e os dados de demonstração são carregados.

---

## 6. Conferir se está tudo certo

| O quê | Onde |
|---|---|
| API viva | `https://SEU-PROJETO.vercel.app/api/system/health` → `{"status":"ok"}` |
| Telas | `https://SEU-PROJETO.vercel.app` → tela de login |
| Login demo | `admin@nexusfleet.com` / `Senha@123` |
| Rotina diária | **Settings → Cron Jobs** mostra `/api/cron` às 09:00 UTC |
| Banco | **Storage → Neon → Tables**: 19 tabelas criadas |

Contas de demonstração (senha `Senha@123`): `admin@`, `gestor@`, `motorista@`,
`motorista2@`, `financeiro@nexusfleet.com`.

---

## O que mudou do projeto original

A Vercel roda **funções serverless**: não existe processo ligado o tempo todo nem
disco onde gravar arquivos. Por isso:

| Antes | Agora |
|---|---|
| Banco SQLite em arquivo | PostgreSQL (Neon), via `DATABASE_URL` |
| `app.listen()` no `server.js` | `api/index.js` exporta a aplicação; `server.js` só é usado localmente |
| `setInterval` para alertas, auditoria e batimento | `GET /api/cron` disparado pelo **Vercel Cron** 1×/dia + verificação sob demanda a cada alteração |
| Disponibilidade medida por batimento a cada minuto | Batimento gravado durante as requisições (máx. 1/min) e pelo cron |
| `bcrypt` (módulo nativo) | `bcryptjs` (JavaScript puro, sem compilação) |

O SQL do projeto continua escrito no mesmo dialeto de antes (`?`, `datetime('now')`,
`INSERT OR IGNORE`, `IFNULL`, `COLLATE NOCASE`): a tradução para PostgreSQL acontece
em [`src/config/db.js`](src/config/db.js).

---

## Problemas comuns

**"No Output Directory named 'frontend' found"**
Settings → General → *Build & Development Settings* → *Output Directory* = `frontend`
(override ativado) e redeploy.

**Erro 503 "Banco de dados indisponível"**
A variável `DATABASE_URL` não chegou ao deploy. Confira em Settings → Environment
Variables e faça um novo Redeploy (variáveis só valem para deploys feitos depois).

**Login diz "E-mail ou senha incorretos" nas contas demo**
`SEED_DEMO` não estava como `true` no momento do deploy. Ajuste e redeploy.

**As telas abrem, mas nenhum dado carrega**
Abra `/api/system/health`. Se responder erro, o problema é banco/variáveis;
se responder `ok`, verifique o console do navegador (F12).
