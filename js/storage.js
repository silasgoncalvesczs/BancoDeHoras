/**
 * Persistência no Cloud Firestore (por usuário autenticado).
 * Caminho: users/{uid}/entries/{entryId}
 * Imagem opcional: campo imageData (JPEG data URL comprimido).
 *
 * Mantém cache em memória + listener em tempo real.
 */
import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  writeBatch,
  getDocs,
  deleteField,
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
import { db } from "./firebase.js";
import { isValidISODate } from "./time.js";
import { isSafeImageDataUrl } from "./images.js";

const LOCAL_KEY = "banco-horas:v1";
const SCHEMA_VERSION = 1;
const MAX_MINUTES = 999 * 60 + 59;

let currentUid = null;
let cache = [];
let unsubscribe = null;
const listeners = new Set();

function normalizeEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  if (!entry.id || !entry.date || !entry.type) return null;
  if (entry.type !== "credit" && entry.type !== "debit") return null;
  if (!isValidISODate(String(entry.date))) return null;

  const minutes = Number(entry.minutes);
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > MAX_MINUTES) return null;

  let imageData = "";
  if (typeof entry.imageData === "string" && isSafeImageDataUrl(entry.imageData)) {
    imageData = entry.imageData;
  }

  return {
    id: String(entry.id).slice(0, 80),
    date: String(entry.date).trim(),
    type: entry.type,
    minutes: Math.trunc(minutes),
    note: String(entry.note || "").slice(0, 120),
    imageData,
    createdAt: entry.createdAt || new Date().toISOString(),
    updatedAt: entry.updatedAt || entry.createdAt || new Date().toISOString(),
  };
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

function entriesRef() {
  if (!currentUid) throw new Error("Usuário não autenticado.");
  return collection(db, "users", currentUid, "entries");
}

function entryRef(id) {
  if (!currentUid) throw new Error("Usuário não autenticado.");
  return doc(db, "users", currentUid, "entries", id);
}

function requireUser() {
  if (!currentUid) throw new Error("Faça login para continuar.");
}

export function getCurrentUid() {
  return currentUid;
}

export function createId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function onEntriesChange(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function setUser(uid) {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }

  currentUid = uid || null;
  cache = [];

  if (!currentUid) {
    notify();
    return;
  }

  unsubscribe = onSnapshot(
    entriesRef(),
    (snapshot) => {
      cache = snapshot.docs
        .map((d) => normalizeEntry({ id: d.id, ...d.data() }))
        .filter(Boolean);
      notify();
    },
    (error) => {
      console.error("Firestore listener error:", error);
      notify();
    }
  );
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

export async function upsertEntry(partial) {
  requireUser();
  const now = new Date().toISOString();
  const existing = partial.id ? getEntry(partial.id) : null;
  const id = partial.id || createId();

  let imageData = existing?.imageData || "";
  if (Object.prototype.hasOwnProperty.call(partial, "imageData")) {
    imageData =
      typeof partial.imageData === "string" && isSafeImageDataUrl(partial.imageData)
        ? partial.imageData
        : "";
  }

  const entry = normalizeEntry({
    ...(existing || {}),
    ...partial,
    id,
    imageData,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  });

  if (!entry) throw new Error("Lançamento inválido.");

  const { id: _id, imageData: img, ...rest } = entry;
  const data = { ...rest };

  if (img) {
    data.imageData = img;
  } else {
    data.imageData = deleteField();
  }

  // Remove campo legado de Storage, se existir
  data.imagePath = deleteField();

  await setDoc(entryRef(id), data, { merge: true });
  return entry;
}

export async function deleteEntry(id) {
  requireUser();
  await deleteDoc(entryRef(id));
  return true;
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

export function exportJSON() {
  return JSON.stringify(
    {
      version: SCHEMA_VERSION,
      entries: listEntries(),
      updatedAt: new Date().toISOString(),
    },
    null,
    2
  );
}

export async function importJSON(rawText, { replace = true } = {}) {
  requireUser();

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error("Arquivo JSON inválido.");
  }

  const incoming = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.entries)
      ? parsed.entries
      : null;

  if (!incoming) {
    throw new Error("O arquivo não contém uma lista de lançamentos.");
  }

  const normalized = incoming.map(normalizeEntry).filter(Boolean);
  if (!normalized.length) {
    throw new Error("Nenhum lançamento válido encontrado no arquivo.");
  }

  if (replace) {
    const existing = await getDocs(entriesRef());
    const batchSize = 400;
    let batch = writeBatch(db);
    let ops = 0;

    for (const d of existing.docs) {
      batch.delete(d.ref);
      ops += 1;
      if (ops >= batchSize) {
        await batch.commit();
        batch = writeBatch(db);
        ops = 0;
      }
    }
    if (ops > 0) await batch.commit();
  }

  let batch = writeBatch(db);
  let ops = 0;

  for (const entry of normalized) {
    const { id, ...data } = entry;
    const payload = { ...data };
    if (!payload.imageData) delete payload.imageData;
    batch.set(entryRef(id), payload, { merge: !replace });
    ops += 1;
    if (ops >= 400) {
      await batch.commit();
      batch = writeBatch(db);
      ops = 0;
    }
  }
  if (ops > 0) await batch.commit();

  return normalized.length;
}

/** Lê lançamentos antigos do localStorage (antes do Firebase). */
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
  localStorage.removeItem(LOCAL_KEY);
}

/**
 * Envia dados locais para a nuvem se a conta ainda estiver vazia.
 * Retorna quantidade migrada (0 se não migrou).
 */
export async function migrateLocalIfCloudEmpty() {
  requireUser();
  const local = readLocalEntries();
  if (!local.length) return 0;

  const cloud = await getDocs(entriesRef());
  if (!cloud.empty) return 0;

  await importJSON(JSON.stringify({ entries: local }), { replace: false });
  clearLocalEntries();
  return local.length;
}

export const Storage = {
  createId,
  getCurrentUid,
  onEntriesChange,
  setUser,
  clearUser,
  listEntries,
  getEntry,
  upsertEntry,
  deleteEntry,
  computeTotals,
  exportJSON,
  importJSON,
  readLocalEntries,
  clearLocalEntries,
  migrateLocalIfCloudEmpty,
};
