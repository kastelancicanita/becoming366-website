import { createClient } from "@supabase/supabase-js";
import type { Env } from "../env";
import { SURPRISE_DECLARATION_VERSION } from "../lib/surprise-declaration";

export interface SurpriseDeclarationRow {
  id: string;
  letter_id: string;
  declaration_version: string;
  accepted_at: string;
  created_at: string;
}

function client(env: Env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("supabase_not_configured");
  }
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function recordSurpriseDeclaration(
  env: Env,
  letterId: string,
  acceptedAt: string = new Date().toISOString(),
): Promise<void> {
  const { error } = await client(env)
    .from("letter_vault_surprise_declarations")
    .upsert(
      {
        letter_id: letterId,
        declaration_version: SURPRISE_DECLARATION_VERSION,
        accepted_at: acceptedAt,
      },
      { onConflict: "letter_id" },
    );

  if (error) throw new Error(error.message);
}

export async function fetchSurpriseDeclaration(
  env: Env,
  letterId: string,
): Promise<SurpriseDeclarationRow | null> {
  const { data, error } = await client(env)
    .from("letter_vault_surprise_declarations")
    .select("id, letter_id, declaration_version, accepted_at, created_at")
    .eq("letter_id", letterId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as SurpriseDeclarationRow | null) ?? null;
}

/** Preserve letter for retry — never increment attempt_count or destroy content. */
export async function deferSurpriseLetterForSafeguard(
  env: Env,
  letterId: string,
  errorCategory: string,
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await client(env)
    .from("letter_vault_letters")
    .update({
      status: "RETRY_REQUIRED",
      last_error_category: errorCategory,
      updated_at: now,
      processing_lease_until: null,
      processing_claimed_by: null,
    })
    .eq("id", letterId)
    .in("status", ["SEALED", "RETRY_REQUIRED", "PROCESSING"]);

  if (error) throw new Error(error.message);
}
