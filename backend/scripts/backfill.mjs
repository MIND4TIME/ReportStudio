#!/usr/bin/env node
// ReportStudio · Backfill do data.json para a tabela `responses` (Supabase)
// ------------------------------------------------------------------
// O data.json atual já traz as colunas normalizadas, por isso o backfill
// é um mapeamento 1:1 fiel (chave surrogada; sem dedupe — é uma carga única).
//
// Uso:
//   node backend/scripts/backfill.mjs --dry-run       # valida a transformação, não escreve nada
//   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... \
//     node backend/scripts/backfill.mjs               # insere via PostgREST em lotes
//
// Nota: usa o service role key (NÃO commitar). Passa por variável de ambiente.
// ------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = resolve(__dirname, '../../data.json');
const BATCH = 500;
const dryRun = process.argv.includes('--dry-run');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const pick = (r, ...keys) => {
  for (const k of keys) if (r[k] !== undefined && r[k] !== null && r[k] !== '') return r[k];
  return null;
};

function toRow(r) {
  const submittedAt = pick(r, 'Submitted at', 'submitted_at', 'date');
  return {
    submission_id: pick(r, 'Submission ID', 'submission_id', 'id', 'OP_ID'),
    respondent_id: pick(r, 'Respondent ID', 'respondent_id'),
    submitted_at: submittedAt || null,          // ISO string ou null (strings vazias → null)
    client: pick(r, 'client'),
    program: pick(r, 'program'),
    turma: pick(r, 'turma'),
    client_info: pick(r, 'client_info'),
    section: (pick(r, 'section') || '').toLowerCase() || null,
    question: pick(r, 'question', 'Question'),
    value: r.value != null ? String(r.value) : (r.Answer != null ? String(r.Answer) : null),
    lang: pick(r, 'lang'),
    source: 'backfill',
  };
}

async function insertBatch(rows) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/responses`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`Insert falhou (${res.status}): ${await res.text()}`);
}

async function main() {
  const data = JSON.parse(readFileSync(DATA_PATH, 'utf8'));
  const rows = data.map(toRow);

  // Resumo de validação
  const sections = new Set(rows.map(r => r.section));
  const progs = new Set(rows.map(r => r.program));
  const missingSid = rows.filter(r => !r.submission_id).length;
  console.log(`Linhas: ${rows.length}`);
  console.log(`Secções: ${[...sections].join(', ')}`);
  console.log(`Programas distintos: ${progs.size}`);
  console.log(`Sem submission_id: ${missingSid}`);
  console.log('Exemplo de linha transformada:');
  console.log(JSON.stringify(rows[0], null, 2));

  if (dryRun) { console.log('\n[dry-run] Nada foi escrito.'); return; }
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('\nFaltam SUPABASE_URL / SUPABASE_SERVICE_KEY. Usa --dry-run ou define-as.');
    process.exit(1);
  }

  console.log(`\nA inserir em lotes de ${BATCH}...`);
  for (let i = 0; i < rows.length; i += BATCH) {
    await insertBatch(rows.slice(i, i + BATCH));
    process.stdout.write(`\r  ${Math.min(i + BATCH, rows.length)}/${rows.length}`);
  }
  console.log('\nBackfill concluído.');
}

main().catch(e => { console.error(e); process.exit(1); });
