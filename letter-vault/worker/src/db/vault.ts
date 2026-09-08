import { createClient } from "@supabase/supabase-js";
import type { Env } from "../env";
import {
  expiresAtFromNow,
  generateSecureToken,
  hashToken,
  isExpired,
  maskEmail,
} from "../crypto/management-token";

export const VAULT_SESSION_TTL_MS = 2 * 60 * 60 * 1000;

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
  if (!p) throw new Error("vault_pepper_not_configured");
  return p;
}

export interface EntitlementProductRow {
  id: string;
  purchaser_email: string;
  status: string;
  letters_allowed: number;
  letters_used: number;
  product_type: string;
  collection_mechanism: string | null;
  display_title: string | null;
  template_key: string | null;
  template_config: Record<string, unknown> | null;
}

export interface CollectionRow {
  id: string;
  entitlement_id: string;
  display_title: string;
  collection_mechanism: string;
  shared_recipient_context: Record<string, unknown> | null;
  base_date: string | null;
  slot_count: number;
  initialized_at: string | null;
}

export interface SlotRow {
  id: string;
  entitlement_id: string;
  collection_id: string | null;
  slot_index: number;
  moment_label: string | null;
  recipient_context: Record<string, unknown> | null;
  delivery_at: string | null;
  delivery_timezone: string;
  slot_status: string;
  letter_id: string | null;
  public_letter_id?: string | null;
}

export async function findEntitlementByCredentialsExtended(
  env: Env,
  purchaserEmail: string,
  accessCodeHash: string,
): Promise<EntitlementProductRow | null> {
  const { data, error } = await client(env)
    .from("letter_vault_entitlements")
    .select(
      "id, purchaser_email, status, letters_allowed, letters_used, product_type, collection_mechanism, display_title, template_key, template_config",
    )
    .eq("purchaser_email", purchaserEmail)
    .eq("access_code_hash", accessCodeHash)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data as EntitlementProductRow | null;
}

export async function createVaultSession(
  env: Env,
  entitlementId: string,
): Promise<{ session_token: string; expires_at: string }> {
  const raw = generateSecureToken();
  const sessionHash = await hashToken(pepper(env), raw);
  const expires_at = expiresAtFromNow(VAULT_SESSION_TTL_MS);

  const { error } = await client(env)
    .from("letter_vault_vault_sessions")
    .insert({ entitlement_id: entitlementId, session_hash: sessionHash, expires_at });

  if (error) throw new Error(error.message);
  return { session_token: raw, expires_at };
}

export async function validateVaultSession(
  env: Env,
  rawSession: string,
): Promise<{ entitlement_id: string } | null> {
  const sessionHash = await hashToken(pepper(env), rawSession);
  const { data, error } = await client(env)
    .from("letter_vault_vault_sessions")
    .select("entitlement_id, expires_at")
    .eq("session_hash", sessionHash)
    .maybeSingle();

  if (error || !data || isExpired(data.expires_at)) return null;
  return { entitlement_id: data.entitlement_id };
}

export async function fetchEntitlementProduct(
  env: Env,
  id: string,
): Promise<EntitlementProductRow | null> {
  const { data, error } = await client(env)
    .from("letter_vault_entitlements")
    .select(
      "id, purchaser_email, status, letters_allowed, letters_used, product_type, collection_mechanism, display_title, template_key, template_config",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data as EntitlementProductRow | null;
}

export async function fetchCollectionByEntitlement(
  env: Env,
  entitlementId: string,
): Promise<CollectionRow | null> {
  const { data, error } = await client(env)
    .from("letter_vault_collections")
    .select("*")
    .eq("entitlement_id", entitlementId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data as CollectionRow | null;
}

export async function insertCollection(
  env: Env,
  row: {
    entitlement_id: string;
    display_title: string;
    collection_mechanism: string;
    shared_recipient_context?: Record<string, unknown> | null;
    base_date?: string | null;
    slot_count: number;
  },
): Promise<CollectionRow> {
  const { data, error } = await client(env)
    .from("letter_vault_collections")
    .insert({
      ...row,
      initialized_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data as CollectionRow;
}

export async function insertSlots(
  env: Env,
  slots: Array<{
    entitlement_id: string;
    collection_id?: string | null;
    slot_index: number;
    moment_label: string;
    delivery_at?: string | null;
    recipient_context?: Record<string, unknown> | null;
  }>,
): Promise<SlotRow[]> {
  const { data, error } = await client(env)
    .from("letter_vault_letter_slots")
    .insert(
      slots.map((s) => ({
        entitlement_id: s.entitlement_id,
        collection_id: s.collection_id ?? null,
        slot_index: s.slot_index,
        moment_label: s.moment_label,
        delivery_at: s.delivery_at,
        recipient_context: s.recipient_context ?? null,
        slot_status: "UNWRITTEN",
      })),
    )
    .select("*");

  if (error) throw new Error(error.message);
  return (data as SlotRow[]) ?? [];
}

export async function fetchSlotsForEntitlement(
  env: Env,
  entitlementId: string,
): Promise<SlotRow[]> {
  const { data, error } = await client(env)
    .from("letter_vault_letter_slots")
    .select(
      "id, entitlement_id, collection_id, slot_index, moment_label, recipient_context, delivery_at, delivery_timezone, slot_status, letter_id",
    )
    .eq("entitlement_id", entitlementId)
    .order("slot_index", { ascending: true });

  if (error) throw new Error(error.message);

  const slots = (data as SlotRow[]) ?? [];
  if (slots.length === 0) return slots;

  type LetterMeta = {
    id: string;
    slot_id: string | null;
    public_letter_id: string;
    recipient_email: string | null;
    delivery_email_verified_at: string | null;
    delivery_email_mode: string | null;
  };

  const letterFields =
    "id, slot_id, public_letter_id, recipient_email, delivery_email_verified_at, delivery_email_mode";

  const letterIds = slots
    .map((s) => s.letter_id)
    .filter((id): id is string => Boolean(id));

  const orphanSlotIds = slots
    .filter((s) => s.slot_status === "SEALED" && !s.letter_id)
    .map((s) => s.id);

  if (letterIds.length === 0 && orphanSlotIds.length === 0) return slots;

  const letters: LetterMeta[] = [];

  if (letterIds.length > 0) {
    const { data, error: letterErr } = await client(env)
      .from("letter_vault_letters")
      .select(letterFields)
      .in("id", letterIds);
    if (letterErr) throw new Error(letterErr.message);
    letters.push(...((data as LetterMeta[]) ?? []));
  }

  if (orphanSlotIds.length > 0) {
    const { data, error: slotErr } = await client(env)
      .from("letter_vault_letters")
      .select(letterFields)
      .in("slot_id", orphanSlotIds);
    if (slotErr) throw new Error(slotErr.message);
    for (const row of (data as LetterMeta[]) ?? []) {
      if (!letters.some((l) => l.id === row.id)) letters.push(row);
    }
  }

  const letterById = new Map(letters.map((l) => [l.id, l]));
  const letterBySlotId = new Map(
    letters
      .filter((l): l is LetterMeta & { slot_id: string } => Boolean(l.slot_id))
      .map((l) => [l.slot_id, l]),
  );

  return slots.map((s) => {
    const letter =
      (s.letter_id ? letterById.get(s.letter_id) : null) ??
      letterBySlotId.get(s.id) ??
      null;
    return {
      ...s,
      public_letter_id: s.letter_id ? letter?.public_letter_id ?? null : null,
      delivery_email_masked: letter?.recipient_email
        ? maskEmail(letter.recipient_email)
        : null,
      has_delivery_email: Boolean(letter?.recipient_email),
      delivery_email_mode: letter?.delivery_email_mode ?? null,
      delivery_email_pending_verification:
        Boolean(letter?.recipient_email) &&
        letter?.delivery_email_mode === "verified" &&
        !letter?.delivery_email_verified_at,
    };
  });
}

export async function fetchSlotById(
  env: Env,
  slotId: string,
  entitlementId: string,
): Promise<SlotRow | null> {
  const { data, error } = await client(env)
    .from("letter_vault_letter_slots")
    .select("*")
    .eq("id", slotId)
    .eq("entitlement_id", entitlementId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data as SlotRow | null;
}

export async function updateSlotDraftMetadata(
  env: Env,
  slotId: string,
  update: {
    moment_label?: string;
    delivery_at?: string;
    recipient_context?: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await client(env)
    .from("letter_vault_letter_slots")
    .update({ ...update, updated_at: new Date().toISOString() })
    .eq("id", slotId)
    .eq("slot_status", "UNWRITTEN");

  if (error) throw new Error(error.message);
}

export async function sealSlotAtomic(
  env: Env,
  params: {
    slot_id: string;
    entitlement_id: string;
    purchaser_email: string;
    label: string;
    delivery_at: string;
    delivery_timezone: string;
    recipient_context: Record<string, unknown> | null;
    moment_label: string | null;
    envelope: {
      ciphertext_b64: string;
      ciphertext_nonce_b64: string;
      wrapped_dek_b64: string;
      wrap_nonce_b64: string;
      master_key_version: string;
      content_hash: string;
    };
    recipient_email?: string | null;
  },
): Promise<{
  letter_id: string;
  public_letter_id: string;
  letters_used: number;
  letters_allowed: number;
}> {
  const { data, error } = await client(env).rpc("letter_vault_seal_slot_atomic", {
    p_slot_id: params.slot_id,
    p_entitlement_id: params.entitlement_id,
    p_purchaser_email: params.purchaser_email,
    p_label: params.label,
    p_delivery_at: params.delivery_at,
    p_delivery_timezone: params.delivery_timezone,
    p_recipient_context: params.recipient_context,
    p_moment_label: params.moment_label,
    p_ciphertext_b64: params.envelope.ciphertext_b64,
    p_ciphertext_nonce_b64: params.envelope.ciphertext_nonce_b64,
    p_wrapped_dek_b64: params.envelope.wrapped_dek_b64,
    p_wrap_nonce_b64: params.envelope.wrap_nonce_b64,
    p_master_key_version: params.envelope.master_key_version,
    p_content_hash: params.envelope.content_hash,
    p_recipient_email: params.recipient_email ?? null,
  });

  if (error) throw new Error(error.message);

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("seal_atomic_failed");

  return {
    letter_id: row.letter_id,
    public_letter_id: row.public_letter_id,
    letters_used: row.letters_used,
    letters_allowed: row.letters_allowed,
  };
}

export async function countSlotsForEntitlement(
  env: Env,
  entitlementId: string,
): Promise<number> {
  const { count, error } = await client(env)
    .from("letter_vault_letter_slots")
    .select("id", { count: "exact", head: true })
    .eq("entitlement_id", entitlementId);

  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function insertEntitlementExtended(
  env: Env,
  row: {
    source: string;
    external_order_ref: string;
    access_code_hash: string;
    purchaser_email: string;
    status: string;
    letters_allowed: number;
    product_type: string;
    collection_mechanism?: string | null;
    display_title?: string | null;
    template_key?: string | null;
    template_config?: Record<string, unknown> | null;
  },
): Promise<EntitlementProductRow> {
  const { data, error } = await client(env)
    .from("letter_vault_entitlements")
    .insert({
      ...row,
      letters_used: 0,
      collection_mechanism:
        row.product_type === "COLLECTION" ? row.collection_mechanism : "SINGLE",
    })
    .select(
      "id, purchaser_email, status, letters_allowed, letters_used, product_type, collection_mechanism, display_title, template_key, template_config",
    )
    .single();

  if (error) throw new Error(error.message);
  return data as EntitlementProductRow;
}
