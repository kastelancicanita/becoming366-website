import { createClient } from "@supabase/supabase-js";
import type { EncryptedEnvelope } from "../crypto/envelope";
import type { Env } from "../env";

export interface PocRecord extends EncryptedEnvelope {
  id: string;
  label: string;
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

export async function insertPocRecord(
  env: Env,
  label: string,
  envelope: EncryptedEnvelope,
): Promise<PocRecord> {
  const supabase = client(env);
  const { data, error } = await supabase
    .from("letter_vault_crypto_poc")
    .insert({
      label,
      ciphertext_b64: envelope.ciphertext_b64,
      ciphertext_nonce_b64: envelope.ciphertext_nonce_b64,
      wrapped_dek_b64: envelope.wrapped_dek_b64,
      wrap_nonce_b64: envelope.wrap_nonce_b64,
      master_key_version: envelope.master_key_version,
      content_hash: envelope.content_hash,
    })
    .select(
      "id, label, ciphertext_b64, ciphertext_nonce_b64, wrapped_dek_b64, wrap_nonce_b64, master_key_version, content_hash, created_at",
    )
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "poc_insert_failed");
  }

  return data as PocRecord;
}

export async function fetchPocRecord(
  env: Env,
  id: string,
): Promise<PocRecord | null> {
  const supabase = client(env);
  const { data, error } = await supabase
    .from("letter_vault_crypto_poc")
    .select(
      "id, label, ciphertext_b64, ciphertext_nonce_b64, wrapped_dek_b64, wrap_nonce_b64, master_key_version, content_hash, created_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as PocRecord | null) ?? null;
}
