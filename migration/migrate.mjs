#!/usr/bin/env node
/**
 * Migração única: Firebase (Auth + Firestore) → Supabase (Auth + Postgres + Storage)
 *
 * Uso (dentro da pasta migration/):
 *   npm install
 *   npm run teste                                   # simulação, não grava nada
 *   node --env-file=.env migrate.mjs --only=voce@email.com   # migra só 1 conta (teste real)
 *   npm run migrar                                  # migra todas as contas
 *
 * Opções:
 *   --dry-run      só lê e mostra o que faria
 *   --only=EMAIL   migra apenas essa conta (pode repetir)
 *   --sem-senha    não importa o hash de senha (usuários usam "Esqueci a senha")
 *   --recriar      APAGA no Supabase as contas que já existem (e os dados/fotos delas)
 *                  e recria a partir do Firebase. Use antes de publicar, para pegar
 *                  senhas trocadas no Firebase (o Supabase ignora password_hash em
 *                  contas existentes). Não use depois que o app já estiver no Supabase.
 *
 * É seguro rodar de novo: usuários existentes são reaproveitados (pelo e-mail),
 * lançamentos usam IDs determinísticos e são gravados com upsert.
 * Obs.: sem --recriar, a senha de contas já existentes NÃO é atualizada.
 */
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const NO_PASSWORD = args.includes("--sem-senha");
const RECREATE = args.includes("--recriar");
const ONLY = args
  .filter((a) => a.startsWith("--only="))
  .map((a) => a.slice(7).trim().toLowerCase())
  .filter(Boolean);

const env = (name, { required = true } = {}) => {
  const value = (process.env[name] || "").trim();
  if (required && !value) {
    console.error(`✖ Variável ${name} não definida no migration/.env`);
    process.exit(1);
  }
  return value;
};

const SUPABASE_URL = env("SUPABASE_URL").replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const SERVICE_ACCOUNT_PATH = env("FIREBASE_SERVICE_ACCOUNT");
const USERS_FILE = env("FIREBASE_USERS_FILE");
const FIREBASE_STORAGE_BUCKET = env("FIREBASE_STORAGE_BUCKET", { required: false });
const HASH = NO_PASSWORD
  ? null
  : {
      signerKey: env("FIREBASE_HASH_SIGNER_KEY"),
      saltSeparator: env("FIREBASE_HASH_SALT_SEPARATOR"),
      rounds: Number(env("FIREBASE_HASH_ROUNDS")),
      memCost: Number(env("FIREBASE_HASH_MEM_COST")),
    };

const BUCKET = "entry-images";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATA_URL_RE = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/s;

// ---------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------
const serviceAccount = JSON.parse(await readFile(SERVICE_ACCOUNT_PATH, "utf8"));
initializeApp({
  credential: cert(serviceAccount),
  ...(FIREBASE_STORAGE_BUCKET ? { storageBucket: FIREBASE_STORAGE_BUCKET } : {}),
});
const firestore = getFirestore();

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

/** UUID determinístico a partir de um texto (reexecução não duplica). */
function stableUuid(text) {
  const h = createHash("sha1").update(text).digest("hex");
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Hash de senha do Firebase no formato aceito pelo Supabase Auth ($fbscrypt$). */
function firebaseScryptHash(user) {
  if (!HASH || !user.passwordHash || !user.salt) return null;
  return (
    `$fbscrypt$v=1,n=${HASH.memCost},r=${HASH.rounds},p=1,` +
    `ss=${HASH.saltSeparator},sk=${HASH.signerKey}$${user.salt}$${user.passwordHash}`
  );
}

function toIso(value) {
  if (!value) return null;
  if (value instanceof Timestamp) return value.toDate().toISOString();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

async function listAllSupabaseUsers() {
  const byEmail = new Map();
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    data.users.forEach((u) => u.email && byEmail.set(u.email.toLowerCase(), u.id));
    if (data.users.length < 1000) break;
  }
  return byEmail;
}

async function createSupabaseUser(fbUser) {
  const base = {
    email: fbUser.email,
    email_confirm: true,
    user_metadata: fbUser.displayName ? { display_name: fbUser.displayName.slice(0, 60) } : {},
    ...(fbUser.disabled ? { ban_duration: "876000h" } : {}),
  };

  const passwordHash = firebaseScryptHash(fbUser);
  if (passwordHash) {
    const { data, error } = await supabase.auth.admin.createUser({
      ...base,
      password_hash: passwordHash,
    });
    if (!error) return { id: data.user.id, password: "importada" };
    console.warn(`  ⚠ hash de senha recusado (${error.message}); criando sem senha.`);
  }

  const { data, error } = await supabase.auth.admin.createUser(base);
  if (error) throw error;
  return { id: data.user.id, password: "precisa redefinir" };
}

/** Remove fotos e a conta no Supabase (lançamentos/meta saem em cascata). */
async function deleteSupabaseUser(sbUid) {
  for (;;) {
    const { data, error } = await supabase.storage.from(BUCKET).list(sbUid, { limit: 1000 });
    if (error) throw new Error(`listar fotos: ${error.message}`);
    if (!data.length) break;
    const { error: rmError } = await supabase.storage
      .from(BUCKET)
      .remove(data.map((f) => `${sbUid}/${f.name}`));
    if (rmError) throw new Error(`apagar fotos: ${rmError.message}`);
    if (data.length < 1000) break;
  }
  const { error } = await supabase.auth.admin.deleteUser(sbUid);
  if (error) throw new Error(`apagar conta: ${error.message}`);
}

async function readImage(fbUid, docId, data) {
  // Formato atual: data URL no próprio documento
  if (typeof data.imageData === "string" && data.imageData) {
    const match = DATA_URL_RE.exec(data.imageData.replace(/\s+/g, ""));
    if (!match) return { warning: "imageData inválido (ignorado)" };
    return { buffer: Buffer.from(match[2], "base64"), contentType: match[1] };
  }
  // Formato legado: arquivo no Firebase Storage
  if (typeof data.imagePath === "string" && data.imagePath) {
    if (!FIREBASE_STORAGE_BUCKET) {
      return { warning: `imagePath legado sem FIREBASE_STORAGE_BUCKET (${data.imagePath})` };
    }
    try {
      const file = getStorage().bucket().file(data.imagePath);
      const [buffer] = await file.download();
      const [meta] = await file.getMetadata();
      return { buffer, contentType: meta.contentType || "image/jpeg" };
    } catch (error) {
      return { warning: `falha ao baixar ${data.imagePath}: ${error.message}` };
    }
  }
  return null;
}

function validEntry(data) {
  const minutes = Number(data.minutes);
  return (
    typeof data.date === "string" &&
    DATE_RE.test(data.date) &&
    !Number.isNaN(new Date(`${data.date}T00:00:00Z`).getTime()) &&
    (data.type === "credit" || data.type === "debit") &&
    Number.isInteger(minutes) &&
    minutes > 0 &&
    minutes < 100000
  );
}

async function migrateUserData(fbUid, sbUid, report) {
  const snap = await firestore.collection("users").doc(fbUid).collection("entries").get();
  const rows = [];

  for (const doc of snap.docs) {
    const data = doc.data();
    if (!validEntry(data)) {
      report.warnings.push(`lançamento ${doc.id} inválido (ignorado)`);
      continue;
    }

    const id = UUID_RE.test(doc.id) ? doc.id.toLowerCase() : stableUuid(`${fbUid}/${doc.id}`);
    let imagePath = null;

    const image = await readImage(fbUid, doc.id, data);
    if (image?.warning) report.warnings.push(`lançamento ${doc.id}: ${image.warning}`);
    if (image?.buffer) {
      const ext = image.contentType === "image/png" ? "png" : image.contentType === "image/webp" ? "webp" : "jpg";
      imagePath = `${sbUid}/${id}-migrado.${ext}`;
      if (!DRY_RUN) {
        const { error } = await supabase.storage
          .from(BUCKET)
          .upload(imagePath, image.buffer, { contentType: image.contentType, upsert: true });
        if (error) {
          report.warnings.push(`lançamento ${doc.id}: upload da imagem falhou (${error.message})`);
          imagePath = null;
        }
      }
      if (imagePath) report.images += 1;
    }

    const createdAt = toIso(data.createdAt) || new Date().toISOString();
    rows.push({
      id,
      user_id: sbUid,
      date: data.date,
      type: data.type,
      minutes: Number(data.minutes),
      note: String(data.note || "").slice(0, 120),
      image_path: imagePath,
      created_at: createdAt,
      updated_at: toIso(data.updatedAt) || createdAt,
    });
  }

  if (!DRY_RUN) {
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase.from("entries").upsert(rows.slice(i, i + 500), { onConflict: "id" });
      if (error) throw new Error(`gravar lançamentos: ${error.message}`);
    }
  }
  report.entries = rows.length;

  // Meta de horas
  const goalsDoc = await firestore.collection("users").doc(fbUid).collection("settings").doc("goals").get();
  if (goalsDoc.exists) {
    const g = goalsDoc.data();
    const goalMinutes = Math.max(0, Math.min(99999, Math.trunc(Number(g.goalMinutes) || 0)));
    if (!DRY_RUN) {
      const { error } = await supabase.from("goals").upsert(
        { user_id: sbUid, enabled: Boolean(g.enabled), goal_minutes: goalMinutes },
        { onConflict: "user_id" }
      );
      if (error) throw new Error(`gravar meta: ${error.message}`);
    }
    report.goals = true;
  }
}

// ---------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------
const exported = JSON.parse(await readFile(USERS_FILE, "utf8"));
let fbUsers = (exported.users || []).filter((u) => u.email);
if (ONLY.length) fbUsers = fbUsers.filter((u) => ONLY.includes(u.email.toLowerCase()));

console.log(
  `${DRY_RUN ? "[SIMULAÇÃO] " : ""}${fbUsers.length} conta(s) para migrar` +
    (NO_PASSWORD ? " (sem senhas)" : "")
);
if (!fbUsers.length) process.exit(0);

const existing = DRY_RUN ? new Map() : await listAllSupabaseUsers();
const results = [];

for (const fbUser of fbUsers) {
  const report = {
    email: fbUser.email,
    firebaseUid: fbUser.localId,
    supabaseUid: null,
    password: null,
    entries: 0,
    images: 0,
    goals: false,
    warnings: [],
    error: null,
  };
  console.log(`\n→ ${fbUser.email}`);

  try {
    let known = existing.get(fbUser.email.toLowerCase());
    if (known && RECREATE) {
      if (DRY_RUN) {
        console.log("  (seria apagada e recriada)");
      } else {
        await deleteSupabaseUser(known);
        console.log("  conta existente apagada; recriando…");
      }
      known = null;
    }
    if (known) {
      report.supabaseUid = known;
      report.password = "conta já existia (não alterada)";
    } else if (DRY_RUN) {
      report.supabaseUid = stableUuid(`dry/${fbUser.localId}`);
      report.password = firebaseScryptHash(fbUser) ? "seria importada" : "precisaria redefinir";
    } else {
      const created = await createSupabaseUser(fbUser);
      report.supabaseUid = created.id;
      report.password = created.password;
    }

    await migrateUserData(fbUser.localId, report.supabaseUid, report);
    console.log(
      `  ✔ senha: ${report.password} | lançamentos: ${report.entries} | fotos: ${report.images} | meta: ${report.goals ? "sim" : "não"}`
    );
    report.warnings.forEach((w) => console.log(`  ⚠ ${w}`));
  } catch (error) {
    report.error = error.message || String(error);
    console.error(`  ✖ ${report.error}`);
  }
  results.push(report);
}

const summary = {
  dryRun: DRY_RUN,
  at: new Date().toISOString(),
  accounts: results.length,
  failed: results.filter((r) => r.error).length,
  entries: results.reduce((n, r) => n + r.entries, 0),
  images: results.reduce((n, r) => n + r.images, 0),
  needPasswordReset: results.filter((r) => /redefinir/.test(r.password || "")).map((r) => r.email),
};

await writeFile(
  new URL("./migration-report.json", import.meta.url),
  JSON.stringify({ summary, results }, null, 2)
);

console.log("\n==== Resumo ====");
console.log(summary);
console.log("Relatório completo: migration/migration-report.json");
process.exit(summary.failed ? 1 : 0);
