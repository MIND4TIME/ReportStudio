#!/usr/bin/env node
// Diagnóstico read-only da API do Tally — resumo COMPACTO (cabe no fim do log).
// Revela: lista de forms, mapa questionId->texto (da definição da form) e onde
// está o client_raw, e uma submissão já mapeada. Não escreve nem commita nada.
//   TALLY_API_KEY=... node generator/inspect.mjs

const TOKEN = process.env.TALLY_API_KEY;
const API = "https://api.tally.so";
if (!TOKEN) { console.error("Falta TALLY_API_KEY."); process.exit(1); }
const H = { Authorization: `Bearer ${TOKEN}` };

const get = async (p) => {
  const r = await fetch(`${API}${p}`, { headers: H });
  const t = await r.text();
  try { return { status: r.status, json: JSON.parse(t) }; }
  catch { return { status: r.status, text: t.slice(0, 200) }; }
};
const arr = (o) => o?.forms ?? o?.items ?? o?.data ?? o?.submissions ?? o?.questions ?? (Array.isArray(o) ? o : []);
const clip = (s, n = 60) => String(s ?? "").replace(/\s+/g, " ").slice(0, n);

// 1) FORMS
const f = await get("/forms?page=1&limit=100");
const forms = arr(f.json);
console.log(`\n=== FORMS (${forms.length}) — status ${f.status} ===`);
forms.forEach((x) => console.log(`  ${x.id}  |  ${clip(x.name ?? x.title, 50)}  |  status=${x.status ?? "?"}`));
if (!forms.length) { console.log("resposta:", JSON.stringify(f.json ?? f.text).slice(0, 300)); process.exit(0); }

// 2) DEFINIÇÃO da 1.ª form (mapa questionId -> texto, e campos escondidos)
const fid = forms[0].id;
const def = await get(`/forms/${fid}`);
console.log(`\n=== DEFINIÇÃO form ${fid} — status ${def.status} ===`);
console.log("top-level keys:", def.json ? Object.keys(def.json).join(", ") : def.text);
const blocks = def.json?.blocks ?? def.json?.fields ?? def.json?.questions ?? [];
console.log(`blocks/fields: ${blocks.length}`);
blocks.slice(0, 40).forEach((b) => {
  const id = b.uuid ?? b.id ?? b.questionId;
  const title = b.title ?? b.label ?? b.payload?.title ?? b.payload?.label;
  const type = b.type ?? b.groupType;
  if (title || /hidden|input/i.test(String(type))) console.log(`  ${id}  [${clip(type,18)}]  ${clip(title, 45)}`);
});

// 3) UMA submissão, mapeada
const subs = await get(`/forms/${fid}/submissions?page=1&limit=1`);
console.log(`\n=== SUBMISSÕES form ${fid} — status ${subs.status} ===`);
console.log("top-level keys:", subs.json ? Object.keys(subs.json).join(", ") : subs.text);
const qmap = {};
(subs.json?.questions ?? []).forEach((q) => { qmap[q.id] = q.title ?? q.label; });
const sList = subs.json?.submissions ?? [];
console.log(`questions no payload: ${(subs.json?.questions ?? []).length} · submissions: ${sList.length}`);
const s0 = sList[0];
if (s0) {
  console.log("submission keys:", Object.keys(s0).join(", "));
  const responses = s0.responses ?? s0.answers ?? [];
  console.log(`respostas: ${responses.length}`);
  responses.slice(0, 40).forEach((a) => {
    const qid = a.questionId ?? a.id;
    console.log(`  ${qid} | ${clip(qmap[qid] ?? "?", 40)} = ${clip(JSON.stringify(a.answer ?? a.value), 40)}`);
  });
  // procurar algo parecido com client_raw
  const hit = responses.find((a) => /[A-Z]{2,}.*\b[a-z]{3}\.\d{2}\b/.test(String(a.answer ?? a.value ?? "")));
  console.log("possível client_raw:", hit ? JSON.stringify(hit.answer ?? hit.value) : "NÃO ENCONTRADO nas respostas visíveis");
}
