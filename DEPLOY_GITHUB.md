# Como subir o NexusFleet para o GitHub (sem usar o terminal)

Repositório que já existe na sua conta:
**https://github.com/LeonardoBonatti/Nexus-Fleet-Faculdade** (hoje só tem o commit inicial)

Depois deste passo, siga o [DEPLOY_VERCEL.md](DEPLOY_VERCEL.md) para publicar o sistema.

> ⚠️ **Nunca suba o arquivo `.env`.** Ele tem a chave `JWT_SECRET` real.
> O `.gitignore` já bloqueia `.env`, `node_modules/`, `package-lock.json` e os `.sqlite`,
> mas o upload por arrastar-e-soltar no site do GitHub **ignora o `.gitignore`** —
> nesse caminho você precisa conferir com o olho.

---

## O que sobe e o que não sobe

**Sobe:**

```
api/              vercel.json       package.json      README.md
src/              server.js         .gitignore        .env.example
frontend/         DEPLOY_VERCEL.md  DEPLOY_GITHUB.md
```

**Não sobe:**

```
.env                          (segredos)
node_modules/                 (a Vercel instala sozinha)
package-lock.json             (apontava para sqlite3/bcrypt, que saíram do projeto)
nexusfleet.sqlite             (banco antigo — agora é Postgres/Neon)
src/database/nexusfleet.sqlite
Nexus Fleet Faculdade/        (clone auxiliar do repositório)
```

---

## Caminho A — GitHub Desktop (recomendado, 100% interface gráfica)

1. Instale o **GitHub Desktop** (https://desktop.github.com) e entre com sua conta.
2. No Explorer, **mova a pasta `Nexus Fleet Faculdade`** de dentro de
   `Desktop\Faculdade\NexusFleet_Oficial` para a Área de Trabalho.
   Ela é o clone vazio do seu repositório — vamos colocar o código dentro dela.
3. **Copie** para dentro de `Nexus Fleet Faculdade` todo o conteúdo de
   `NexusFleet_Oficial`, seguindo a lista acima.
4. Abra o **GitHub Desktop** → `File` → `Add local repository` → escolha a pasta
   `Nexus Fleet Faculdade`. Ele reconhece o repositório e lista os arquivos novos.
5. **Confira a lista da esquerda**: `.env`, `package-lock.json` e qualquer `.sqlite`
   **não podem aparecer**. Se aparecerem, pare e me avise.
6. Escreva a mensagem do commit (ex.: `NexusFleet v2.1 — Postgres/Neon e deploy na Vercel`)
   e clique em **Commit to main**.
7. Clique em **Push origin**. Pronto — o código está no GitHub.

---

## Caminho B — Só pelo navegador (sem instalar nada)

1. Abra **https://github.com/LeonardoBonatti/Nexus-Fleet-Faculdade**
2. Clique em **Add file** → **Upload files**.
3. Abra o Explorer em `NexusFleet_Oficial`, **selecione** as pastas `api`, `src` e
   `frontend` e os arquivos `vercel.json`, `server.js`, `package.json`, `README.md`,
   `.gitignore`, `.env.example`, `DEPLOY_VERCEL.md`, `DEPLOY_GITHUB.md`
   e arraste para a área de upload do GitHub.
4. Se `src\database\nexusfleet.sqlite` aparecer na lista, remova-o
   (ícone de lixeira ao lado do nome) antes de confirmar.
5. Escreva a mensagem do commit e clique em **Commit changes**.

São cerca de 80 arquivos — cabe no limite de 100 arquivos por upload do GitHub.

---

## Depois de subir

Vá para o [DEPLOY_VERCEL.md](DEPLOY_VERCEL.md): importar o repositório na Vercel,
criar o banco Neon em **Storage** e cadastrar as variáveis de ambiente.

A partir daí, todo `Push origin` no GitHub Desktop gera um novo deploy automático.
