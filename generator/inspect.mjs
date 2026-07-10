#!/usr/bin/env node
// Diagnóstico read-only focado: para forms específicas, mostra onde está o
// cliente — respostas com answer em objeto (campos escondidos) e perguntas
// cujo título parece cliente/empresa. Não escreve nada.
//   TALLY_API_KEY=... node generator/inspect.mjs

const TOKEN = process.env.TALLY_API_KEY;
const API = "https://api.tally.so";
if (!TOKEN) { console.error("Falta TALLY_API_KEY."); process.exit(1); }
const H = { Authorization: `Bearer ${TOKEN}` };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (p) => {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(`${API}${p}`, { headers: H });
    if (r.status === 429) { await sleep(1500); continue; }
    const t = await r.text();
    try { return JSON.parse(t); } catch { return { _raw: t.slice(0, 200), _status: r.status }; }
  }
  return { _status: 429 };
};
const clip = (s, n = 45) => String(s ?? "").replace(/\s+/g, " ").slice(0, n);

// AVALIAÇÃO, P365 assessment [PT] (funciona), MKT avaliação, P365 ESTEVE
const TARGETS = { "3Epee2": "AVALIAÇÃO", "mDbe1p": "P365 assessment [PT]", "mOyNAY": "MKT avaliação [PT]", "3NKBZl": "P365 ESTEVE avaliação [EN]" };

for (const [fid, name] of Object.entries(TARGETS)) {
  await sleep(300);
  const d = await get(`/forms/${fid}/submissions?page=1&limit=2`);
  const qmap = {}; (d.questions ?? []).forEach((q) => { qmap[q.id] = q.title ?? q.label; });
  const subs = d.submissions ?? [];
  console.log(`\n=== ${name} (${fid}) · subs=${d.totalNumberOfSubmissionsPerFilter ?? subs.length} ===`);
  // perguntas com título tipo cliente/empresa
  const clientQs = (d.questions ?? []).filter((q) => /client|empresa|company|organiza|nome/i.test(q.title ?? q.label ?? ""));
  console.log("perguntas tipo cliente:", clientQs.map((q) => `${q.id}:${clip(q.title ?? q.label, 25)}`).join(" | ") || "nenhuma");
  const s0 = subs[0];
  if (!s0) { console.log("(sem submissões)"); continue; }
  // respostas cujo answer é objeto (campos escondidos / estruturados)
  for (const r of s0.responses ?? []) {
    const a = r.answer;
    if (a && typeof a === "object") {
      console.log(`  [OBJ] ${r.questionId} | ${clip(qmap[r.questionId] ?? "?", 25)} = ${JSON.stringify(a).slice(0, 120)}`);
    }
  }
  // e as respostas das perguntas tipo cliente
  for (const q of clientQs) {
    const r = (s0.responses ?? []).find((x) => x.questionId === q.id);
    console.log(`  [Q] ${clip(q.title ?? q.label, 25)} = ${JSON.stringify(r?.answer)}`);
  }
}
