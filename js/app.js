/**
 * Controlador da interface do Banco de Horas.
 * Auth (Firebase) + lançamentos (Firestore).
 */
import {
  onAuth,
  signIn,
  signUp,
  signOut,
  updateDisplayName,
  changePassword,
  getCurrentUser,
  resetPassword,
} from "./firebase.js";
import { TimeUtils } from "./time.js";
import { Storage } from "./storage.js";
import { exportCSV, exportPDF } from "./export.js";
import { initTheme, applyTheme } from "./theme.js";
import { compressImageToDataUrl } from "./images.js";

const els = {
  boot: document.getElementById("boot-screen"),
  authScreen: document.getElementById("auth-screen"),
  appShell: document.getElementById("app-shell"),
  authForm: document.getElementById("auth-form"),
  authEmail: document.getElementById("auth-email"),
  authPassword: document.getElementById("auth-password"),
  authError: document.getElementById("auth-error"),
  authSubmit: document.getElementById("auth-submit"),
  authToggle: document.getElementById("auth-toggle"),
  authForgot: document.getElementById("auth-forgot"),
  authPasswordField: document.getElementById("auth-password-field"),
  authSuccess: document.getElementById("auth-success"),
  authTitle: document.getElementById("auth-title"),
  authSub: document.getElementById("auth-sub"),
  btnAccount: document.getElementById("btn-account"),
  accountDropdown: document.getElementById("account-dropdown"),
  accountAvatar: document.getElementById("account-avatar"),
  accountName: document.getElementById("account-name"),
  accountEmail: document.getElementById("account-email"),
  accountDropdownEmail: document.getElementById("account-dropdown-email"),
  modalDisplayName: document.getElementById("modal-display-name"),
  formDisplayName: document.getElementById("form-display-name"),
  inputDisplayName: document.getElementById("input-display-name"),
  errorDisplayName: document.getElementById("error-display-name"),
  modalPassword: document.getElementById("modal-password"),
  formPassword: document.getElementById("form-password"),
  inputCurrentPassword: document.getElementById("input-current-password"),
  inputNewPassword: document.getElementById("input-new-password"),
  inputConfirmPassword: document.getElementById("input-confirm-password"),
  errorPassword: document.getElementById("error-password"),
  form: document.getElementById("entry-form"),
  entryId: document.getElementById("entry-id"),
  date: document.getElementById("entry-date"),
  duration: document.getElementById("entry-duration"),
  note: document.getElementById("entry-note"),
  formError: document.getElementById("form-error"),
  formHeading: document.getElementById("form-heading"),
  formSub: document.getElementById("form-sub"),
  btnSubmit: document.getElementById("btn-submit"),
  btnCancel: document.getElementById("btn-cancel"),
  btnImageRemove: document.getElementById("btn-image-remove"),
  inputImageGallery: document.getElementById("entry-image-gallery"),
  inputImageCamera: document.getElementById("entry-image-camera"),
  imagePreviewWrap: document.getElementById("image-preview-wrap"),
  imagePreview: document.getElementById("image-preview"),
  modalImage: document.getElementById("modal-image"),
  lightboxImage: document.getElementById("lightbox-image"),
  balanceValue: document.getElementById("balance-value"),
  balanceHint: document.getElementById("balance-hint"),
  statCredit: document.getElementById("stat-credit"),
  statDebit: document.getElementById("stat-debit"),
  statCount: document.getElementById("stat-count"),
  historyBody: document.getElementById("history-body"),
  emptyState: document.getElementById("empty-state"),
  filterMonth: document.getElementById("filter-month"),
  btnExport: document.getElementById("btn-export"),
  exportDropdown: document.getElementById("export-dropdown"),
  toast: document.getElementById("toast"),
  footerText: document.getElementById("footer-text"),
};

let toastTimer = null;
let authMode = "login"; // login | signup | reset
let busy = false;

/** Data URL pendente para salvar no próximo submit. */
let pendingImageData = null;
/** Usuário pediu para remover a imagem existente. */
let pendingImageClear = false;
/** Data URL da imagem já salva (em edição). */
let existingImageData = "";

function showToast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.hidden = true;
  }, 2800);
}

function showFormError(message) {
  if (!message) {
    els.formError.hidden = true;
    els.formError.textContent = "";
    return;
  }
  els.formError.hidden = false;
  els.formError.textContent = message;
}

function showAuthError(message) {
  if (!message) {
    els.authError.hidden = true;
    els.authError.textContent = "";
    return;
  }
  els.authSuccess.hidden = true;
  els.authSuccess.textContent = "";
  els.authError.hidden = false;
  els.authError.textContent = message;
}

function showAuthSuccess(message) {
  if (!message) {
    els.authSuccess.hidden = true;
    els.authSuccess.textContent = "";
    return;
  }
  els.authError.hidden = true;
  els.authError.textContent = "";
  els.authSuccess.hidden = false;
  els.authSuccess.textContent = message;
}

function setAuthMode(mode) {
  authMode = mode;
  const isLogin = mode === "login";
  const isSignup = mode === "signup";
  const isReset = mode === "reset";

  els.authTitle.textContent = isReset
    ? "Recuperar senha"
    : isLogin
      ? "Entrar"
      : "Criar conta";

  els.authSub.textContent = isReset
    ? "Enviaremos um link de redefinição para o seu e-mail."
    : isLogin
      ? "Acesse seu banco de horas na nuvem."
      : "Crie uma conta para sincronizar entre dispositivos.";

  els.authSubmit.textContent = isReset
    ? "Enviar link"
    : isLogin
      ? "Entrar"
      : "Cadastrar";

  els.authPasswordField.hidden = isReset;
  els.authPassword.required = !isReset;
  els.authPassword.autocomplete = isSignup ? "new-password" : "current-password";

  els.authForgot.hidden = !isLogin;
  els.authToggle.textContent = isReset
    ? "Voltar ao login"
    : isLogin
      ? "Não tem conta? Cadastre-se"
      : "Já tem conta? Entrar";

  showAuthError("");
  showAuthSuccess("");
}

function setView(view) {
  els.boot.hidden = view !== "boot";
  els.authScreen.hidden = view !== "auth";
  els.appShell.hidden = view !== "app";
}

function setBusyAuth(isBusy) {
  busy = isBusy;
  els.authSubmit.disabled = isBusy;
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  if (busy) return;

  const email = els.authEmail.value.trim();
  const password = els.authPassword.value;

  if (!email) {
    showAuthError("Informe o e-mail.");
    els.authEmail.focus();
    return;
  }

  if (authMode !== "reset" && !password) {
    showAuthError("Informe e-mail e senha.");
    return;
  }

  try {
    setBusyAuth(true);
    showAuthError("");
    showAuthSuccess("");

    if (authMode === "reset") {
      await resetPassword(email);
      showAuthSuccess("Link enviado. Verifique sua caixa de entrada e o spam.");
      return;
    }

    if (authMode === "login") {
      await signIn(email, password);
    } else {
      await signUp(email, password);
    }
  } catch (error) {
    showAuthError(error.message || "Falha na autenticação.");
  } finally {
    setBusyAuth(false);
  }
}

function selectedType() {
  const checked = els.form.querySelector('input[name="entry-type"]:checked');
  return checked ? checked.value : "credit";
}

function setSelectedType(type) {
  const input = els.form.querySelector(`input[name="entry-type"][value="${type}"]`);
  if (input) input.checked = true;
}

function updateImageRemoveVisibility() {
  const hasPreview = !els.imagePreviewWrap.hidden;
  els.btnImageRemove.hidden = !hasPreview;
}

function clearImageInputs() {
  if (els.inputImageGallery) els.inputImageGallery.value = "";
  if (els.inputImageCamera) els.inputImageCamera.value = "";
}

function setImagePreviewFromUrl(url) {
  if (!url) {
    els.imagePreview.removeAttribute("src");
    els.imagePreviewWrap.hidden = true;
    updateImageRemoveVisibility();
    return;
  }
  els.imagePreview.src = url;
  els.imagePreviewWrap.hidden = false;
  updateImageRemoveVisibility();
}

function resetImageState() {
  pendingImageData = null;
  pendingImageClear = false;
  existingImageData = "";
  clearImageInputs();
  setImagePreviewFromUrl("");
}

async function handleImageFileSelected(file) {
  if (!file) return;
  try {
    showFormError("");
    const dataUrl = await compressImageToDataUrl(file);
    pendingImageData = dataUrl;
    pendingImageClear = false;
    setImagePreviewFromUrl(dataUrl);
  } catch (error) {
    showFormError(error.message || "Não foi possível usar esta imagem.");
    clearImageInputs();
  }
}

function handleImageRemove() {
  pendingImageData = null;
  clearImageInputs();
  if (existingImageData) {
    pendingImageClear = true;
  }
  setImagePreviewFromUrl("");
}

function openImageLightbox(dataUrl) {
  if (!dataUrl) {
    showToast("Não foi possível abrir a imagem.");
    return;
  }
  els.lightboxImage.src = dataUrl;
  openModal(els.modalImage);
}

function resetForm() {
  els.entryId.value = "";
  els.date.value = TimeUtils.todayISO();
  els.duration.value = "";
  els.note.value = "";
  setSelectedType("credit");
  showFormError("");
  els.formHeading.textContent = "Novo lançamento";
  els.formSub.textContent = "Registre horas extras ou compensações.";
  els.btnSubmit.textContent = "Adicionar";
  els.btnCancel.hidden = true;
  resetImageState();
}

function enterEditMode(entry) {
  els.entryId.value = entry.id;
  els.date.value = entry.date;
  els.duration.value = TimeUtils.formatDuration(entry.minutes);
  els.note.value = entry.note || "";
  setSelectedType(entry.type);
  showFormError("");
  els.formHeading.textContent = "Editar lançamento";
  els.formSub.textContent = "Altere os campos e salve as mudanças.";
  els.btnSubmit.textContent = "Salvar alterações";
  els.btnCancel.hidden = false;

  pendingImageData = null;
  pendingImageClear = false;
  existingImageData = entry.imageData || "";
  clearImageInputs();
  setImagePreviewFromUrl(existingImageData || "");

  els.date.focus();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function getFilteredEntries() {
  const all = Storage.listEntries();
  const month = els.filterMonth.value;
  if (month === "all") return all;
  return all.filter((entry) => TimeUtils.monthKey(entry.date) === month);
}

function refreshMonthFilter(entries) {
  const current = els.filterMonth.value || "all";
  const months = [...new Set(entries.map((e) => TimeUtils.monthKey(e.date)))].sort(
    (a, b) => b.localeCompare(a)
  );

  els.filterMonth.innerHTML = "";
  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = "Todos";
  els.filterMonth.appendChild(allOption);

  months.forEach((ym) => {
    const option = document.createElement("option");
    option.value = ym;
    option.textContent = TimeUtils.formatMonthLabel(ym);
    els.filterMonth.appendChild(option);
  });

  els.filterMonth.value = months.includes(current) || current === "all" ? current : "all";
}

function renderBalance(allEntries) {
  const totals = Storage.computeTotals(allEntries);
  const signed = totals.balance !== 0;

  els.balanceValue.textContent = TimeUtils.formatDuration(totals.balance, { signed });
  els.balanceValue.classList.toggle("is-positive", totals.balance > 0);
  els.balanceValue.classList.toggle("is-negative", totals.balance < 0);
  els.balanceValue.classList.toggle("is-zero", totals.balance === 0);

  els.statCredit.textContent = TimeUtils.formatDuration(totals.credit);
  els.statDebit.textContent = TimeUtils.formatDuration(totals.debit);
  els.statCount.textContent = String(totals.count);

  if (totals.count === 0) {
    els.balanceHint.textContent = "Nenhum lançamento ainda";
  } else if (totals.balance > 0) {
    els.balanceHint.textContent = "Horas a compensar";
  } else if (totals.balance < 0) {
    els.balanceHint.textContent = "Saldo negativo — mais compensações que créditos";
  } else {
    els.balanceHint.textContent = "Banco zerado";
  }
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderHistory(entries) {
  els.historyBody.innerHTML = "";
  const hasRows = entries.length > 0;
  els.emptyState.hidden = hasRows;
  document.getElementById("history-table").hidden = !hasRows;

  entries.forEach((entry) => {
    const tr = document.createElement("tr");
    tr.dataset.id = entry.id;

    const typeLabel = entry.type === "credit" ? "Hora extra" : "Compensação";
    const typeClass = entry.type === "credit" ? "badge-credit" : "badge-debit";
    const signedMinutes = entry.type === "credit" ? entry.minutes : -entry.minutes;
    const hasImage = Boolean(entry.imageData);

    tr.innerHTML = `
      <td data-label="Data">${TimeUtils.formatDateBR(entry.date)}</td>
      <td data-label="Tipo"><span class="badge ${typeClass}">${typeLabel}</span></td>
      <td data-label="Duração" class="mono">${TimeUtils.formatDuration(signedMinutes, { signed: true })}</td>
      <td data-label="Descrição">${escapeHtml(entry.note || "—")}</td>
      <td data-label="Foto" class="photo-cell">
        ${
          hasImage
            ? `<button type="button" class="history-thumb-btn" data-action="view-image" aria-label="Ver imagem anexada">
                <img class="history-thumb" alt="" loading="lazy">
              </button>`
            : `<span class="photo-empty">—</span>`
        }
      </td>
      <td class="actions-cell">
        <button type="button" class="btn-icon" data-action="edit" aria-label="Editar lançamento">Editar</button>
        <button type="button" class="btn-icon danger" data-action="delete" aria-label="Excluir lançamento">Excluir</button>
      </td>
    `;

    els.historyBody.appendChild(tr);

    if (hasImage) {
      const thumb = tr.querySelector(".history-thumb");
      if (thumb) thumb.src = entry.imageData;
    }
  });
}

function refreshUI() {
  const all = Storage.listEntries();
  refreshMonthFilter(all);
  renderBalance(all);
  renderHistory(getFilteredEntries());
}

async function handleSubmit(event) {
  event.preventDefault();
  if (busy) return;
  showFormError("");

  const date = els.date.value;
  if (!date) {
    showFormError("Informe a data do lançamento.");
    els.date.focus();
    return;
  }

  const normalized = TimeUtils.normalizeDurationInput(els.duration.value);
  els.duration.value = normalized;
  const minutes = TimeUtils.parseDuration(normalized);

  if (minutes === null) {
    showFormError("Use o formato hh:mm (ex.: 01:30). A duração deve ser maior que zero.");
    els.duration.focus();
    return;
  }

  const id = els.entryId.value || Storage.createId();
  const isEdit = Boolean(els.entryId.value);

  const payload = {
    id,
    date,
    type: selectedType(),
    minutes,
    note: els.note.value.trim(),
  };

  if (pendingImageData) {
    payload.imageData = pendingImageData;
  } else if (pendingImageClear) {
    payload.imageData = "";
  }

  try {
    busy = true;
    els.btnSubmit.disabled = true;
    els.btnSubmit.textContent = isEdit ? "Salvando…" : "Adicionando…";

    await Storage.upsertEntry(payload);

    resetForm();
    showToast(isEdit ? "Lançamento atualizado." : "Lançamento adicionado.");
  } catch (error) {
    console.error(error);
    const code = error?.code || "";
    if (code === "permission-denied") {
      showFormError(
        "Sem permissão no Firestore. Atualize as Rules no Firebase Console (veja o README — campo imageData)."
      );
    } else {
      showFormError(error.message || "Não foi possível salvar.");
    }
  } finally {
    busy = false;
    els.btnSubmit.disabled = false;
    els.btnSubmit.textContent = els.entryId.value ? "Salvar alterações" : "Adicionar";
  }
}

async function handleHistoryClick(event) {
  const button = event.target.closest("button[data-action]");
  if (!button || busy) return;

  const row = button.closest("tr");
  const id = row?.dataset.id;
  if (!id) return;

  if (button.dataset.action === "view-image") {
    const entry = Storage.getEntry(id);
    if (entry?.imageData) openImageLightbox(entry.imageData);
    return;
  }

  if (button.dataset.action === "edit") {
    const entry = Storage.getEntry(id);
    if (entry) enterEditMode(entry);
    return;
  }

  if (button.dataset.action === "delete") {
    const confirmed = window.confirm("Excluir este lançamento? Esta ação não pode ser desfeita.");
    if (!confirmed) return;

    try {
      busy = true;
      await Storage.deleteEntry(id);
      if (els.entryId.value === id) resetForm();
      showToast("Lançamento excluído.");
    } catch (error) {
      showToast(error.message || "Não foi possível excluir.");
    } finally {
      busy = false;
    }
  }
}

function closeExportMenu() {
  els.exportDropdown.hidden = true;
  els.btnExport.setAttribute("aria-expanded", "false");
}

function closeAccountMenu() {
  els.accountDropdown.hidden = true;
  els.btnAccount.setAttribute("aria-expanded", "false");
}

function closeMenus() {
  closeExportMenu();
  closeAccountMenu();
}

function toggleExportMenu() {
  const willOpen = els.exportDropdown.hidden;
  closeAccountMenu();
  els.exportDropdown.hidden = !willOpen;
  els.btnExport.setAttribute("aria-expanded", willOpen ? "true" : "false");
}

function toggleAccountMenu() {
  const willOpen = els.accountDropdown.hidden;
  closeExportMenu();
  els.accountDropdown.hidden = !willOpen;
  els.btnAccount.setAttribute("aria-expanded", willOpen ? "true" : "false");
}

function getInitials(name, email) {
  const source = (name || email || "?").trim();
  if (!source) return "?";
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

function refreshAccountUI(user = getCurrentUser()) {
  if (!user) return;

  const email = user.email || "";
  const displayName = (user.displayName || "").trim();
  const label = displayName || email || "Conta";

  els.accountName.textContent = label;
  els.accountEmail.textContent = displayName ? email : "Gerenciar conta";
  els.accountDropdownEmail.textContent = email;
  els.accountAvatar.textContent = getInitials(displayName, email);
  els.btnAccount.title = email ? `Conta: ${email}` : "Conta";
  els.btnAccount.setAttribute("aria-label", `Menu da conta${email ? `: ${email}` : ""}`);
}

function openModal(modal) {
  closeMenus();
  modal.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeModal(modal) {
  modal.hidden = true;
  if (els.modalDisplayName.hidden && els.modalPassword.hidden) {
    document.body.style.overflow = "";
  }
}

function closeAllModals() {
  closeModal(els.modalDisplayName);
  closeModal(els.modalPassword);
  if (els.modalImage) {
    closeModal(els.modalImage);
    els.lightboxImage.removeAttribute("src");
  }
  els.errorDisplayName.hidden = true;
  els.errorPassword.hidden = true;
}

function openDisplayNameModal() {
  const user = getCurrentUser();
  els.inputDisplayName.value = user?.displayName || "";
  els.errorDisplayName.hidden = true;
  els.errorDisplayName.textContent = "";
  openModal(els.modalDisplayName);
  els.inputDisplayName.focus();
  els.inputDisplayName.select();
}

function openPasswordModal() {
  els.formPassword.reset();
  els.errorPassword.hidden = true;
  els.errorPassword.textContent = "";
  openModal(els.modalPassword);
  els.inputCurrentPassword.focus();
}

function handleExportOption(format) {
  closeMenus();
  const user = getCurrentUser();
  try {
    if (format === "csv") {
      exportCSV();
      showToast("CSV exportado.");
      return;
    }
    if (format === "pdf") {
      exportPDF(Storage.listEntries(), {
        userEmail: user?.email || user?.displayName || "",
      });
      showToast("Use Salvar como PDF na janela de impressão.");
    }
  } catch (error) {
    showToast(error.message || "Falha ao exportar.");
  }
}

async function handleLogout() {
  closeMenus();
  try {
    await signOut();
  } catch (error) {
    showToast(error.message || "Não foi possível sair.");
  }
}

async function handleDisplayNameSubmit(event) {
  event.preventDefault();
  if (busy) return;

  try {
    busy = true;
    els.errorDisplayName.hidden = true;
    const name = await updateDisplayName(els.inputDisplayName.value);
    refreshAccountUI(getCurrentUser());
    closeModal(els.modalDisplayName);
    showToast(`Nome atualizado: ${name}`);
  } catch (error) {
    els.errorDisplayName.hidden = false;
    els.errorDisplayName.textContent = error.message || "Não foi possível salvar.";
  } finally {
    busy = false;
  }
}

async function handlePasswordSubmit(event) {
  event.preventDefault();
  if (busy) return;

  const currentPassword = els.inputCurrentPassword.value;
  const newPassword = els.inputNewPassword.value;
  const confirmPassword = els.inputConfirmPassword.value;

  if (newPassword !== confirmPassword) {
    els.errorPassword.hidden = false;
    els.errorPassword.textContent = "A confirmação não confere com a nova senha.";
    return;
  }

  try {
    busy = true;
    els.errorPassword.hidden = true;
    await changePassword(currentPassword, newPassword);
    closeModal(els.modalPassword);
    els.formPassword.reset();
    showToast("Senha atualizada com sucesso.");
  } catch (error) {
    els.errorPassword.hidden = false;
    els.errorPassword.textContent = error.message || "Não foi possível atualizar a senha.";
  } finally {
    busy = false;
  }
}

function handleAccountAction(action) {
  closeAccountMenu();
  if (action === "logout") {
    handleLogout();
    return;
  }
  if (action === "display-name") {
    openDisplayNameModal();
    return;
  }
  if (action === "password") {
    openPasswordModal();
  }
}

function handleThemeChoice(theme) {
  const next = applyTheme(theme);
  showToast(next === "dark" ? "Tema escuro ativado." : "Tema claro ativado.");
}

function bindEvents() {
  els.authForm.addEventListener("submit", handleAuthSubmit);
  els.authForgot.addEventListener("click", () => setAuthMode("reset"));
  els.authToggle.addEventListener("click", () => {
    if (authMode === "reset" || authMode === "signup") {
      setAuthMode("login");
      return;
    }
    setAuthMode("signup");
  });

  els.form.addEventListener("submit", handleSubmit);
  els.btnCancel.addEventListener("click", () => {
    resetForm();
    showToast("Edição cancelada.");
  });

  // Labels (for=) abrem o file picker; hidden em input[type=file] quebra o click no desktop
  els.btnImageRemove.addEventListener("click", handleImageRemove);
  els.inputImageGallery.addEventListener("change", () => {
    const file = els.inputImageGallery.files?.[0];
    handleImageFileSelected(file);
  });
  els.inputImageCamera.addEventListener("change", () => {
    const file = els.inputImageCamera.files?.[0];
    handleImageFileSelected(file);
  });

  els.duration.addEventListener("keydown", (event) => {
    const allowed = [
      "Backspace",
      "Delete",
      "Tab",
      "Escape",
      "Enter",
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "ArrowDown",
      "Home",
      "End",
    ];
    if (allowed.includes(event.key) || event.ctrlKey || event.metaKey) return;
    if (!/^\d$/.test(event.key)) {
      event.preventDefault();
    }
  });

  els.duration.addEventListener("input", () => {
    const masked = TimeUtils.maskDurationInput(els.duration.value);
    els.duration.value = masked;
  });

  els.duration.addEventListener("paste", (event) => {
    event.preventDefault();
    const text = event.clipboardData?.getData("text") || "";
    els.duration.value = TimeUtils.maskDurationInput(text);
  });

  els.duration.addEventListener("blur", () => {
    const normalized = TimeUtils.normalizeDurationInput(els.duration.value);
    els.duration.value = normalized === "00:00" ? "" : normalized;
  });

  els.filterMonth.addEventListener("change", () => {
    renderHistory(getFilteredEntries());
  });

  els.historyBody.addEventListener("click", handleHistoryClick);

  els.btnAccount.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleAccountMenu();
  });

  els.accountDropdown.addEventListener("click", (event) => {
    event.stopPropagation();

    const themeBtn = event.target.closest("[data-theme-set]");
    if (themeBtn) {
      handleThemeChoice(themeBtn.dataset.themeSet);
      return;
    }

    const option = event.target.closest("[data-account]");
    if (!option) return;
    handleAccountAction(option.dataset.account);
  });

  els.btnExport.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleExportMenu();
  });

  els.exportDropdown.addEventListener("click", (event) => {
    const option = event.target.closest("[data-export]");
    if (!option) return;
    handleExportOption(option.dataset.export);
  });

  els.formDisplayName.addEventListener("submit", handleDisplayNameSubmit);
  els.formPassword.addEventListener("submit", handlePasswordSubmit);

  document.querySelectorAll("[data-close-modal]").forEach((el) => {
    el.addEventListener("click", () => closeAllModals());
  });

  document.addEventListener("click", () => closeMenus());
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeMenus();
      closeAllModals();
    }
  });

  Storage.onEntriesChange(() => {
    if (!els.appShell.hidden) refreshUI();
  });
}

async function onUserSignedIn(user) {
  refreshAccountUI(user);
  els.footerText.textContent =
    "Dados sincronizados na nuvem (Firebase). Exporte em CSV ou PDF quando precisar.";
  Storage.setUser(user.uid);
  resetForm();
  setView("app");
  refreshUI();

  try {
    const migrated = await Storage.migrateLocalIfCloudEmpty();
    if (migrated > 0) {
      showToast(`Migrados ${migrated} lançamento(s) deste navegador para a nuvem.`);
    }
  } catch (error) {
    console.warn("Migração local ignorada:", error);
  }
}

function onUserSignedOut() {
  Storage.clearUser();
  resetForm();
  els.authPassword.value = "";
  closeAllModals();
  closeMenus();
  setAuthMode("login");
  setView("auth");
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch((error) => {
      console.warn("Service Worker não registrado:", error);
    });
  });
}

function init() {
  try {
    initTheme();
    bindEvents();
    setAuthMode("login");
    setView("boot");
    registerServiceWorker();

    let resolved = false;
    const timeoutId = setTimeout(() => {
      if (!resolved) {
        console.warn("Auth demorou para responder; exibindo tela de login.");
        setView("auth");
        showAuthError("Conexão lenta com o Firebase. Tente entrar mesmo assim.");
      }
    }, 8000);

    onAuth((user) => {
      resolved = true;
      clearTimeout(timeoutId);
      if (user) {
        onUserSignedIn(user);
      } else {
        onUserSignedOut();
      }
    });
  } catch (error) {
    console.error(error);
    setView("auth");
    showAuthError("Falha ao iniciar o app. Recarregue a página.");
  }
}

init();
