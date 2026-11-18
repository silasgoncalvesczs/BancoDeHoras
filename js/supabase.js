/**
 * Inicialização do Supabase (Auth + banco + Storage).
 * A config vem de supabase-config.js (local ou gerado no deploy).
 *
 * Expõe a mesma API que o antigo firebase.js usava no app,
 * com o usuário normalizado para { uid, email, displayName }.
 */
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { supabaseConfig } from "./supabase-config.js";

// Captura o retorno de links de e-mail (recuperação/confirmação) ANTES do
// client processar e limpar a URL.
const initialRedirect = parseAuthRedirect(window.location);

const supabase = createClient(supabaseConfig.url, supabaseConfig.anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: "implicit",
  },
});

let currentUser = null;

function parseAuthRedirect(location) {
  const hash = new URLSearchParams(String(location.hash || "").replace(/^#/, ""));
  const query = new URLSearchParams(location.search || "");
  const pick = (key) => hash.get(key) || query.get(key) || "";
  return {
    type: pick("type"),
    errorCode: pick("error_code") || pick("error"),
    errorDescription: pick("error_description"),
  };
}

function toAppUser(user) {
  if (!user) return null;
  return {
    uid: user.id,
    email: user.email || "",
    displayName: String(user.user_metadata?.display_name || "").trim(),
  };
}

function mapAuthError(error) {
  const code = error?.code || "";
  const raw = String(error?.message || "");
  const byCode = {
    invalid_credentials: "E-mail ou senha incorretos.",
    user_already_exists: "Este e-mail já está cadastrado.",
    email_exists: "Este e-mail já está cadastrado.",
    email_not_confirmed: "Confirme seu e-mail antes de entrar (verifique a caixa de entrada e o spam).",
    weak_password: "A senha deve ter pelo menos 6 caracteres.",
    same_password: "A nova senha deve ser diferente da atual.",
    over_request_rate_limit: "Muitas tentativas. Aguarde um momento.",
    over_email_send_rate_limit: "Muitos e-mails enviados. Aguarde alguns minutos e tente de novo.",
    otp_expired:
      "Este link de recuperação expirou ou já foi usado. Solicite um novo em “Esqueci a senha”.",
    user_banned: "Esta conta está desativada.",
    validation_failed: "E-mail inválido.",
    email_address_invalid: "E-mail inválido.",
  };
  if (byCode[code]) return byCode[code];

  if (/invalid login credentials/i.test(raw)) return byCode.invalid_credentials;
  if (/already registered/i.test(raw)) return byCode.user_already_exists;
  if (/email not confirmed/i.test(raw)) return byCode.email_not_confirmed;
  if (/password should be/i.test(raw)) return byCode.weak_password;
  if (/different from the old/i.test(raw)) return byCode.same_password;
  if (/rate limit/i.test(raw)) return byCode.over_request_rate_limit;
  if (/failed to fetch|network/i.test(raw)) return "Falha de rede. Verifique sua conexão.";
  return raw || "Não foi possível autenticar.";
}

function fail(error) {
  throw new Error(mapAuthError(error));
}

/** URL base do app (para o link de e-mail voltar ao site). */
export function getAppContinueUrl() {
  const { origin, pathname } = window.location;
  const basePath = pathname.replace(/index\.html$/i, "");
  const normalized = basePath.endsWith("/") ? basePath : `${basePath}/`;
  return `${origin}${normalized === "//" ? "/" : normalized}`;
}

/** Informações do link de e-mail com que o app foi aberto (recuperação, erro). */
function getAuthRedirectInfo() {
  return { ...initialRedirect };
}

/** Mensagem amigável para um erro vindo no link de e-mail. */
function describeRedirectError(info = initialRedirect) {
  if (!info.errorCode) return "";
  return mapAuthError({ code: info.errorCode, message: info.errorDescription });
}

/** Remove tokens/erros de auth da URL (hash e query). */
function clearAuthUrl() {
  const url = new URL(window.location.href);
  ["type", "error", "error_code", "error_description", "code"].forEach((key) => {
    url.searchParams.delete(key);
  });
  window.history.replaceState({}, "", `${url.pathname}${url.search}`);
}

function getCurrentUser() {
  return currentUser;
}

/** @returns {{ needsConfirmation: boolean }} */
async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: getAppContinueUrl() },
  });
  if (error) fail(error);
  return { needsConfirmation: !data.session };
}

async function signIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) fail(error);
}

async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) fail(error);
}

async function updateDisplayName(displayName) {
  if (!currentUser) throw new Error("Faça login para continuar.");

  const name = String(displayName || "").trim().slice(0, 60);
  if (!name) throw new Error("Informe um nome de exibição.");

  const { data, error } = await supabase.auth.updateUser({ data: { display_name: name } });
  if (error) fail(error);
  currentUser = toAppUser(data.user);
  return name;
}

async function changePassword(currentPassword, newPassword) {
  if (!currentUser?.email) throw new Error("Faça login para continuar.");

  if (!currentPassword || !newPassword) {
    throw new Error("Preencha a senha atual e a nova senha.");
  }
  if (newPassword.length < 6) {
    throw new Error("A nova senha deve ter pelo menos 6 caracteres.");
  }
  if (currentPassword === newPassword) {
    throw new Error("A nova senha deve ser diferente da atual.");
  }

  // Confirma a senha atual antes de trocar.
  const { error: reauthError } = await supabase.auth.signInWithPassword({
    email: currentUser.email,
    password: currentPassword,
  });
  if (reauthError) {
    if (reauthError.code === "invalid_credentials" || /invalid login/i.test(reauthError.message)) {
      throw new Error("Senha atual incorreta.");
    }
    fail(reauthError);
  }

  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) fail(error);
}

async function resetPassword(email) {
  const normalized = String(email || "").trim();
  if (!normalized) throw new Error("Informe o e-mail.");

  const { error } = await supabase.auth.resetPasswordForEmail(normalized, {
    redirectTo: getAppContinueUrl(),
  });
  if (error) fail(error);
}

/** Define a nova senha na sessão aberta pelo link de recuperação. */
async function confirmResetPassword(newPassword) {
  if (!newPassword || newPassword.length < 6) {
    throw new Error("A nova senha deve ter pelo menos 6 caracteres.");
  }
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) fail(error);
}

/**
 * Observa mudanças de sessão. callback(user, event)
 * event: INITIAL_SESSION | SIGNED_IN | SIGNED_OUT | PASSWORD_RECOVERY | TOKEN_REFRESHED | USER_UPDATED
 */
function onAuth(callback) {
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    currentUser = toAppUser(session?.user);
    const user = currentUser;
    // Não chamar o Supabase de dentro do callback (pode travar o client):
    // adia para fora do handler.
    setTimeout(() => callback(user, event), 0);
  });
  return () => data.subscription.unsubscribe();
}

export {
  supabase,
  getCurrentUser,
  getAuthRedirectInfo,
  describeRedirectError,
  clearAuthUrl,
  signUp,
  signIn,
  signOut,
  updateDisplayName,
  changePassword,
  resetPassword,
  confirmResetPassword,
  onAuth,
};
