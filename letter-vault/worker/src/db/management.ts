import { createClient } from "@supabase/supabase-js";
import {
  DELIVERY_EMAIL_VERIFY_TTL_MS,
  MANAGEMENT_SESSION_TTL_MS,
  MANAGEMENT_TOKEN_TTL_MS,
  expiresAtFromNow,
  hashToken,
  isExpired,
  maskEmail,
} from "../crypto/management-token";
import type { Env } from "../env";

function client(env: Env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("supabase_not_configured");
  }
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function pepper(env: Env): string {
  const p = env.LETTER_VAULT_STAGING_ADMIN_TOKEN;
  if (!p) throw new Error("management_pepper_not_configured");
  return p;
}

export async function findLetterByIdAndPurchaser(
  env: Env,
  letterId: string,
  purchaserEmail: string,
): Promise<{ id: string; purchaser_email: string; recipient_email: string | null; delivery_at: string; status: string; delivery_email_verified_at: string | null; slot_id: string | null; entitlement_ref: string | null } | null> {
  const { data, error } = await client(env)
    .from("letter_vault_letters")
    .select("id, purchaser_email, recipient_email, delivery_at, status, delivery_email_verified_at, slot_id, entitlement_ref")
    .eq("id", letterId)
    .eq("purchaser_email", purchaserEmail.trim().toLowerCase())
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}

export async function findLetterByPublicIdAndPurchaser(
  env: Env,
  publicLetterId: string,
  purchaserEmail: string,
): Promise<{ id: string; purchaser_email: string; recipient_email: string | null; delivery_at: string; status: string; delivery_email_verified_at: string | null; slot_id: string | null; entitlement_ref: string | null } | null> {
  const { data, error } = await client(env)
    .from("letter_vault_letters")
    .select("id, purchaser_email, recipient_email, delivery_at, status, delivery_email_verified_at, slot_id, entitlement_ref")
    .eq("public_letter_id", publicLetterId.toUpperCase())
    .eq("purchaser_email", purchaserEmail.trim().toLowerCase())
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}

export async function createManagementToken(
  env: Env,
  letterId: string,
  rawToken: string,
): Promise<{ id: string; expires_at: string }> {
  const tokenHash = await hashToken(pepper(env), rawToken);
  const expires_at = expiresAtFromNow(MANAGEMENT_TOKEN_TTL_MS);
  const { data, error } = await client(env)
    .from("letter_vault_management_tokens")
    .insert({ letter_id: letterId, token_hash: tokenHash, expires_at })
    .select("id, expires_at")
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function consumeManagementToken(
  env: Env,
  rawToken: string,
): Promise<{ letter_id: string } | null> {
  const validated = await validateManagementToken(env, rawToken);
  if (!validated) return null;
  const marked = await markManagementTokenUsed(env, validated.id);
  if (!marked) return null;
  return { letter_id: validated.letter_id };
}

export async function validateManagementToken(
  env: Env,
  rawToken: string,
): Promise<{ id: string; letter_id: string } | null> {
  const tokenHash = await hashToken(pepper(env), rawToken);
  const { data: row, error } = await client(env)
    .from("letter_vault_management_tokens")
    .select("id, letter_id, expires_at, used_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error || !row || row.used_at || isExpired(row.expires_at)) return null;
  return { id: row.id, letter_id: row.letter_id };
}

export async function markManagementTokenUsed(
  env: Env,
  tokenId: string,
): Promise<boolean> {
  const { data, error } = await client(env)
    .from("letter_vault_management_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("id", tokenId)
    .is("used_at", null)
    .select("id")
    .maybeSingle();

  return !error && Boolean(data);
}

export async function createManagementSession(
  env: Env,
  letterId: string,
  rawSession: string,
): Promise<{ session_token: string; expires_at: string }> {
  const sessionHash = await hashToken(pepper(env), rawSession);
  const expires_at = expiresAtFromNow(MANAGEMENT_SESSION_TTL_MS);
  const { error } = await client(env)
    .from("letter_vault_management_sessions")
    .insert({ letter_id: letterId, session_hash: sessionHash, expires_at });

  if (error) throw new Error(error.message);
  return { session_token: rawSession, expires_at };
}

export async function validateManagementSession(
  env: Env,
  rawSession: string,
): Promise<{ letter_id: string } | null> {
  const sessionHash = await hashToken(pepper(env), rawSession);
  const { data, error } = await client(env)
    .from("letter_vault_management_sessions")
    .select("letter_id, expires_at")
    .eq("session_hash", sessionHash)
    .maybeSingle();

  if (error || !data || isExpired(data.expires_at)) return null;
  return { letter_id: data.letter_id };
}

export async function getLetterManagementMetadata(
  env: Env,
  letterId: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await client(env)
    .from("letter_vault_letters")
    .select(
      "id, purchaser_email, recipient_email, delivery_at, delivery_timezone, status, delivery_email_verified_at, delivery_email_mode, sent_at, created_at",
    )
    .eq("id", letterId)
    .maybeSingle();

  if (error || !data) return null;

  return {
    letter_id: data.id,
    recipient_type: "delivery_email",
    scheduled_delivery_at: data.delivery_at,
    delivery_timezone: data.delivery_timezone,
    delivery_status: data.status,
    delivery_email_masked: data.recipient_email
      ? maskEmail(data.recipient_email)
      : null,
    delivery_email_verified: Boolean(data.delivery_email_verified_at),
    delivery_email_mode: data.delivery_email_mode ?? null,
    has_delivery_email: Boolean(data.recipient_email),
    letter_body_in_response: false,
  };
}

export async function createDeliveryEmailChange(
  env: Env,
  letterId: string,
  newEmail: string,
  rawToken: string,
  previousActiveEmail: string | null,
): Promise<{ id: string; expires_at: string }> {
  const tokenHash = await hashToken(pepper(env), rawToken);
  const expires_at = expiresAtFromNow(DELIVERY_EMAIL_VERIFY_TTL_MS);

  await client(env)
    .from("letter_vault_delivery_email_changes")
    .update({ status: "cancelled" })
    .eq("letter_id", letterId)
    .eq("status", "pending");

  const { data, error } = await client(env)
    .from("letter_vault_delivery_email_changes")
    .insert({
      letter_id: letterId,
      new_email: newEmail,
      token_hash: tokenHash,
      status: "pending",
      expires_at,
      previous_active_email: previousActiveEmail,
    })
    .select("id, expires_at")
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function verifyDeliveryEmailChange(
  env: Env,
  rawToken: string,
): Promise<{ letter_id: string; new_email: string } | null> {
  const tokenHash = await hashToken(pepper(env), rawToken);
  const { data: change, error } = await client(env)
    .from("letter_vault_delivery_email_changes")
    .select("id, letter_id, new_email, status, expires_at")
    .eq("token_hash", tokenHash)
    .eq("status", "pending")
    .maybeSingle();

  if (error || !change || isExpired(change.expires_at)) {
    if (change?.id) {
      await client(env)
        .from("letter_vault_delivery_email_changes")
        .update({ status: "expired" })
        .eq("id", change.id);
    }
    return null;
  }

  const { data: activated, error: actErr } = await client(env)
    .from("letter_vault_delivery_email_changes")
    .update({
      status: "verified",
      verified_at: new Date().toISOString(),
    })
    .eq("id", change.id)
    .eq("status", "pending")
    .select("letter_id, new_email")
    .maybeSingle();

  if (actErr || !activated) return null;

  const now = new Date().toISOString();
  await client(env)
    .from("letter_vault_letters")
    .update({
      recipient_email: activated.new_email,
      delivery_email_mode: "verified",
      delivery_email_verified_at: now,
      status: "SEALED",
      updated_at: now,
    })
    .eq("id", activated.letter_id);

  await auditDeliveryEmail(env, activated.letter_id, "delivery_email_activated", activated.new_email);
  return activated;
}

export async function activateSurpriseDeliveryEmail(
  env: Env,
  letterId: string,
  newEmail: string,
): Promise<void> {
  const now = new Date().toISOString();
  await client(env)
    .from("letter_vault_letters")
    .update({
      recipient_email: newEmail,
      delivery_email_mode: "surprise",
      delivery_email_verified_at: null,
      status: "SEALED",
      updated_at: now,
    })
    .eq("id", letterId);

  await auditDeliveryEmail(env, letterId, "delivery_email_surprise_set", newEmail);
}

export async function auditDeliveryEmail(
  env: Env,
  letterId: string,
  action: string,
  email: string,
): Promise<void> {
  await client(env).from("letter_vault_delivery_email_audit").insert({
    letter_id: letterId,
    action,
    email_masked: maskEmail(email),
  });
}

export async function fetchDeliveryEmailAudit(
  env: Env,
  letterId: string,
): Promise<unknown[]> {
  const { data, error } = await client(env)
    .from("letter_vault_delivery_email_audit")
    .select("id, action, email_masked, created_at")
    .eq("letter_id", letterId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function markAwaitingDeliveryEmail(
  env: Env,
  letterId: string,
): Promise<void> {
  await client(env)
    .from("letter_vault_letters")
    .update({
      status: "AWAITING_DELIVERY_EMAIL",
      updated_at: new Date().toISOString(),
    })
    .eq("id", letterId)
    .in("status", ["SEALED", "RETRY_REQUIRED"]);
}

export { maskEmail };
