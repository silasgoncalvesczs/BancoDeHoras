/**
 * Configuração do Supabase — EXEMPLO
 *
 * 1. Copie este arquivo para: js/supabase-config.js
 * 2. Preencha com os dados do SEU projeto (Supabase Dashboard → Project Settings → API)
 * 3. Não versionar supabase-config.js (já está no .gitignore)
 *
 * Use SOMENTE a chave "anon" / "publishable" (pública).
 * NUNCA coloque a "service_role" / "secret" aqui — ela ignora as regras (RLS).
 */
export const supabaseConfig = {
  url: "https://SEU_PROJETO.supabase.co",
  anonKey: "SUA_ANON_KEY",
};
