#!/usr/bin/env node
// Diagnóstico read-only: imprime o formato real das forms e de uma submissão
// do Tally, para afinar `flattenSubmission`. Não escreve nem commita nada.
// Corre no GitHub Actions (que tem acesso à API do Tally).
//   TALLY_API_KEY=... node generator/inspect.mjs

const TOKEN = process.env.TALLY_API_KEY;
const API = "https://api.tally.so";
if (!TOKEN) { console.error("Falta TALLY_API_KEY."); process.exit(1); }
const H = { Authorization: `Bearer ${TOKEN}` };

async function get(path) {
  const r = await fetch(`${API}${path}`, { headers: H });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = null; }
  return { status: r.status, json, text: text.slice(0, 400) };
}

const forms = await get("/forms?page=1&limit=50");
console.log("GET /forms ->", forms.status);
if (!forms.json) { console.log("body:", forms.text); process.exit(0); }

const list = forms.json.forms ?? forms.json.items ?? forms.json.data ?? [];
console.log("top-level keys:", Object.keys(forms.json));
console.log("num forms:", list.length);
console.log("nomes das forms:", list.map((f) => f.name ?? f.title).join(" | "));
console.log("primeira form:", JSON.stringify(list[0], null, 2)?.slice(0, 800));

if (list[0]) {
  const fid = list[0].id;
  const subs = await get(`/forms/${fid}/submissions?page=1&limit=1`);
  console.log("\nGET /forms/{id}/submissions ->", subs.status);
  if (subs.json) {
    console.log("top-level keys:", Object.keys(subs.json));
    const arr = subs.json.submissions ?? subs.json.items ?? subs.json.data ?? [];
    console.log("uma submissão (estrutura completa):");
    console.log(JSON.stringify(arr[0], null, 2));
  } else {
    console.log("body:", subs.text);
  }
}
