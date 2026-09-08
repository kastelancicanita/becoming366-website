import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../env";

export type DatabaseStatus =
  | { state: "not_configured" }
  | { state: "connected"; schema_version: string }
  | { state: "error"; message: string };

/**
 * Phase 1: read schema_version from letter_vault_schema_meta only.
 * No letter data. Service role used server-side only.
 */
export async function checkDatabaseConnectivity(
  env: Env,
): Promise<DatabaseStatus> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return { state: "not_configured" };
  }

  let client: SupabaseClient;
  try {
    client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  } catch {
    return { state: "error", message: "invalid_supabase_configuration" };
  }

  const { data, error } = await client
    .from("letter_vault_schema_meta")
    .select("schema_version")
    .eq("singleton", true)
    .maybeSingle();

  if (error) {
    return { state: "error", message: "database_query_failed" };
  }

  if (!data?.schema_version) {
    return {
      state: "error",
      message: "schema_meta_missing_run_migration_001",
    };
  }

  return { state: "connected", schema_version: data.schema_version };
}
