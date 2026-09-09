import { createClient } from "@supabase/supabase-js";
import type { Env } from "../env";

export type RecipientSuppressionReason =
  | "hard_bounce"
  | "spam_complaint"
  | "on_hold";

function client(env: Env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("supabase_not_configured");
  }
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function isRecipientSuppressed(
  env: Env,
  recipientEmail: string,
): Promise<boolean> {
  const email = recipientEmail.trim().toLowerCase();
  const { data, error } = await client(env)
    .from("letter_vault_recipient_suppressions")
    .select("id")
    .eq("recipient_email", email)
    .is("resolved_at", null)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return Boolean(data);
}

export async function upsertRecipientSuppression(
  env: Env,
  input: {
    recipientEmail: string;
    reason: RecipientSuppressionReason;
    provider?: string;
    sourceEventType?: string;
    sourceProviderMessageId?: string | null;
  },
): Promise<void> {
  const email = input.recipientEmail.trim().toLowerCase();
  const { error } = await client(env)
    .from("letter_vault_recipient_suppressions")
    .upsert(
      {
        recipient_email: email,
        reason: input.reason,
        provider: input.provider ?? "mailersend",
        source_event_type: input.sourceEventType ?? null,
        source_provider_message_id: input.sourceProviderMessageId ?? null,
        resolved_at: null,
      },
      { onConflict: "recipient_email" },
    );

  if (error) throw new Error(error.message);
}
