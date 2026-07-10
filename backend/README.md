# ReportStudio · Backend (Supabase)

Automatiza o pipeline **Tally → Supabase → Report**, substituindo o
`Tally → Sheets → pivot manual → Apps Script → data.json`.

```
Tally (webhook FORM_RESPONSE)
        │  POST JSON assinado (HMAC SHA256)
        ▼
Edge Function `ingest`  ──►  Postgres (tabela `responses`)
                                   │
                                   ▼
                         views públicas (PostgREST)
                                   │  fetch(...) só-leitura
                                   ▼
                     report.html / index.html (estático)
```

## Ficheiros

| Ficheiro | Papel |
|---|---|
| `schema.sql` | Tabelas (`responses`, `form_map`, `archived`), views públicas e permissões |
| `functions/ingest/index.ts` | Edge Function: webhook do Tally → normaliza → upsert idempotente |
| `scripts/backfill.mjs` | Importa o `data.json` atual para `responses` (carga única) |
| `scripts/sync-webhooks.mjs` | Anexa o webhook a todas as forms do Tally, automaticamente |
| `../.github/workflows/tally-webhook-sync.yml` | Corre o sync a cada 30 min (novas forms ficam cobertas sozinhas) |

## Setup (uma vez)

1. **Criar projeto** em https://supabase.com → guardar `Project URL`, `anon key` e `service_role key`.
2. **Schema**: SQL Editor → colar `schema.sql` → Run.
3. **Backfill** do histórico:
   ```bash
   node backend/scripts/backfill.mjs --dry-run   # valida (33.573 linhas)
   SUPABASE_URL=<url> SUPABASE_SERVICE_KEY=<service_role> \
     node backend/scripts/backfill.mjs           # insere
   ```
4. **form_map** — uma linha por formulário do Tally (substitui o hardcode):
   ```sql
   insert into form_map (form_id, program, section, lang, client_strategy) values
     ('<tally_form_id>', 'P365', 'evaluation', 'pt', 'hidden');
   ```
5. **Deploy da função** (CLI do Supabase):
   ```bash
   supabase functions deploy ingest --no-verify-jwt
   supabase secrets set TALLY_SIGNING_SECRET=<segredo_do_tally>
   ```
6. **Webhooks no Tally — automático** (não é preciso adicionar form a form):
   Define os *secrets* no GitHub (`Settings → Secrets → Actions`):
   `TALLY_API_KEY`, `INGEST_URL` (= `https://<ref>.functions.supabase.co/ingest`),
   `TALLY_SIGNING_SECRET`. A Action `tally-webhook-sync` corre a cada 30 min e
   anexa o webhook a qualquer form que ainda não o tenha — incluindo forms novas.
   Testar primeiro sem escrever:
   ```bash
   TALLY_API_KEY=... INGEST_URL=... TALLY_SIGNING_SECRET=... \
     node backend/scripts/sync-webhooks.mjs --dry-run
   ```

## Cutover do frontend (fase final)

Trocar `fetch('data.json')` por leitura das views (só quando a DB estiver validada):

- `index.html` (`fetchDataAndInitUI`) → `GET /rest/v1/filter_dims` para os filtros.
- `report.html` (`build`) → `GET /rest/v1/report_rows?client=eq.<c>&program=in.(...)`.

Manter o `data.json` como fallback comutável até confiar. Depois: retirar
Sheets + Apps Script + os commits automáticos de `data.json`.

## Notas de design

- **Backfill = espelho fiel** do `data.json` (chave surrogada; sem dedupe — os IDs
  históricos colidem entre fontes). A **idempotência** aplica-se só ao ingest, via
  `dedupe_key = tally:<formId>:<submissionId>:<fieldKey>` (dados novos têm IDs reais).
- O parsing de `client_raw` em `ingest` espelha o formato atual
  `"CLIENT PROGRAM TURMA EDICAO"` — **afinar com o 1.º payload real do Tally** ou com
  o Apps Script atual.
- `meta.json` e `text_questions.json` (config editorial, pequenos) **mantêm-se estáticos**
  nesta fase; migração para tabelas fica como passo opcional futuro.
