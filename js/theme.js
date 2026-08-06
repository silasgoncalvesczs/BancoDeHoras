/**
 * Tema claro/escuro (persistido em localStorage).
 */
const THEME_KEY = "banco-horas:theme";

export function getTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "dark" || saved === "light") return saved;
  return document.documentElement.getAttribute("data-theme") === "dark"
    ? "dark"
    : "light";
}

export function applyTheme(theme) {
  const next = theme === "dark" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem(THEME_KEY, next);

  const meta = document.getElementById("meta-theme-color");
  if (meta) {
    meta.setAttribute("content", next === "dark" ? "#0d1520" : "#0e3f73");
  }

  document.querySelectorAll("[data-theme-set]").forEach((btn) => {
    const active = btn.dataset.themeSet === next;
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  });

  return next;
}

export function initTheme() {
  return applyTheme(getTheme());
}
