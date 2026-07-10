#!/usr/bin/env node
// ReportStudio · Sync automático de webhooks do Tally
// ------------------------------------------------------------------
// Garante que TODAS as forms do Tally (incluindo as criadas de novo)
// têm o webhook a apontar para a função `ingest`. Corre num agendamento
// (GitHub Action) → nunca tens de adicionar o webhook form a form.
//
// Env:
//   TALLY_API_KEY          token da API do Tally (Settings → API)
//   INGEST_URL             URL da função ingest (https://<ref>.functions.supabase.co/ingest)
//   TALLY_SIGNING_SECRET   segredo partilhado para assinar os webhooks
//
// Uso:
//   node backend/scripts/sync-webhooks.mjs --dry-run   # só lista o que falta, não cria
//   node backend/scripts/sync-webhooks.mjs             # cria os webhooks em falta
// ------------------------------------------------------------------

const API = "https://api.tally.so";
const TOKEN = process.env.TALLY_API_KEY;
const INGEST_URL = process.env.INGEST_URL;
const SIGNING_SECRET = process.env.TALLY_SIGNING_SECRET ?? "";
const dryRun = process.argv.includes("--dry-run");

if (!TOKEN || !INGEST_URL) {
  console.error("Faltam TALLY_API_KEY e/ou INGEST_URL.");
  process.exit(1);
}

const headers = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

async function api(path, init = {}) {
  const res = await fetch(`${API}${path}`, { ...init, headers });
  if (!res.ok) throw new Error(`${init.method || "GET"} ${path} → ${res.status}: ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

// Paginação genérica (o Tally devolve { items|forms|webhooks, hasMore, page, totalCount })
async function listAll(path, key) {
  const out = [];
  for (let page = 1; ; page++) {
    const data = await api(`${path}${path.includes("?") ? "&" : "?"}page=${page}&limit=50`);
    const items = data[key] ?? data.items ?? [];
    out.push(...items);
    if (!data.hasMore || items.length === 0) break;
  }
  return out;
}

async function main() {
  const forms = await listAll("/forms", "forms");
  const webhooks = await listAll("/webhooks", "webhooks");

  // formIds que já têm um webhook a apontar para o nosso INGEST_URL
  const covered = new Set(webhooks.filter(w => w.url === INGEST_URL).map(w => w.formId));

  const missing = forms.filter(f => !covered.has(f.id));
  console.log(`Forms: ${forms.length} · já com webhook nosso: ${covered.size} · em falta: ${missing.length}`);

  if (!missing.length) { console.log("Tudo sincronizado."); return; }
  for (const f of missing) console.log(`  ${dryRun ? "[dry-run] criaria" : "a criar"}: ${f.id}  ${f.name ?? ""}`);
  if (dryRun) return;

  for (const f of missing) {
    await api("/webhooks", {
      method: "POST",
      body: JSON.stringify({
        formId: f.id,
        url: INGEST_URL,
        eventTypes: ["FORM_RESPONSE"],
        signingSecret: SIGNING_SECRET || undefined,
        isEnabled: true,
      }),
    });
    console.log(`  ✓ ${f.id}`);
  }
  console.log("Sync concluído.");
}

main().catch(e => { console.error(e); process.exit(1); });
