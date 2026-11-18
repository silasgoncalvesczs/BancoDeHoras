/**
 * Persistência no Supabase (por usuário autenticado).
 * Tabelas: public.entries, public.goals (RLS: só o dono acessa)
 * Fotos:   bucket privado "entry-images", caminho {uid}/{entryId}-{ts}.jpg
 *
 * Mantém cache em memória + Realtime para sincronizar entre aparelhos.
 * As fotos NÃO vêm junto com a lista: só o caminho; a URL assinada é
 * gerada sob demanda (getImageUrls).
 */
import { supabase } from "./supabase.js";
import { isValidISODate } from "./time.js";

const LOCAL_KEY = "banco-horas:v1";
const MAX_MINUTES = 999 * 60 + 59;
const DEFAULT_GOALS = { enabled: false, goalMinutes: 0 };
const BUCKET = "entry-images";
const SIGNED_URL_TTL = 60 * 60; // 1h
const PAGE_SIZE = 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENTRY_COLUMNS = "id,date,type,minutes,note,image_path,created_at,updated_at";

let currentUid = null;
/** Incrementa a cada troca de usuário; descarta respostas atrasadas. */
let generation = 0;
let cache = [];
let goalsCache = { ...DEFAULT_GOALS };
let channel = null;
let refetchTimer = null;
const listeners = new Set();
const goalsListeners = new Set();
/** path -> { url, expiresAt } */
const signedUrlCache = new Map();

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function friendlyError(error, fallback) {
  const code = error?.code || "";
  const raw = String(error?.message || "");
  let message = raw || fallback;
  if (code === "42501" || /row-level security|permission denied|unauthorized/i.test(raw)) {
    message = "Sem permissão no Supabase. Confira se o supabase/schema.sql foi executado.";
  } else if (/failed to fetch|network/i.test(raw)) {
    message = "Falha de rede. Verifique sua conexão.";
  } else if (/payload too large|exceeded the maximum allowed size/i.test(raw)) {
    message = "A imagem é grande demais.";
  }
  const err = new Error(message);
  err.code = code;
  return err;
}

function requireUser() {
  if (!currentUid) throw new Error("Faça login para continuar.");
}

function isoOrNow(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

/** Valida/normaliza um lançamento (formato do app, camelCase). */
function normalizeEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  if (!entry.id || !entry.date || !entry.type) return null;
  if (entry.type !== "credit" && entry.type !== "debit") return null;
  const date = String(entry.date).trim();
  if (!isValidISODate(date)) return null;

  const minutes = Number(entry.minutes);
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > MAX_MINUTES) return null;

  const createdAt = isoOrNow(entry.createdAt);
  return {
    id: String(entry.id).slice(0, 80),
    date,
    type: entry.type,
    minutes: Math.trunc(minutes),
    note: String(entry.note || "").slice(0, 120),
    imagePath: typeof entry.imagePath === "string" && entry.imagePath ? entry.imagePath : "",
    createdAt,
    updatedAt: entry.updatedAt ? isoOrNow(entry.updatedAt) : createdAt,
  };
}

function rowToEntry(row) {
  return normalizeEntry({
    id: row.id,
    date: row.date,
    type: row.type,
    minutes: row.minutes,
    note: row.note,
    imagePath: row.image_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function sortEntries(entries) {
  return [...entries].sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    return b.createdAt.localeCompare(a.createdAt);
  });
}

function notify() {
  const snapshot = listEntries();
  listeners.forEach((fn) => fn(snapshot));
}

function notifyGoals() {
  const snapshot = getGoals();
  goalsListeners.forEach((fn) => fn(snapshot));
}

function normalizeGoals(data) {
  const enabled = Boolean(data?.enabled);
  let goalMinutes = Number(data?.goalMinutes);
  if (!Number.isFinite(goalMinutes) || goalMinutes < 0) goalMinutes = 0;
  goalMinutes = Math.min(Math.trunc(goalMinutes), MAX_MINUTES);
  return { enabled, goalMinutes };
}

export function createId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback UUID v4
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function getCurrentUid() {
  return currentUid;
}

// ---------------------------------------------------------------------
// Leitura + sincronização
// ---------------------------------------------------------------------

async function fetchEntries() {
  const gen = generation;
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("entries")
      .select(ENTRY_COLUMNS)
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw friendlyError(error, "Não foi possível carregar os lançamentos.");
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  if (gen !== generation) return; // usuário trocou no meio
  cache = rows.map(rowToEntry).filter(Boolean);
  notify();
}

async function fetchGoals() {
  const gen = generation;
  const { data, error } = await supabase
    .from("goals")
    .select("enabled,goal_minutes")
    .maybeSingle();
  if (error) throw friendlyError(error, "Não foi possível carregar a meta.");
  if (gen !== generation) return;
  goalsCache = data
    ? normalizeGoals({ enabled: data.enabled, goalMinutes: data.goal_minutes })
    : { ...DEFAULT_GOALS };
  notifyGoals();
}

function refetchAll() {
  if (!currentUid) return;
  fetchEntries().catch((error) => console.error("Falha ao carregar lançamentos:", error));
  fetchGoals().catch((error) => console.error("Falha ao carregar meta:", error));
}

/** Agrupa vários eventos do Realtime em uma única recarga. */
function scheduleRefetch() {
  clearTimeout(refetchTimer);
  refetchTimer = setTimeout(refetchAll, 300);
}

function onVisibilityChange() {
  if (document.visibilityState === "visible") scheduleRefetch();
}

function stopSync() {
  clearTimeout(refetchTimer);
  if (channel) {
    supabase.removeChannel(channel);
    channel = null;
  }
  document.removeEventListener("visibilitychange", onVisibilityChange);
}

function startSync(uid) {
  channel = supabase
    .channel(`banco-horas-${uid}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "entries", filter: `user_id=eq.${uid}` },
      scheduleRefetch
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "goals", filter: `user_id=eq.${uid}` },
      scheduleRefetch
    )
    .subscribe();
  document.addEventListener("visibilitychange", onVisibilityChange);
}

export function onEntriesChange(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function onGoalsChange(callback) {
  goalsListeners.add(callback);
  callback(getGoals());
  return () => goalsListeners.delete(callback);
}

export function setUser(uid) {
  stopSync();
  generation += 1;
  currentUid = uid || null;
  cache = [];
  goalsCache = { ...DEFAULT_GOALS };
  signedUrlCache.clear();
  notify();
  notifyGoals();

  if (!currentUid) return;
  startSync(currentUid);
  refetchAll();
}

export function clearUser() {
  setUser(null);
}

export function listEntries() {
  return sortEntries(cache);
}

export function getEntry(id) {
  return cache.find((entry) => entry.id === id) || null;
}

export function getGoals() {
  return { ...goalsCache };
}

// ---------------------------------------------------------------------
// Imagens (Storage)
// ---------------------------------------------------------------------

async function uploadImage(entryId, blob) {
  const ext = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg";
  const path = `${currentUid}/${entryId}-${Date.now()}.${ext}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { contentType: blob.type || "image/jpeg", upsert: false });
  if (error) throw friendlyError(error, "Não foi possível enviar a imagem.");
  return path;
}

async function removeImages(paths) {
  const list = paths.filter(Boolean);
  if (!list.length) return;
  list.forEach((p) => signedUrlCache.delete(p));
  const { error } = await supabase.storage.from(BUCKET).remove(list);
  if (error) console.warn("Imagem órfã não removida:", error);
}

/** Gera (ou reaproveita) URLs assinadas para os caminhos. @returns Map path→url */
export async function getImageUrls(paths) {
  const result = new Map();
  const now = Date.now();
  const missing = [];

  [...new Set(paths.filter(Boolean))].forEach((path) => {
    const cached = signedUrlCache.get(path);
    // reaproveita se ainda vale por pelo menos 5 min
    if (cached && cached.expiresAt - now > 5 * 60 * 1000) {
      result.set(path, cached.url);
    } else {
      missing.push(path);
    }
  });

  if (missing.length) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrls(missing, SIGNED_URL_TTL);
    if (error) throw friendlyError(error, "Não foi possível carregar as imagens.");
    const expiresAt = now + SIGNED_URL_TTL * 1000;
    (data || []).forEach((item) => {
      if (item.signedUrl && item.path) {
        signedUrlCache.set(item.path, { url: item.signedUrl, expiresAt });
        result.set(item.path, item.signedUrl);
      }
    });
  }

  return result;
}

export async function getImageUrl(path) {
  if (!path) return "";
  const map = await getImageUrls([path]);
  return map.get(path) || "";
}

// ---------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------

/**
 * Cria ou atualiza um lançamento.
 * partial: { id?, date, type, minutes, note, imageBlob?: Blob, clearImage?: boolean }
 */
export async function upsertEntry(partial) {
  requireUser();
  const existing = partial.id ? getEntry(partial.id) : null;
  const id = partial.id && UUID_RE.test(partial.id) ? partial.id : createId();

  const entry = normalizeEntry({
    ...(existing || {}),
    ...partial,
    id,
    createdAt: existing?.createdAt || new Date().toISOString(),
  });
  if (!entry) throw new Error("Lançamento inválido.");

  let imagePath = existing?.imagePath || null;
  let uploadedPath = null;
  let oldPathToRemove = null;

  if (partial.imageBlob) {
    uploadedPath = await uploadImage(id, partial.imageBlob);
    oldPathToRemove = imagePath;
    imagePath = uploadedPath;
  } else if (partial.clearImage) {
    oldPathToRemove = imagePath;
    imagePath = null;
  }

  const row = {
    id,
    user_id: currentUid,
    date: entry.date,
    type: entry.type,
    minutes: entry.minutes,
    note: entry.note,
    image_path: imagePath,
  };
  if (!existing) row.created_at = entry.createdAt;

  const { error } = await supabase.from("entries").upsert(row, { onConflict: "id" });
  if (error) {
    if (uploadedPath) await removeImages([uploadedPath]);
    throw friendlyError(error, "Não foi possível salvar.");
  }

  if (oldPathToRemove) await removeImages([oldPathToRemove]);
  await fetchEntries();
  return { ...entry, imagePath: imagePath || "" };
}

export async function deleteEntry(id) {
  requireUser();
  const existing = getEntry(id);
  const { error } = await supabase.from("entries").delete().eq("id", id);
  if (error) throw friendlyError(error, "Não foi possível excluir.");
  if (existing?.imagePath) await removeImages([existing.imagePath]);
  await fetchEntries();
  return true;
}

export async function saveGoals(partial) {
  requireUser();
  const next = normalizeGoals({ ...goalsCache, ...partial });

  const { error } = await supabase.from("goals").upsert(
    { user_id: currentUid, enabled: next.enabled, goal_minutes: next.goalMinutes },
    { onConflict: "user_id" }
  );
  if (error) throw friendlyError(error, "Não foi possível salvar a meta.");

  goalsCache = next;
  notifyGoals();
  return next;
}

export function computeTotals(entries = listEntries()) {
  return entries.reduce(
    (acc, entry) => {
      if (entry.type === "credit") {
        acc.credit += entry.minutes;
        acc.balance += entry.minutes;
      } else {
        acc.debit += entry.minutes;
        acc.balance -= entry.minutes;
      }
      acc.count += 1;
      return acc;
    },
    { credit: 0, debit: 0, balance: 0, count: 0 }
  );
}

// ---------------------------------------------------------------------
// Migração de dados antigos do localStorage (versão sem nuvem)
// ---------------------------------------------------------------------

/** Lê lançamentos antigos do localStorage (antes da nuvem). */
export function readLocalEntries() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.entries)) return [];
    return data.entries.map(normalizeEntry).filter(Boolean);
  } catch {
    return [];
  }
}

export function clearLocalEntries() {
  try {
    localStorage.removeItem(LOCAL_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Envia dados locais para a nuvem se a conta ainda estiver vazia.
 * Retorna quantidade migrada (0 se não migrou).
 */
export async function migrateLocalIfCloudEmpty() {
  requireUser();
  const local = readLocalEntries();
  if (!local.length) return 0;

  const { count, error } = await supabase
    .from("entries")
    .select("id", { count: "exact", head: true });
  if (error) throw friendlyError(error, "Falha ao verificar a nuvem.");
  if (count > 0) return 0;

  const rows = local.map((entry) => ({
    id: UUID_RE.test(entry.id) ? entry.id : createId(),
    user_id: currentUid,
    date: entry.date,
    type: entry.type,
    minutes: entry.minutes,
    note: entry.note,
    created_at: entry.createdAt,
  }));

  for (let i = 0; i < rows.length; i += 500) {
    const { error: insertError } = await supabase
      .from("entries")
      .upsert(rows.slice(i, i + 500), { onConflict: "id" });
    if (insertError) throw friendlyError(insertError, "Falha ao migrar dados locais.");
  }

  clearLocalEntries();
  await fetchEntries();
  return rows.length;
}

export const Storage = {
  createId,
  getCurrentUid,
  onEntriesChange,
  onGoalsChange,
  setUser,
  clearUser,
  listEntries,
  getEntry,
  getGoals,
  getImageUrls,
  getImageUrl,
  upsertEntry,
  deleteEntry,
  saveGoals,
  computeTotals,
  readLocalEntries,
  clearLocalEntries,
  migrateLocalIfCloudEmpty,
};
