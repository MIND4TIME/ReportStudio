#!/usr/bin/env node
// ReportStudio · Gerador do data.json a partir da API do Tally
// ------------------------------------------------------------------
// Substitui o fluxo manual (Sheets → pivot → Apps Script). Puxa as
// submissões de TODAS as forms via API do Tally, normaliza e escreve o
// data.json. Corre numa GitHub Action agendada — tu não fazes nada.
//
// Uso:
//   TALLY_API_KEY=... node generator/generate-data.mjs --dry-run   # não escreve
//   TALLY_API_KEY=... node generator/generate-data.mjs             # escreve data.json
//
// Estado atual: recolha COMPLETA (pull de tudo). O incremental (cursor
// afterId) é um add-on pequeno a ligar depois de validarmos a correção.
// ------------------------------------------------------------------

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, "../data.json");
const CONFIG = JSON.parse(readFileSync(resolve(__dirname, "config/mapping.json"), "utf8"));

const API = "https://api.tally.so";
const TOKEN = process.env.TALLY_API_KEY;
const dryRun = process.argv.includes("--dry-run");
const headers = { Authorization: `Bearer ${TOKEN}` };

// ------------------------- API do Tally -------------------------
async function api(path) {
  const res = await fetch(`${API}${path}`, { headers });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}
async function listForms() {
  const out = [];
  for (let page = 1; ; page++) {
    const d = await api(`/forms?page=${page}&limit=50`);
    const items = d.forms ?? d.items ?? [];
    out.push(...items);
    if (!d.hasMore || !items.length) break;
  }
  return out;
}
async function listSubmissions(formId) {
  const out = [];
  for (let page = 1; ; page++) {
    const d = await api(`/forms/${formId}/submissions?page=${page}&limit=100`);
    const items = d.submissions ?? d.items ?? [];
    out.push(...items);
    if (!d.hasMore || !items.length) break;
  }
  return out;
}

// ------------------------- Normalização -------------------------
const DATE = /^[a-z]{3}\.\d{2}$/i; // ex. mai.25, nov.25

// client_raw "CLIENT PROGRAM TURMA [EDICAO]" → {client, program, turma, client_info}
// (validado a ~100% contra o data.json atual; casos sujos vão por clientRawOverrides)
export function parseClientRaw(raw) {
  const key = String(raw ?? "").replace(/[\u0000-\u001f]/g, " ").trim(); // limpa caracteres de controlo
  if (CONFIG.clientRawOverrides?.[key]) return CONFIG.clientRawOverrides[key];
  const s = key.replace(/([a-z]{3})\.\s+(\d{2})/i, "$1.$2"); // "mar. 26" → "mar.26"
  const t = s.split(/\s+/).filter(Boolean);
  if (!t.length) return { client: "", program: "", turma: "", client_info: "" };
  // Sem espaços → não parseável: deixa o texto como está (fallback do Apps Script)
  if (t.length === 1) return { client: t[0], program: "", turma: "", client_info: "" };

  const up = (x) => String(x ?? "").toUpperCase();
  const program = t[1] ?? "";
  let rest = t.slice(2);
  let client_info = "";
  const di = rest.findIndex((x) => DATE.test(x));
  if (di >= 0) { client_info = rest[di]; rest = rest.filter((_, i) => i !== di); }
  rest = rest.filter((x) => x !== program);
  const turma = rest[0] ?? "";
  if (client_info === "" && rest.length > 1) client_info = rest.slice(1).join(" ");
  // client/program/turma em maiúsculas; edição fica como está
  return { client: up(t[0]), program: up(program), turma: up(turma), client_info };
}

// section/lang a partir do nome da form (com override por formId)
export function deriveSectionLang(form) {
  const ov = CONFIG.formOverrides?.[form.id];
  if (ov) return { section: ov.section, lang: ov.lang };
  const name = String(form.name ?? "").toLowerCase();
  const norm = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  let section = null;
  for (const [sec, syns] of Object.entries(CONFIG.sectionSynonyms)) {
    if (syns.some((w) => norm.includes(w.normalize("NFD").replace(/[\u0300-\u036f]/g, "")))) { section = sec; break; }
  }
  const langM = name.match(/\[(pt|en)\]/i);
  return { section, lang: langM ? langM[1].toLowerCase() : null };
}

// PROVISÓRIO: adaptar ao formato real assim que virmos 1 submissão via API.
// Espera-se que cada submissão tenha um array de respostas {key,label,value}.
function flattenSubmission(form, sub) {
  const fields = sub.responses ?? sub.fields ?? [];
  const rawField = fields.find((f) => /client_raw/i.test(f.key ?? "") || /client_raw/i.test(f.label ?? ""));
  const { client, program, turma, client_info } = parseClientRaw(rawField?.value);
  const { section, lang } = deriveSectionLang(form);
  const formProgram = CONFIG.formOverrides?.[form.id]?.program ?? program;

  return fields
    .filter((f) => !/client_raw/i.test(f.key ?? "") && !/client_raw/i.test(f.label ?? ""))
    .map((f) => ({
      "Submission ID": sub.id ?? sub.submissionId,
      "Respondent ID": sub.respondentId ?? null,
      "Submitted at": sub.submittedAt ?? sub.createdAt ?? null,
      client, program: formProgram, turma, client_info,
      section, lang,
      question: f.label,
      value: f.value != null ? String(f.value) : null,
    }));
}

// ------------------------------ Main ------------------------------
async function main() {
  if (!TOKEN) { console.error("Falta TALLY_API_KEY."); process.exit(1); }
  const forms = await listForms();
  console.log(`Forms: ${forms.length}`);

  const rows = [];
  let unmapped = 0;
  for (const form of forms) {
    const { section, lang } = deriveSectionLang(form);
    if (!section) { unmapped++; console.warn(`  sem secção (form "${form.name}") — precisa de override`); }
    const subs = await listSubmissions(form.id);
    for (const sub of subs) rows.push(...flattenSubmission(form, sub));
    console.log(`  ${form.name}: ${subs.length} submissões · secção=${section ?? "?"} lang=${lang ?? "?"}`);
  }

  console.log(`\nTotal de linhas: ${rows.length} · forms sem secção: ${unmapped}`);
  if (rows[0]) console.log("Exemplo:", JSON.stringify(rows[0]));

  if (dryRun) { console.log("\n[dry-run] Nada foi escrito."); return; }

  const prev = existsSync(OUT_PATH) ? readFileSync(OUT_PATH, "utf8") : "";
  const next = JSON.stringify(rows);
  if (next === prev) { console.log("Sem alterações — data.json mantido."); return; }
  writeFileSync(OUT_PATH, next);
  console.log(`data.json escrito (${rows.length} linhas).`);
}

// Só corre quando executado diretamente (não ao importar para testes)
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
