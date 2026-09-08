import { createClient } from "@supabase/supabase-js";
import type { Env } from "../env";

export type EntitlementStatus = "active" | "revoked" | "refunded";

export interface EntitlementRow {
  id: string;
  source: string;
  external_order_ref: string;
  access_code_hash: string;
  purchaser_email: string;
  status: EntitlementStatus;
  letters_allowed: number;
  letters_used: number;
  created_at: string;
  updated_at: string;
}

export interface ConsumeResult {
  consumed: boolean;
  entitlement_id: string | null;
  letters_used: number | null;
  letters_allowed: number | null;
  failure_reason: string | null;
}

function client(env: Env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("supabase_not_configured");
  }
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function insertEntitlement(
  env: Env,
  row: {
    source: string;
    external_order_ref: string;
    access_code_hash: string;
    purchaser_email: string;
    status: EntitlementStatus;
    letters_allowed: number;
  },
): Promise<EntitlementRow> {
  const supabase = client(env);
  const { data, error } = await supabase
    .from("letter_vault_entitlements")
    .insert({
      source: row.source,
      external_order_ref: row.external_order_ref,
      access_code_hash: row.access_code_hash,
      purchaser_email: row.purchaser_email,
      status: row.status,
      letters_allowed: row.letters_allowed,
      letters_used: 0,
    })
    .select(
      "id, source, external_order_ref, access_code_hash, purchaser_email, status, letters_allowed, letters_used, created_at, updated_at",
    )
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "entitlement_insert_failed");
  }

  return data as EntitlementRow;
}

export async function findEntitlementByCredentials(
  env: Env,
  purchaserEmail: string,
  accessCodeHash: string,
): Promise<EntitlementRow | null> {
  const supabase = client(env);
  const { data, error } = await supabase
    .from("letter_vault_entitlements")
    .select(
      "id, source, external_order_ref, access_code_hash, purchaser_email, status, letters_allowed, letters_used, created_at, updated_at",
    )
    .eq("purchaser_email", purchaserEmail)
    .eq("access_code_hash", accessCodeHash)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as EntitlementRow | null) ?? null;
}

export async function consumeEntitlement(
  env: Env,
  purchaserEmail: string,
  accessCodeHash: string,
): Promise<ConsumeResult> {
  const row = await findEntitlementByCredentials(
    env,
    purchaserEmail,
    accessCodeHash,
  );

  if (!row) {
    return {
      consumed: false,
      entitlement_id: null,
      letters_used: null,
      letters_allowed: null,
      failure_reason: "not_found",
    };
  }

  if (row.status !== "active") {
    return {
      consumed: false,
      entitlement_id: row.id,
      letters_used: row.letters_used,
      letters_allowed: row.letters_allowed,
      failure_reason: "inactive",
    };
  }

  if (row.letters_used >= row.letters_allowed) {
    return {
      consumed: false,
      entitlement_id: row.id,
      letters_used: row.letters_used,
      letters_allowed: row.letters_allowed,
      failure_reason: "exhausted",
    };
  }

  const supabase = client(env);
  const { data, error } = await supabase
    .from("letter_vault_entitlements")
    .update({
      letters_used: row.letters_used + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .eq("status", "active")
    .eq("letters_used", row.letters_used)
    .select("id, letters_used, letters_allowed")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return {
      consumed: false,
      entitlement_id: row.id,
      letters_used: null,
      letters_allowed: null,
      failure_reason: "race_lost",
    };
  }

  return {
    consumed: true,
    entitlement_id: data.id,
    letters_used: data.letters_used,
    letters_allowed: data.letters_allowed,
    failure_reason: null,
  };
}

/** Staging test helper — fetch row by id without exposing hash in API. */
export async function fetchEntitlementById(
  env: Env,
  id: string,
): Promise<Pick<
  EntitlementRow,
  "id" | "status" | "letters_allowed" | "letters_used" | "purchaser_email"
> | null> {
  const supabase = client(env);
  const { data, error } = await supabase
    .from("letter_vault_entitlements")
    .select("id, status, letters_allowed, letters_used, purchaser_email")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}
