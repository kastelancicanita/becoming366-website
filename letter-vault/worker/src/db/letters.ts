import { createClient } from "@supabase/supabase-js";
import type { EncryptedEnvelope } from "../crypto/envelope";
import {
  PROCESSING_LEASE_SECONDS,
  type LetterStatus,
} from "../delivery/status";
import type { Env } from "../env";

export interface LetterRow {
  id: string;
  label: string;
  purchaser_email: string | null;
  recipient_email: string | null;
  delivery_at: string;
  delivery_timezone: string;
  status: LetterStatus;
  delivery_email_verified_at: string | null;
  delivery_email_mode?: string | null;
  ciphertext_b64: string;
  ciphertext_nonce_b64: string;
  wrapped_dek_b64: string;
  wrap_nonce_b64: string;
  master_key_version: string;
  content_hash: string;
  processing_lease_until: string | null;
  processing_claimed_by: string | null;
  attempt_count: number;
  max_attempts: number;
  entitlement_ref: string | null;
  last_error_category: string | null;
  provider_message_id: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DeliveryAttemptRow {
  id: string;
  letter_id: string;
  attempt_number: number;
  started_at: string;
  finished_at: string | null;
  provider_message_id: string | null;
  result_status: string;
  error_category: string | null;
  error_code: string | null;
}

export interface SchedulerRunRow {
  id: string;
  run_started_at: string;
  run_finished_at: string | null;
  trigger_source: string;
  letters_due_count: number;
  letters_claimed: number;
  letters_sent: number;
  letters_failed: number;
  stale_recovered: number;
  status: string;
  error_summary: string | null;
}

function client(env: Env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("supabase_not_configured");
  }
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function hasVerifiedDeliveryEmail(letter: {
  recipient_email: string | null;
  delivery_email_verified_at: string | null;
  delivery_email_mode?: string | null;
}): boolean {
  return canDeliverToRecipient(letter);
}

/** Surprise mode: address stored, no recipient verification before delivery day. */
export function canDeliverToRecipient(letter: {
  recipient_email: string | null;
  delivery_email_verified_at: string | null;
  delivery_email_mode?: string | null;
}): boolean {
  if (!letter.recipient_email) return false;
  if (letter.delivery_email_mode === "surprise") return true;
  return Boolean(letter.delivery_email_verified_at);
}

export async function insertSealedLetter(
  env: Env,
  row: {
    label: string;
    purchaser_email: string;
    recipient_email?: string | null;
    delivery_email_verified?: boolean;
    delivery_at: string;
    envelope: EncryptedEnvelope;
    entitlement_ref?: string | null;
  },
): Promise<LetterRow> {
  const verifiedAt =
    row.recipient_email && row.delivery_email_verified
      ? new Date().toISOString()
      : null;

  const { data, error } = await client(env)
    .from("letter_vault_letters")
    .insert({
      label: row.label,
      purchaser_email: row.purchaser_email.trim().toLowerCase(),
      recipient_email: row.recipient_email?.trim().toLowerCase() ?? null,
      delivery_email_verified_at: verifiedAt,
      delivery_at: row.delivery_at,
      delivery_timezone: "UTC",
      status: "SEALED",
      ciphertext_b64: row.envelope.ciphertext_b64,
      ciphertext_nonce_b64: row.envelope.ciphertext_nonce_b64,
      wrapped_dek_b64: row.envelope.wrapped_dek_b64,
      wrap_nonce_b64: row.envelope.wrap_nonce_b64,
      master_key_version: row.envelope.master_key_version,
      content_hash: row.envelope.content_hash,
      entitlement_ref: row.entitlement_ref ?? null,
    })
    .select("*")
    .single();

  if (error || !data) throw new Error(error?.message ?? "letter_insert_failed");
  return data as LetterRow;
}

export async function fetchLetterById(
  env: Env,
  id: string,
): Promise<LetterRow | null> {
  const { data, error } = await client(env)
    .from("letter_vault_letters")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as LetterRow | null) ?? null;
}

export async function fetchLetterByPublicIdForEntitlement(
  env: Env,
  publicLetterId: string,
  entitlementId: string,
): Promise<LetterRow | null> {
  const { data, error } = await client(env)
    .from("letter_vault_letters")
    .select("*")
    .eq("public_letter_id", publicLetterId.toUpperCase())
    .eq("entitlement_ref", entitlementId)
    .eq("status", "SEALED")
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as LetterRow | null) ?? null;
}

export async function fetchLetterSummary(
  env: Env,
  id: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await client(env)
    .from("letter_vault_letters")
    .select(
      "id, label, recipient_email, delivery_at, delivery_timezone, status, attempt_count, max_attempts, processing_lease_until, provider_message_id, sent_at, last_error_category, created_at, updated_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}

export async function countDueLetters(
  env: Env,
  nowIso: string,
): Promise<number> {
  const { count, error } = await client(env)
    .from("letter_vault_letters")
    .select("id", { count: "exact", head: true })
    .in("status", ["SEALED", "RETRY_REQUIRED"])
    .lte("delivery_at", nowIso);

  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function fetchDueLetterCandidates(
  env: Env,
  nowIso: string,
  limit = 10,
): Promise<LetterRow[]> {
  const { data, error } = await client(env)
    .from("letter_vault_letters")
    .select("*")
    .in("status", ["SEALED", "RETRY_REQUIRED"])
    .lte("delivery_at", nowIso)
    .order("delivery_at", { ascending: true })
    .limit(limit);

  if (error) throw new Error(error.message);
  return (data as LetterRow[]) ?? [];
}

/** Atomic claim: only one worker wins per letter. */
export async function atomicClaimLetter(
  env: Env,
  letterId: string,
  workerId: string,
  nowIso: string,
): Promise<LetterRow | null> {
  const leaseUntil = new Date(
    Date.now() + PROCESSING_LEASE_SECONDS * 1000,
  ).toISOString();

  const { data, error } = await client(env)
    .from("letter_vault_letters")
    .update({
      status: "PROCESSING",
      processing_lease_until: leaseUntil,
      processing_claimed_by: workerId,
      updated_at: nowIso,
    })
    .eq("id", letterId)
    .in("status", ["SEALED", "RETRY_REQUIRED"])
    .lte("delivery_at", nowIso)
    .select("*")
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as LetterRow | null) ?? null;
}

export async function recoverStaleProcessingLetters(
  env: Env,
  nowIso: string,
): Promise<number> {
  const { data, error } = await client(env)
    .from("letter_vault_letters")
    .update({
      status: "RETRY_REQUIRED",
      processing_lease_until: null,
      processing_claimed_by: null,
      last_error_category: "lease_expired",
      updated_at: nowIso,
    })
    .eq("status", "PROCESSING")
    .lt("processing_lease_until", nowIso)
    .select("id");

  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

export async function startDeliveryAttempt(
  env: Env,
  letterId: string,
  attemptNumber: number,
): Promise<DeliveryAttemptRow> {
  const { data, error } = await client(env)
    .from("letter_vault_delivery_attempts")
    .insert({
      letter_id: letterId,
      attempt_number: attemptNumber,
      result_status: "processing",
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data as DeliveryAttemptRow;
}

export async function finishDeliveryAttempt(
  env: Env,
  attemptId: string,
  result: {
    result_status: string;
    provider_message_id?: string | null;
    error_category?: string | null;
    error_code?: string | null;
  },
): Promise<void> {
  const { error } = await client(env)
    .from("letter_vault_delivery_attempts")
    .update({
      finished_at: new Date().toISOString(),
      result_status: result.result_status,
      provider_message_id: result.provider_message_id ?? null,
      error_category: result.error_category ?? null,
      error_code: result.error_code ?? null,
    })
    .eq("id", attemptId);

  if (error) throw new Error(error.message);
}

export async function updateLetterAfterDelivery(
  env: Env,
  letterId: string,
  update: {
    status: LetterStatus;
    attempt_count: number;
    provider_message_id?: string | null;
    sent_at?: string | null;
    last_error_category?: string | null;
    clear_lease?: boolean;
  },
): Promise<void> {
  const patch: Record<string, unknown> = {
    status: update.status,
    attempt_count: update.attempt_count,
    updated_at: new Date().toISOString(),
  };
  if (update.provider_message_id !== undefined) {
    patch.provider_message_id = update.provider_message_id;
  }
  if (update.sent_at !== undefined) patch.sent_at = update.sent_at;
  if (update.last_error_category !== undefined) {
    patch.last_error_category = update.last_error_category;
  }
  if (update.clear_lease) {
    patch.processing_lease_until = null;
    patch.processing_claimed_by = null;
  }

  const { error } = await client(env)
    .from("letter_vault_letters")
    .update(patch)
    .eq("id", letterId);

  if (error) throw new Error(error.message);
}

export async function startSchedulerRun(
  env: Env,
  triggerSource: string,
): Promise<SchedulerRunRow> {
  const { data, error } = await client(env)
    .from("letter_vault_scheduler_runs")
    .insert({ trigger_source: triggerSource, status: "running" })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data as SchedulerRunRow;
}

export async function finishSchedulerRun(
  env: Env,
  runId: string,
  stats: {
    letters_due_count: number;
    letters_claimed: number;
    letters_sent: number;
    letters_failed: number;
    stale_recovered: number;
    status: "completed" | "failed";
    error_summary?: string | null;
  },
): Promise<void> {
  const { error } = await client(env)
    .from("letter_vault_scheduler_runs")
    .update({
      run_finished_at: new Date().toISOString(),
      letters_due_count: stats.letters_due_count,
      letters_claimed: stats.letters_claimed,
      letters_sent: stats.letters_sent,
      letters_failed: stats.letters_failed,
      stale_recovered: stats.stale_recovered,
      status: stats.status,
      error_summary: stats.error_summary ?? null,
    })
    .eq("id", runId);

  if (error) throw new Error(error.message);
}

export async function fetchLatestSchedulerRun(
  env: Env,
): Promise<SchedulerRunRow | null> {
  const { data, error } = await client(env)
    .from("letter_vault_scheduler_runs")
    .select("*")
    .order("run_started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as SchedulerRunRow | null) ?? null;
}

/** Staging test: force PROCESSING with expired lease. */
export async function simulateStaleLease(
  env: Env,
  letterId: string,
): Promise<boolean> {
  const past = new Date(Date.now() - 60_000).toISOString();
  const { error } = await client(env)
    .from("letter_vault_letters")
    .update({
      status: "PROCESSING",
      processing_lease_until: past,
      processing_claimed_by: "stale-test",
      updated_at: new Date().toISOString(),
    })
    .eq("id", letterId);

  return !error;
}

export function letterToEnvelope(letter: LetterRow): EncryptedEnvelope {
  return {
    ciphertext_b64: letter.ciphertext_b64,
    ciphertext_nonce_b64: letter.ciphertext_nonce_b64,
    wrapped_dek_b64: letter.wrapped_dek_b64,
    wrap_nonce_b64: letter.wrap_nonce_b64,
    master_key_version: letter.master_key_version,
    content_hash: letter.content_hash,
  };
}
