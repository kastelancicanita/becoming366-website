import { createClient } from "@supabase/supabase-js";
import type { Env } from "../env";
import { getVaultEnvironment } from "../env";

export type SurpriseSchemaStatus = {
  ready: boolean;
  delivery_email_mode_column: boolean;
  surprise_declarations_table: boolean;
  schema_version: string | null;
  migration_hint: string | null;
};

function client(env: Env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("supabase_not_configured");
  }
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Staging/ops: verify Surprise delivery DB prerequisites (migrations 009 + 010). */
export async function checkSurpriseDeliverySchema(
  env: Env,
): Promise<SurpriseSchemaStatus> {
  const sb = client(env);

  const { data: meta } = await sb
    .from("letter_vault_schema_meta")
    .select("schema_version")
    .eq("singleton", true)
    .maybeSingle();

  const schemaVersion = meta?.schema_version ?? null;

  const { error: modeProbeError } = await sb
    .from("letter_vault_letters")
    .select("delivery_email_mode")
    .limit(1);

  const deliveryEmailModeColumn = !modeProbeError;

  const { error: declarationProbeError } = await sb
    .from("letter_vault_surprise_declarations")
    .select("id")
    .limit(1);

  const surpriseDeclarationsTable = !declarationProbeError;

  const ready = deliveryEmailModeColumn && surpriseDeclarationsTable;

  return {
    ready,
    delivery_email_mode_column: deliveryEmailModeColumn,
    surprise_declarations_table: surpriseDeclarationsTable,
    schema_version: schemaVersion,
    migration_hint: ready
      ? null
      : "Run letter-vault/migrations/009_phase7_delivery_email_mode.sql and 010_phase8b_surprise_declaration.sql in Supabase SQL Editor.",
  };
}

export async function forceSurpriseDeliveryForLetter(
  env: Env,
  letterId: string,
  deliveryEmail: string,
): Promise<{ ok: true }> {
  const schema = await checkSurpriseDeliverySchema(env);
  if (!schema.ready) {
    throw new Error(schema.migration_hint ?? "surprise_schema_not_ready");
  }

  const { recordSurpriseDeclaration } = await import("../db/surprise-declaration");
  const { activateSurpriseDeliveryEmail, auditDeliveryEmail } = await import(
    "../db/management"
  );

  await activateSurpriseDeliveryEmail(env, letterId, deliveryEmail);
  await recordSurpriseDeclaration(env, letterId);
  await auditDeliveryEmail(
    env,
    letterId,
    "surprise_declaration_accepted",
    deliveryEmail,
  );

  return { ok: true };
}
