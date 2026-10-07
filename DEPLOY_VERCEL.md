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
   - as funções em `api/` → toda a API
   - o cron diário → `/api/cron`
4. Clique em **Deploy**.

> O primeiro deploy vai subir, mas o sistema ainda não funciona: falta o banco.
> Isso é esperado — siga para o passo 3.

---

## 3. Criar o banco Postgres (Neon)

**Não é preciso criar tabela nenhuma.** O sistema monta as 19 tabelas e os índices
sozinho, no primeiro acesso depois que o banco existir.

### Caminho A — pelo painel da Vercel (recomendado)

1. Abra **vercel.com** → clique no projeto **nexus-fleet-faculdade**.
2. Clique na aba **Storage** (no topo, ao lado de Deployments, Analytics, Settings).
3. Clique em **Create Database**.
4. Aparece a lista de bancos. Em *Marketplace Database Providers*, escolha **Neon**
   (aparece como "Neon — Serverless Postgres") e clique em **Continue**.
5. Aceite os termos do provedor, se ele pedir.
6. Preencha:
   - **Plan / Plano**: `Free`
   - **Region / Região**: `Washington, D.C. (iad1)` — a mesma do deploy. Se houver
     `São Paulo (gru1)`, melhor ainda.
   - **Database Name**: `nexusfleet` (ou o que preferir)
7. Clique em **Create**.
8. Na tela seguinte, **Connect to Project**: marque o projeto
   `nexus-fleet-faculdade` e os três ambientes — **Production**, **Preview** e
   **Development**. Confirme.

Pronto: a Vercel injeta `DATABASE_URL` (e algumas variantes) nas variáveis do projeto.

### Caminho B — direto no Neon (se o Caminho A travar)

1. Crie uma conta em **https://neon.tech** (dá para entrar com o GitHub).
2. **Create project** → plano Free → região mais próxima → **Create**.
3. Na tela do projeto, procure **Connection string** e copie a versão
   **Pooled connection** (o endereço contém `-pooler`). Ela se parece com:
   `postgresql://usuario:senha@ep-algo-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require`
4. Na Vercel → projeto → **Settings** → **Environment Variables** → **Add**:
   - **Key**: `DATABASE_URL`
   - **Value**: a connection string copiada
   - **Environments**: marque **Production**, **Preview** e **Development**
   - **Save**

### Conferindo

Vercel → **Settings** → **Environment Variables**: `DATABASE_URL` precisa aparecer na
lista. Se não aparecer, a conexão com o projeto não foi concluída — refaça o passo 8
(ou use o Caminho B).

> ⚠️ Variável de ambiente só vale para deploys feitos **depois** dela.
> Sempre faça um Redeploy ao terminar (passo 5).

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

**Login ou cadastro responde "A API não respondeu neste endereço (HTTP 404)"**
A requisição não chegou a nenhuma função: é roteamento, não banco. Confira em
Settings → Functions se `api/index.js` aparece na lista do último deploy, e em
Settings → General se o *Framework Preset* está em **Other**. O `vercel.json` já
cobre os dois modos de roteamento (rota curinga e rewrite com `__path`).

**"Nenhum ponto de entrada encontrado que importe o Express"**
A Vercel detectou o projeto como "backend Express" e foi procurar um arquivo na
raiz importando o express. Não é a arquitetura daqui (estáticos + funções em
`api/`). O `vercel.json` já resolve com `"framework": null`; se o erro insistir,
vá em Settings → General → *Framework Preset* e escolha **Other**.

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
