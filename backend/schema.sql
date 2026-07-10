-- ReportStudio · Esquema Postgres (Supabase)
-- ------------------------------------------------------------------
-- Substitui o data.json de 24 MB por uma tabela consultável.
-- O frontend estático passa a ler de views públicas (só-leitura) via PostgREST.
--
-- Aplicar no Supabase: SQL Editor → colar este ficheiro → Run.
-- ------------------------------------------------------------------

-- ============================ DADOS ============================
-- Uma linha por (submissão, pergunta), com os MESMOS nomes de campo
-- que o report.html / index.html já consomem.
create table if not exists responses (
  id            bigint generated always as identity primary key,
  submission_id text,
  respondent_id text,
  submitted_at  timestamptz,
  client        text,
  program       text,
  turma         text,
  client_info   text,
  section       text,          -- 'assessment' | 'evaluation'
  question      text,
  value         text,          -- misto (numérico ou texto); o report faz o parse
  lang          text,          -- 'pt' | 'en'
  source        text default 'tally',  -- 'backfill' | 'tally'
  -- Idempotência do webhook: só os registos do Tally preenchem esta chave.
  -- Os do backfill ficam NULL (Postgres permite múltiplos NULL num índice único).
  dedupe_key    text unique,
  created_at    timestamptz default now()
);

create index if not exists responses_filter_idx on responses (client, program, client_info);
create index if not exists responses_section_idx on responses (section);
create index if not exists responses_turma_idx   on responses (client, program, turma);

-- ============================ CONFIG ===========================
-- Lista de exclusão (substitui archived.json). Ex.: kind='client', value='ADIDAS'.
create table if not exists archived (
  kind  text not null check (kind in ('client','program','turma')),
  value text not null,
  primary key (kind, value)
);

-- Mapeamento por formulário do Tally (substitui os valores hardcoded).
-- Nova form/cliente = nova linha aqui, sem tocar em código.
create table if not exists form_map (
  form_id        text primary key,   -- Tally formId
  program        text not null,
  section        text not null,      -- 'assessment' | 'evaluation'
  lang           text,               -- 'pt' | 'en'
  -- Como derivar client/turma/client_info da submissão:
  --  'hidden'      → campo escondido "client_raw" no formato "CLIENT PROGRAM TURMA EDICAO"
  --  'fixed'       → usa client_fixed/turma abaixo
  client_strategy text default 'hidden',
  client_fixed    text,
  notes          text
);

-- ============================ LEITURA ==========================
-- View pública consumida pelo frontend (exclui arquivados).
create or replace view report_rows as
  select r.submission_id, r.client, r.program, r.turma, r.client_info,
         r.section, r.question, r.value, r.lang
  from responses r
  where not exists (select 1 from archived a where a.kind = 'client'  and a.value = r.client)
    and not exists (select 1 from archived a where a.kind = 'program' and a.value = r.program)
    and not exists (select 1 from archived a where a.kind = 'turma'   and a.value = r.turma);

-- Dimensões distintas para construir os filtros em cascata (cliente→programa→edição→turma)
-- sem puxar todas as linhas.
create or replace view filter_dims as
  select distinct client, program, client_info, turma from report_rows;

-- ============================ ACESSO ===========================
-- Leitura pública anónima só nas views; a tabela crua fica reservada ao service role.
grant select on report_rows to anon;
grant select on filter_dims to anon;

alter table responses enable row level security;  -- sem policy de select → anon não lê a tabela crua
alter table archived  enable row level security;
alter table form_map  enable row level security;
