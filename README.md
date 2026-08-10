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
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

4. Configure o app local:

```bash
cp js/firebase-config.example.js js/firebase-config.js
```

5. Edite `js/firebase-config.js` com os dados do **seu** app Web no Firebase
6. Abra com um servidor local (não use `file://`), por exemplo Live Server

`js/firebase-config.js` não entra no Git (está no `.gitignore`).

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
```

## Deploy (mantenedor)

1. Secrets em **Settings → Secrets and variables → Actions**:
   - `FIREBASE_API_KEY`
   - `FIREBASE_AUTH_DOMAIN`
   - `FIREBASE_PROJECT_ID`
   - `FIREBASE_STORAGE_BUCKET`
   - `FIREBASE_MESSAGING_SENDER_ID`
   - `FIREBASE_APP_ID`
2. **Settings → Pages → Source**: **GitHub Actions** (não use “Deploy from a branch”)
3. Push na `main` (workflow `Deploy GitHub Pages`)
4. Confirme que `https://SEU_USER.github.io/BancoDeHoras/js/firebase-config.js` abre (não pode dar 404)