#!/usr/bin/env node
// Valida parseClientRaw contra o data.json atual (sem tocar na API do Tally).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseClientRaw } from "./generate-data.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(resolve(__dirname, "../data.json"), "utf8"));

let full = 0;
const fails = new Map();
for (const r of data) {
  const p = parseClientRaw(r.client_raw);
  const ok = p.client === r.client && p.program === r.program &&
             p.turma === r.turma && (p.client_info || null) === (r.client_info || null);
  if (ok) full++;
  else fails.set(r.client_raw, (fails.get(r.client_raw) || 0) + 1);
}
const pct = Math.round((full / data.length) * 100);
console.log(`parseClientRaw: ${full}/${data.length} (${pct}%) linhas idênticas ao data.json`);
console.log(`client_raw distintos a falhar: ${fails.size}`);
[...fails.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  .forEach(([k, c]) => console.log(`  ${String(c).padStart(4)}  ${JSON.stringify(k)}`));

if (pct < 90) { console.error("Abaixo de 90% — investigar."); process.exit(1); }
console.log("OK (>=90%).");
