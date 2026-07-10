#!/usr/bin/env node
// Diagnóstico read-only: varre TODAS as forms e mostra, por form, se traz o
// campo escondido `client` e que valor tem; e faz deep-dive numa que NÃO traga.
//   TALLY_API_KEY=... node generator/inspect.mjs

const TOKEN = process.env.TALLY_API_KEY;
const API = "https://api.tally.so";
if (!TOKEN) { console.error("Falta TALLY_API_KEY."); process.exit(1); }
const H = { Authorization: `Bearer ${TOKEN}` };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (p, tries = 3) => {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(`${API}${p}`, { headers: H });
    if (r.status === 429) { await sleep(1500); continue; }
    const t = await r.text();
    try { return { status: r.status, json: JSON.parse(t) }; } catch { return { status: r.status, text: t.slice(0, 200) }; }
  }
  return { status: 429, text: "rate limited" };
};
const clip = (s, n = 55) => String(s ?? "").replace(/\s+/g, " ").slice(0, n);

// extrai o "client_raw" de uma submissão: 1ª resposta cujo answer é objeto com 'client'
function findClient(sub) {
  for (const r of sub.responses ?? []) {
    const a = r.answer;
    if (a && typeof a === "object" && !Array.isArray(a) && "client" in a) return a.client;
  }
  return undefined;
}

const fr = await get("/forms?page=1&limit=100");
console.log("GET /forms status:", fr.status, "keys:", fr.json ? Object.keys(fr.json).join(",") : fr.text);
const forms = fr.json?.forms ?? [];
console.log(`\n=== ${forms.length} FORMS ===`);
const semClient = [];
for (const f of forms) {
  await sleep(200);
  const d = await get(`/forms/${f.id}/submissions?page=1&limit=3`);
  const subs = d.json?.submissions ?? [];
  const total = d.json?.totalNumberOfSubmissionsPerFilter ?? subs.length;
  let client;
  for (const s of subs) { const c = findClient(s); if (c !== undefined) { client = c; break; } }
  const flag = client !== undefined ? `client="${clip(client,30)}"` : (subs.length ? "SEM client" : "sem submissões");
  console.log(`  ${f.id} | ${clip(f.name,40)} | subs=${total} | ${flag}`);
  if (client === undefined && subs.length) semClient.push({ f, d: d.json });
}

// deep-dive: primeira form COM submissões mas SEM client hidden
console.log(`\n=== ${semClient.length} forms com submissões mas SEM campo client ===`);
const dd = semClient[0];
if (dd) {
  console.log(`Deep-dive: ${dd.f.id} | ${dd.f.name}`);
  const qmap = {}; (dd.d.questions ?? []).forEach((q) => { qmap[q.id] = q.title ?? q.label; });
  const s0 = (dd.d.submissions ?? [])[0];
  console.log("submission keys:", Object.keys(s0 ?? {}).join(", "));
  (s0?.responses ?? []).slice(0, 25).forEach((r) => {
    const a = r.answer;
    const av = a && typeof a === "object" ? JSON.stringify(a) : a;
    console.log(`  ${r.questionId} | ${clip(qmap[r.questionId] ?? "?", 38)} = ${clip(av, 40)}`);
  });
}
