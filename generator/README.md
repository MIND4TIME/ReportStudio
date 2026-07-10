# ReportStudio · Gerador do data.json (modelo *pull*)

Automatiza `Tally → data.json` **sem base de dados nem contas novas**.
Uma GitHub Action puxa as submissões de todas as forms via API do Tally,
normaliza e commita o `data.json`. O site estático continua igual.

```
Tally (API)  ──►  generate-data.mjs (normaliza)  ──►  data.json (repo)  ──►  report
   ▲ fonte de verdade permanente                        ▲ "DB" do report (versionada no git)
```

## Ficheiros

| Ficheiro | Papel |
|---|---|
| `generate-data.mjs` | Puxa forms + submissões do Tally, normaliza, escreve `data.json` |
| `config/mapping.json` | Overrides de `section`/`lang` por form e de `client_raw` sujos |
| `test-normalize.mjs` | Valida o parser contra o `data.json` atual (offline) |
| `../.github/workflows/generate-data.yml` | Corre o gerador de hora a hora |

## Onde ficam os dados?

- **Fonte de verdade:** o **Tally** (todas as submissões, para sempre; re-puxáveis).
- **"Base de dados" do report:** o **`data.json`** no repositório (versionado no git).
- Não há serviço de base de dados: zero contas, zero limites.

## Normalização

- `client`/`program`/`turma`/`client_info` ← parse do campo escondido **`client_raw`**
  (`"CLIENT PROGRAM TURMA [EDICAO]"`). Validado a **~100%** contra o `data.json` atual
  (`node generator/test-normalize.mjs`). Regras: maiúsculas em client/program/turma,
  edição pelo padrão de data (`mai.25`), limpeza de espaços/caracteres de controlo.
- `section`/`lang` ← nome da form (`"P365 evaluation [PT]"`), com override por `formId`
  em `config/mapping.json`.

## Setup

1. Secret no GitHub (`Settings → Secrets → Actions`): **`TALLY_API_KEY`** (Tally → Settings → API).
2. Teste read-only local (não escreve):
   ```bash
   TALLY_API_KEY=... node generator/generate-data.mjs --dry-run
   ```
   Mostra as forms, quantas submissões cada uma tem e a `section`/`lang` detetada.
3. Ativar a Action `Gerar data.json (Tally)` (corre de hora a hora e no botão *Run workflow*).

## A confirmar com dados reais

- **Formato exato da submissão** via API (`flattenSubmission`): a função assume um array
  de respostas `{key,label,value}`. Ajusta-se com o 1.º payload real (o `--dry-run` mostra-o).
- Forms cujo nome não revele `section`/`lang` → acrescentar `formOverrides[formId]`.

## Próximo passo (opcional): incremental

Hoje faz recolha **completa** (correta e simples; ao teu volume corre em <1 min).
Para escalar, liga-se o cursor `afterId` para puxar só as submissões **novas**.
