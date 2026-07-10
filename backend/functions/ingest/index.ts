// ReportStudio · Edge Function `ingest` (Supabase / Deno)
// ------------------------------------------------------------------
// Recebe o webhook do Tally (FORM_RESPONSE), normaliza para linhas
// (submissão × pergunta) e faz UPSERT idempotente em `responses`.
//
// Deploy:  supabase functions deploy ingest --no-verify-jwt
// Segredos:
//   supabase secrets set TALLY_SIGNING_SECRET=...   # do painel de webhooks do Tally
//   (SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são injetados automaticamente)
//
// Webhook no Tally: Integrations → Webhooks → URL da função + Signing secret.
// ------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SIGNING_SECRET = Deno.env.get("TALLY_SIGNING_SECRET") ?? "";

const db = createClient(SUPABASE_URL, SERVICE_KEY);

// --- Verificação da assinatura do Tally (HMAC SHA256, header Tally-Signature) ---
async function verifySignature(rawBody: string, signature: string | null): Promise<boolean> {
  if (!SIGNING_SECRET) return true; // sem segredo configurado → não verifica (dev)
  if (!signature) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(SIGNING_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return expected === signature;
}

// --- Derivação de client/turma/client_info a partir da submissão ---
// NOTA: o parsing do "client_raw" espelha o formato atual "CLIENT PROGRAM TURMA EDICAO"
// (ex.: "LTP &&PSCH COACHING mai.25"). Afinar quando virmos o 1º payload real / o Apps Script.
function deriveClientFields(
  fields: Array<{ key: string; label: string; value: unknown }>,
  map: { client_strategy: string; client_fixed: string | null },
) {
  if (map.client_strategy === "fixed") {
    const turma = fieldValue(fields, /turma|class/i);
    const edition = fieldValue(fields, /edi|month|mes/i);
    return { client: map.client_fixed ?? null, turma, client_info: edition };
  }
  // 'hidden': campo escondido "client_raw"
  const raw = String(fieldValue(fields, /client_raw/i) ?? "").trim();
  if (raw) {
    const parts = raw.split(/\s+/);
    return {
      client: parts[0] ?? null,
      // program vem do form_map; aqui só client/turma/edição
      turma: parts[2] ?? null,
      client_info: parts.slice(3).join(" ") || null,
    };
  }
  return { client: null, turma: null, client_info: null };
}

function fieldValue(fields: Array<{ key: string; label: string; value: unknown }>, re: RegExp) {
  const f = fields.find((x) => re.test(x.key) || re.test(x.label));
  return f ? f.value : null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const rawBody = await req.text();
  const ok = await verifySignature(rawBody, req.headers.get("Tally-Signature"));
  if (!ok) return new Response("Invalid signature", { status: 401 });

  let payload: any;
  try { payload = JSON.parse(rawBody); } catch { return new Response("Bad JSON", { status: 400 }); }
  if (payload?.eventType !== "FORM_RESPONSE") return new Response("Ignored", { status: 200 });

  const d = payload.data ?? {};
  const formId: string = d.formId;
  const fields: Array<{ key: string; label: string; value: unknown }> = d.fields ?? [];

  // Mapeamento do formulário (config-driven, sem hardcode)
  const { data: map, error: mapErr } = await db
    .from("form_map").select("*").eq("form_id", formId).maybeSingle();
  if (mapErr) return new Response(`DB error: ${mapErr.message}`, { status: 500 });
  if (!map) {
    console.warn(`Form não mapeada em form_map: ${formId} (${d.formName})`);
    return new Response("Form not mapped", { status: 202 });
  }

  const { client, turma, client_info } = deriveClientFields(fields, map);

  // Uma linha por pergunta (ignora campos escondidos de controlo como client_raw)
  const rows = fields
    .filter((f) => !/client_raw/i.test(f.key) && !/client_raw/i.test(f.label))
    .map((f) => ({
      submission_id: d.submissionId,
      respondent_id: d.respondentId,
      submitted_at: d.createdAt ?? payload.createdAt ?? null,
      client, program: map.program, turma, client_info,
      section: map.section, lang: map.lang,
      question: f.label,
      value: f.value != null ? String(f.value) : null,
      source: "tally",
      dedupe_key: `tally:${formId}:${d.submissionId}:${f.key}`,
    }));

  const { error } = await db
    .from("responses")
    .upsert(rows, { onConflict: "dedupe_key", ignoreDuplicates: false });
  if (error) return new Response(`Upsert error: ${error.message}`, { status: 500 });

  return new Response(JSON.stringify({ inserted: rows.length }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
});
