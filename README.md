# Banco de Horas

App web para controlar horas extras e compensações, com sync na nuvem via Firebase.

## Demo / uso próprio

Hospede no GitHub Pages. A configuração do Firebase no site público é injetada no deploy pelos **Secrets** do repositório.

## Usar com o SEU Firebase (clone)

1. Crie um projeto em [Firebase Console](https://console.firebase.google.com/)
2. Ative **Authentication** (e-mail/senha) e **Firestore**
3. Publique regras que só o dono acessa os próprios dados:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/entries/{entryId} {
      allow read, delete: if request.auth != null && request.auth.uid == userId;

      allow create, update: if request.auth != null
        && request.auth.uid == userId
        && request.resource.data.keys().hasAll(['date', 'type', 'minutes', 'note', 'createdAt', 'updatedAt'])
        && request.resource.data.type in ['credit', 'debit']
        && request.resource.data.minutes is int
        && request.resource.data.minutes > 0
        && request.resource.data.minutes < 100000
        && request.resource.data.note is string
        && request.resource.data.note.size() <= 120
        && (
          !('imageData' in request.resource.data)
          || (
            request.resource.data.imageData is string
            && request.resource.data.imageData.size() > 20
            && request.resource.data.imageData.size() < 750000
          )
        );
    }
  }
}
```

> Imagens opcionais são salvas **comprimidas no Firestore** (campo `imageData`). Não é necessário ativar Firebase Storage.

4. Configure o app local:

```bash
cp js/firebase-config.example.js js/firebase-config.js
```

5. Edite `js/firebase-config.js` com os dados do **seu** app Web no Firebase
6. Abra com um servidor local (não use `file://`), por exemplo Live Server

`js/firebase-config.js` não entra no Git (está no `.gitignore`).

## Segurança (checklist)

A `apiKey` web do Firebase **aparece no site** — isso é normal em apps client-side. O que protege os dados são Auth + regras + restrições da key.

### No repositório / deploy

- [x] `js/firebase-config.js` no `.gitignore` (não versionar config local)
- [x] Secrets no GitHub Actions para o deploy
- [ ] Nunca commitar service account / Admin SDK / senhas

### No Firebase Console (obrigatório)

- [ ] **Firestore → Rules** publicadas (snippet acima). Nunca `allow read, write: if true`
- [ ] **Authentication → Settings → Authorized domains**: `localhost` e `SEU_USER.github.io`
- [ ] Teste no Rules Playground: usuário A lendo `users/{uidB}/entries/...` → **deny**

### Na API key (Google Cloud → Credentials)

- [ ] Application restrictions → **HTTP referrers (web sites)**
- [ ] Referrers sugeridos:
  - `https://SEU_USER.github.io/*`
  - `http://localhost:*/*` (só se desenvolver local)
- [ ] (Opcional) API restrictions: só Identity Toolkit, Firestore, etc.

### O que a key pública não permite (com regras certas)

- Ler/escrever lançamentos de outra conta
- Bypass de login

### O que ainda é possível mitigar

- Criação de contas spam no seu projeto Auth → restrição de referrer; ou criar usuários só pelo Console e remover cadastro público no app

## PWA

O app é instalável (manifest + service worker). No celular/desktop, use “Instalar app” / “Adicionar à tela inicial”.

- UI e assets ficam em cache (abre offline)
- Login e sync com Firebase **precisam de internet**

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
  app.js
  firebase.js
  firebase-config.example.js
  storage.js
  time.js
  export.js
  theme.js
  images.js
```

## Deploy (mantenedor)

> **Obrigatório:** em **Settings → Pages → Build and deployment → Source**,  
> escolha **GitHub Actions** (não “Deploy from a branch”).  
> Com “Deploy from a branch”, o `firebase-config.js` não sobe (está no `.gitignore`) → **404** e o app trava.

1. Secrets em **Settings → Secrets and variables → Actions**:
   - `FIREBASE_API_KEY`
   - `FIREBASE_AUTH_DOMAIN`
   - `FIREBASE_PROJECT_ID`
   - `FIREBASE_STORAGE_BUCKET`
   - `FIREBASE_MESSAGING_SENDER_ID`
   - `FIREBASE_APP_ID`
2. **Settings → Pages → Source**: **GitHub Actions**
3. **Actions** → **Deploy GitHub Pages** → **Run workflow** (ou push na `main`)
4. Confirme que `https://SEU_USER.github.io/BancoDeHoras/js/firebase-config.js` abre o JS (não 404)
5. Hard refresh no app (Ctrl+Shift+R)
