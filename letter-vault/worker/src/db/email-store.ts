import { createClient } from "@supabase/supabase-js";
import {
  rankForStatus,
  shouldAdvanceEmailStatus,
  type EmailStatus,
} from "../email/status";
import type { Env } from "../env";

export interface OutboundEmailRow {
  id: string;
  idempotency_key: string;
  email_type: string;
  recipient_email: string;
  provider: string;
  provider_message_id: string | null;
  status: EmailStatus;
  status_rank: number;
  delivery_date: string;
  letter_ref: string | null;
  entitlement_ref: string | null;
  last_event_type: string | null;
  last_event_at: string | null;
  error_summary: string | null;
  created_at: string;
  updated_at: string;
}

function client(env: Env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("supabase_not_configured");
  }
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function findOutboundByIdempotencyKey(
  env: Env,
  idempotencyKey: string,
): Promise<OutboundEmailRow | null> {
  const { data, error } = await client(env)
    .from("letter_vault_email_outbound")
    .select("*")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as OutboundEmailRow | null) ?? null;
}

export async function insertOutboundQueued(
  env: Env,
  row: {
    idempotency_key: string;
    recipient_email: string;
    delivery_date: string;
    letter_ref?: string | null;
    entitlement_ref?: string | null;
    email_type?: string;
    provider?: string;
  },
): Promise<{ row: OutboundEmailRow | null; duplicate: boolean }> {
  const supabase = client(env);
  const { data, error } = await supabase
    .from("letter_vault_email_outbound")
    .insert({
      idempotency_key: row.idempotency_key,
      email_type: row.email_type ?? "seal_confirmation",
      recipient_email: row.recipient_email,
      provider: row.provider ?? "resend",
      status: "queued",
      status_rank: rankForStatus("queued"),
      delivery_date: row.delivery_date,
      letter_ref: row.letter_ref ?? null,
      entitlement_ref: row.entitlement_ref ?? null,
    })
    .select("*")
    .maybeSingle();

  if (error) {
    if (error.code === "23505") {
      const existing = await findOutboundByIdempotencyKey(
        env,
        row.idempotency_key,
      );
      return { row: existing, duplicate: true };
    }
    throw new Error(error.message);
  }

  return { row: data as OutboundEmailRow, duplicate: false };
}

export async function markOutboundSending(
  env: Env,
  id: string,
): Promise<void> {
  await client(env)
    .from("letter_vault_email_outbound")
    .update({
      status: "sending",
      status_rank: rankForStatus("sending"),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
}

export async function markOutboundSendResult(
  env: Env,
  id: string,
  result: {
    ok: boolean;
    providerMessageId: string | null;
    errorSummary: string | null;
  },
): Promise<OutboundEmailRow> {
  const status: EmailStatus = result.ok ? "sent" : "failed";
  const { data, error } = await client(env)
    .from("letter_vault_email_outbound")
    .update({
      status,
      status_rank: rankForStatus(status),
      provider_message_id: result.providerMessageId,
      error_summary: result.errorSummary,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error || !data) throw new Error(error?.message ?? "update_failed");
  return data as OutboundEmailRow;
}

export async function findOutboundByProviderMessageId(
  env: Env,
  providerMessageId: string,
): Promise<OutboundEmailRow | null> {
  const { data, error } = await client(env)
    .from("letter_vault_email_outbound")
    .select("*")
    .eq("provider_message_id", providerMessageId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as OutboundEmailRow | null) ?? null;
}

export async function recordWebhookEvent(
  env: Env,
  event: {
    provider_event_id: string;
    provider_message_id: string | null;
    event_type: string;
    outbound_email_id: string | null;
    status_applied: string | null;
  },
): Promise<{ inserted: boolean }> {
  const { error } = await client(env)
    .from("letter_vault_email_webhook_events")
    .insert(event);

  if (error) {
    if (error.code === "23505") return { inserted: false };
    throw new Error(error.message);
  }
  return { inserted: true };
}

export async function applyWebhookStatus(
  env: Env,
  outboundId: string,
  currentStatus: EmailStatus,
  nextStatus: EmailStatus,
  eventType: string,
): Promise<{ updated: boolean }> {
  if (!shouldAdvanceEmailStatus(currentStatus, nextStatus)) {
    return { updated: false };
  }

  const currentRank = rankForStatus(currentStatus);
  const nextRank = rankForStatus(nextStatus);

  const { data, error } = await client(env)
    .from("letter_vault_email_outbound")
    .update({
      status: nextStatus,
      status_rank: nextRank,
      last_event_type: eventType,
      last_event_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", outboundId)
    .eq("status_rank", currentRank)
    .select("id")
    .maybeSingle();

  if (error) throw new Error(error.message);
  return { updated: Boolean(data) };
}

export async function updateOutboundErrorSummary(
  env: Env,
  outboundId: string,
  errorSummary: string,
): Promise<void> {
  await client(env)
    .from("letter_vault_email_outbound")
    .update({
      error_summary: errorSummary.slice(0, 500),
      updated_at: new Date().toISOString(),
    })
    .eq("id", outboundId);
}

/** Staging test helper — no secrets or letter content. */
export async function fetchOutboundSummary(
  env: Env,
  id: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await client(env)
    .from("letter_vault_email_outbound")
    .select(
      "id, idempotency_key, email_type, recipient_email, provider, provider_message_id, status, status_rank, delivery_date, letter_ref, entitlement_ref, error_summary, created_at, updated_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}
