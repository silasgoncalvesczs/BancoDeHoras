/**
 * Utilitários de tempo para o banco de horas.
 * Formato canônico: minutos (inteiro). Exibição: hh:mm.
 */
const DURATION_RE = /^(\d{1,3}):([0-5]\d)$/;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Valida YYYY-MM-DD (calendário real). */
export function isValidISODate(value) {
  if (typeof value !== "string") return false;
  const match = ISO_DATE_RE.exec(value.trim());
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;

  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

/** Converte "hh:mm" em minutos. Retorna null se inválido. */
export function parseDuration(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const match = DURATION_RE.exec(trimmed);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours === 0 && minutes === 0) return null;

  return hours * 60 + minutes;
}

/** Formata minutos (pode ser negativo) como ±hh:mm. */
export function formatDuration(totalMinutes, { signed = false } = {}) {
  const negative = totalMinutes < 0;
  const abs = Math.abs(Math.trunc(totalMinutes));
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;
  const body = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;

  if (signed || negative) {
    return `${negative ? "-" : "+"}${body}`;
  }
  return body;
}

/**
 * Máscara ao digitar: só números, ":" automático.
 * Exemplos: 1 → 1 | 13 → 13 | 130 → 1:30 | 0130 → 01:30
 */
export function maskDurationInput(raw) {
  const digits = String(raw || "").replace(/\D/g, "").slice(0, 5);
  if (!digits) return "";

  if (digits.length <= 2) return digits;

  let hours = digits.slice(0, -2);
  let minutes = digits.slice(-2);

  // Impede minutos inválidos enquanto digita (ex.: 1:99 → 1:59)
  if (Number(minutes) > 59) {
    minutes = "59";
  }

  hours = String(Number(hours));
  return `${hours}:${minutes}`;
}

/**
 * Normaliza no blur/submit para hh:mm válido.
 * "30" → "00:30" | "130" → "01:30"
 */
export function normalizeDurationInput(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";

  const digits = value.replace(/\D/g, "");
  if (!digits) return "";

  let hours;
  let minutes;

  if (digits.length <= 2) {
    hours = 0;
    minutes = Number(digits);
  } else {
    hours = Number(digits.slice(0, -2));
    minutes = Number(digits.slice(-2));
  }

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return "";
  if (minutes > 59) minutes = 59;
  if (hours > 999) hours = 999;
  if (hours === 0 && minutes === 0) return "00:00";

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** Formata ISO date (YYYY-MM-DD) para pt-BR. */
export function formatDateBR(isoDate) {
  if (!isValidISODate(isoDate)) return "—";
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** Retorna YYYY-MM-DD de hoje no fuso local. */
export function todayISO() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Extrai YYYY-MM de uma data ISO. */
export function monthKey(isoDate) {
  if (!isValidISODate(isoDate)) return "";
  return isoDate.slice(0, 7);
}

/** Rótulo amigável para YYYY-MM. */
export function formatMonthLabel(ym) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(ym || ""));
  if (!match) return "—";
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return "—";
  const date = new Date(year, month - 1, 1);
  const label = date.toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export const TimeUtils = {
  isValidISODate,
  parseDuration,
  formatDuration,
  maskDurationInput,
  normalizeDurationInput,
  formatDateBR,
  todayISO,
  monthKey,
  formatMonthLabel,
};
