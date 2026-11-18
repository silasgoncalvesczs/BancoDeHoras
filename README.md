# Banco de Horas

App web para controlar horas extras e compensações, com sync na nuvem via [Supabase](https://supabase.com) (Auth + Postgres + Storage).

## Demo / uso próprio

Hospede no GitHub Pages. A configuração do Supabase no site público é injetada no deploy pelos **Secrets** do repositório.

## Usar com o SEU Supabase (clone)

1. Crie um projeto em [supabase.com/dashboard](https://supabase.com/dashboard) (região próxima, ex.: São Paulo)
2. **SQL Editor → New query** → cole e rode o arquivo [`supabase/schema.sql`](supabase/schema.sql) inteiro.
   Ele cria:
   - `public.entries` (lançamentos) e `public.goals` (meta) com **RLS**: cada usuário só lê/grava as próprias linhas
   - bucket privado **`entry-images`** (fotos, máx. 1 MB, JPEG/PNG/WebP) com policies por pasta do usuário
   - Realtime nas duas tabelas (sincroniza entre aparelhos)
3. **Authentication → URL Configuration**
   - **Site URL**: URL do app, ex.: `https://SEU_USER.github.io/BancoDeHoras/`
   - **Redirect URLs**: a mesma URL e `http://localhost:*/**` (dev)
4. **Authentication → Sign In / Providers → Email**: deixe habilitado. *Confirm email* ligado é o recomendado
5. **SMTP próprio** (necessário para outros usuários): o SMTP padrão do Supabase só envia para membros da equipe do projeto e tem limite muito baixo. Em **Authentication → Emails → Set up SMTP** configure, por exemplo, o Gmail (`smtp.gmail.com`, porta `465`, usuário = seu Gmail, senha = [senha de app](https://myaccount.google.com/apppasswords)). Depois disso os **templates** ficam editáveis (traduza *Confirm signup* e *Reset password*, mantendo `{{ .ConfirmationURL }}`) e ajuste **Authentication → Rate Limits**. Para testar só com a sua conta, pode pular este passo
6. Configure o app local:

```bash
cp js/supabase-config.example.js js/supabase-config.js
```

7. Edite `js/supabase-config.js` com a **Project URL** e a chave **anon / publishable** (Project Settings → API)
8. Abra com um servidor local (não use `file://`), por exemplo Live Server

`js/supabase-config.js` não entra no Git (está no `.gitignore`).

## Segurança (checklist)

A chave **anon/publishable** aparece no site — isso é normal. O que protege os dados é o **RLS** (Row Level Security) das tabelas e do Storage.

- [ ] `supabase/schema.sql` executado (RLS ativo em `entries` e `goals`; bucket `entry-images` **privado**)
- [ ] Nunca usar a chave **service_role / secret** no site (o deploy recusa publicar se ela for colocada no secret)
- [ ] Teste: logado como usuário A, `select * from entries` via API só retorna linhas de A
- [ ] Site URL e Redirect URLs configurados (senão o link de e-mail não volta para o app)
- [ ] Para evitar contas spam: **Authentication → Attack Protection** (CAPTCHA) ou desativar *Allow new users to sign up*

### Recuperação de senha

1. No app: **Esqueci a senha** → envia o e-mail
2. O link abre **o próprio Banco de Horas** na tela “Nova senha”
3. Se aparecer “expirou / já foi usado”: peça um **novo** link (cada link vale uma vez; alguns apps de e-mail “clicam” no link ao escanear e invalidam)

> O SMTP padrão do Supabase tem limite baixo de envios por hora. Para uso real, configure um SMTP próprio em **Project Settings → Authentication → SMTP**.

## Migração Firebase → Supabase (uma vez)

O script [`migration/migrate.mjs`](migration/migrate.mjs) copia **contas (com senha), lançamentos, metas e fotos**. É seguro rodar mais de uma vez (não duplica).

Pré-requisitos: Node.js 20.6+, [Firebase CLI](https://firebase.google.com/docs/cli) (`npm i -g firebase-tools`) e o `schema.sql` já executado no Supabase.

1. **Exporte os usuários do Firebase** (inclui o hash das senhas):
   ```bash
   cd migration
   firebase login
   firebase auth:export users.json --format=json --project SEU_PROJECT_ID
   ```
2. **Parâmetros do hash**: Console Firebase → Authentication → Usuários → menu **⋮** → *Parâmetros de hash de senha*
3. **Service account**: Console Firebase → Configurações do projeto → Contas de serviço → *Gerar nova chave privada* → salve como `migration/service-account.json`
4. `cp .env.example .env` e preencha (incluindo a **service_role** do Supabase — só neste arquivo local)
5. Rode:
   ```bash
   npm install
   npm run teste                                              # simulação
   node --env-file=.env migrate.mjs --only=SEU@EMAIL.com      # migra só a sua conta
   ```
6. **Valide com a sua conta**: rode o app apontando para o Supabase, entre com a **senha de sempre** e confira lançamentos, fotos e meta.
   - Se a senha não funcionar, use “Esqueci a senha” e, para os demais, rode com `--sem-senha` (todos redefinem no 1º acesso).
7. Migre todos: `npm run migrar`. Confira `migration/migration-report.json` (lista quem precisa redefinir a senha)
8. Faça o deploy (seção abaixo). Mantenha o projeto Firebase por algumas semanas como backup antes de apagá-lo
9. Apague `users.json`, `service-account.json` e `.env` da pasta `migration/` (contêm dados sensíveis; já estão no `.gitignore`)

> Os IDs de usuário mudam (Firebase usa IDs próprios, o Supabase usa UUID). O relatório guarda a correspondência.

## PWA

O app é instalável (manifest + service worker). No celular/desktop, use “Instalar app” / “Adicionar à tela inicial”.

- UI e assets ficam em cache (abre offline)
- Login e sync **precisam de internet**

## Estrutura

```
index.html
manifest.webmanifest
sw.js
css/styles.css
assets/
  logo.png
  icons/
js/
  app.js                    # interface
  supabase.js               # client + auth
  supabase-config.example.js
  storage.js                # lançamentos, metas, fotos (Storage)
  time.js
  export.js
  theme.js
  images.js                 # compressão das fotos
supabase/
  schema.sql                # tabelas, RLS, bucket, realtime
migration/
  migrate.mjs               # migração única Firebase → Supabase
```

## Deploy (mantenedor)

> **Obrigatório:** em **Settings → Pages → Build and deployment → Source**,
> escolha **GitHub Actions** (não “Deploy from a branch”).
> Com “Deploy from a branch”, o `supabase-config.js` não sobe (está no `.gitignore`) → **404** e o app trava.

1. Secrets em **Settings → Secrets and variables → Actions**:
   - `SUPABASE_URL` — ex.: `https://abcd1234.supabase.co`
   - `SUPABASE_ANON_KEY` — chave **anon / publishable** (nunca a service_role)
   - (os antigos `FIREBASE_*` podem ser apagados depois da migração)
2. **Settings → Pages → Source**: **GitHub Actions**
3. **Actions** → **Deploy GitHub Pages** → **Run workflow** (ou push na `main`)
4. Confirme que `https://SEU_USER.github.io/BancoDeHoras/js/supabase-config.js` abre o JS (não 404)
5. Hard refresh no app (Ctrl+Shift+R)
