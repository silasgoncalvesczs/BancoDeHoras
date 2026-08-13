/**
 * Exportação de relatórios (CSV e PDF).
 * PDF usa janela de impressão do navegador (Salvar como PDF).
 */
import { TimeUtils } from "./time.js";
import { Storage } from "./storage.js";

function stamp() {
  return new Date().toISOString().slice(0, 10);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function escapeCsv(value) {
  const text = String(value ?? "");
  if (/[;"\n\r]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function buildRows(entries) {
  return entries.map((entry) => {
    const signed = entry.type === "credit" ? entry.minutes : -entry.minutes;
    return {
      date: entry.date,
      dateBR: TimeUtils.formatDateBR(entry.date),
      type: entry.type === "credit" ? "Hora extra" : "Compensação",
      duration: TimeUtils.formatDuration(signed, { signed: true }),
      note: entry.note || "",
    };
  });
}

/** Gera e baixa CSV (separador ; para Excel em pt-BR). */
export function exportCSV(entries = Storage.listEntries()) {
  if (!entries.length) {
    throw new Error("Não há lançamentos para exportar.");
  }

  const totals = Storage.computeTotals(entries);
  const rows = buildRows(entries);

  const lines = [
    ["Data", "Tipo", "Duração", "Descrição"].map(escapeCsv).join(";"),
    ...rows.map((row) =>
      [row.date, row.type, row.duration, row.note].map(escapeCsv).join(";")
    ),
    "",
    ["Resumo", "", "", ""].join(";"),
    ["Créditos", TimeUtils.formatDuration(totals.credit), "", ""].map(escapeCsv).join(";"),
    ["Débitos", TimeUtils.formatDuration(totals.debit), "", ""].map(escapeCsv).join(";"),
    ["Saldo", TimeUtils.formatDuration(totals.balance, { signed: totals.balance !== 0 }), "", ""]
      .map(escapeCsv)
      .join(";"),
  ];

  // BOM para Excel reconhecer UTF-8
  const content = `\uFEFF${lines.join("\r\n")}`;
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, `banco-horas-${stamp()}.csv`);
}

/** Abre relatório formatado para salvar como PDF via impressão. */
export function exportPDF(entries = Storage.listEntries(), { userEmail = "" } = {}) {
  if (!entries.length) {
    throw new Error("Não há lançamentos para exportar.");
  }

  const totals = Storage.computeTotals(entries);
  const rows = buildRows(entries);
  const generatedAt = new Date().toLocaleString("pt-BR");

  const tableRows = rows
    .map(
      (row) => `
      <tr>
        <td>${escapeHtml(row.dateBR)}</td>
        <td>${escapeHtml(row.type)}</td>
        <td class="mono">${escapeHtml(row.duration)}</td>
        <td>${escapeHtml(row.note || "—")}</td>
      </tr>`
    )
    .join("");

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Banco de Horas — Relatório</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 32px;
      font-family: "Segoe UI", system-ui, sans-serif;
      color: #142022;
      line-height: 1.45;
    }
    h1 { margin: 0 0 4px; font-size: 22px; }
    .meta { color: #5a6b6d; font-size: 13px; margin-bottom: 24px; }
    .summary {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
      margin-bottom: 24px;
    }
    .card {
      border: 1px solid #d5dedf;
      border-radius: 8px;
      padding: 12px 14px;
    }
    .card span { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #6b7f81; }
    .card strong { font-family: ui-monospace, monospace; font-size: 18px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #e2e8e8; }
    th { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #6b7f81; }
    .mono { font-family: ui-monospace, monospace; white-space: nowrap; }
    @media print {
      body { padding: 12px; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  <h1>Banco de Horas</h1>
  <p class="meta">
    Relatório gerado em ${generatedAt}
    ${userEmail ? `<br>Conta: ${escapeHtml(userEmail)}` : ""}
  </p>

  <div class="summary">
    <div class="card">
      <span>Créditos</span>
      <strong>${TimeUtils.formatDuration(totals.credit)}</strong>
    </div>
    <div class="card">
      <span>Débitos</span>
      <strong>${TimeUtils.formatDuration(totals.debit)}</strong>
    </div>
    <div class="card">
      <span>Saldo</span>
      <strong>${TimeUtils.formatDuration(totals.balance, { signed: totals.balance !== 0 })}</strong>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Data</th>
        <th>Tipo</th>
        <th>Duração</th>
        <th>Descrição</th>
      </tr>
    </thead>
    <tbody>
      ${tableRows}
    </tbody>
  </table>

  <script>
    window.addEventListener("load", () => {
      setTimeout(() => window.print(), 250);
    });
  <\/script>
</body>
</html>`;

  const report = window.open("", "_blank");
  if (!report) {
    throw new Error("Permita pop-ups para exportar o PDF.");
  }
  report.document.open();
  report.document.write(html);
  report.document.close();
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
