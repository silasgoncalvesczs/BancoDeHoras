/**
 * Inicialização do Firebase (Auth + Firestore).
 * Configuração do projeto: bancodehoras-4635d
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updateProfile,
  updatePassword,
  EmailAuthProvider,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyArUmw3pclLKWQBwslE9wUTDi7G2qS6R0w",
  authDomain: "bancodehoras-4635d.firebaseapp.com",
  projectId: "bancodehoras-4635d",
  storageBucket: "bancodehoras-4635d.firebasestorage.app",
  messagingSenderId: "976335937272",
  appId: "1:976335937272:web:50ef1c36edfad5c332650d",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

function mapAuthError(error) {
  const code = error?.code || "";
  const messages = {
    "auth/email-already-in-use": "Este e-mail já está cadastrado.",
    "auth/invalid-email": "E-mail inválido.",
    "auth/weak-password": "A senha deve ter pelo menos 6 caracteres.",
    "auth/user-not-found": "Usuário não encontrado.",
    "auth/wrong-password": "Senha incorreta.",
    "auth/invalid-credential": "E-mail ou senha incorretos.",
    "auth/too-many-requests": "Muitas tentativas. Aguarde um momento.",
    "auth/network-request-failed": "Falha de rede. Verifique sua conexão.",
    "auth/requires-recent-login": "Por segurança, confirme sua senha atual e tente de novo.",
    "auth/missing-email": "Informe o e-mail.",
  };
  return messages[code] || error?.message || "Não foi possível autenticar.";
}

function getCurrentUser() {
  return auth.currentUser;
}

async function signUp(email, password) {
  try {
    return await createUserWithEmailAndPassword(auth, email, password);
  } catch (error) {
    throw new Error(mapAuthError(error));
  }
}

async function signIn(email, password) {
  try {
    return await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    throw new Error(mapAuthError(error));
  }
}

async function signOut() {
  await firebaseSignOut(auth);
}

async function updateDisplayName(displayName) {
  const user = auth.currentUser;
  if (!user) throw new Error("Faça login para continuar.");

  const name = String(displayName || "").trim().slice(0, 60);
  if (!name) throw new Error("Informe um nome de exibição.");

  try {
    await updateProfile(user, { displayName: name });
    return name;
  } catch (error) {
    throw new Error(mapAuthError(error));
  }
}

async function changePassword(currentPassword, newPassword) {
  const user = auth.currentUser;
  if (!user || !user.email) throw new Error("Faça login para continuar.");

  if (!currentPassword || !newPassword) {
    throw new Error("Preencha a senha atual e a nova senha.");
  }
  if (newPassword.length < 6) {
    throw new Error("A nova senha deve ter pelo menos 6 caracteres.");
  }
  if (currentPassword === newPassword) {
    throw new Error("A nova senha deve ser diferente da atual.");
  }

  try {
    const credential = EmailAuthProvider.credential(user.email, currentPassword);
    await reauthenticateWithCredential(user, credential);
    await updatePassword(user, newPassword);
  } catch (error) {
    throw new Error(mapAuthError(error));
  }
}

async function resetPassword(email) {
  const normalized = String(email || "").trim();
  if (!normalized) throw new Error("Informe o e-mail.");

  try {
    await sendPasswordResetEmail(auth, normalized);
  } catch (error) {
    throw new Error(mapAuthError(error));
  }
}

function onAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

export {
  app,
  auth,
  db,
  getCurrentUser,
  signUp,
  signIn,
  signOut,
  updateDisplayName,
  changePassword,
  resetPassword,
  onAuth,
};
