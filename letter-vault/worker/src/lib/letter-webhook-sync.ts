import { fetchLetterById } from "../db/letters";
import type { LetterStatus } from "../delivery/status";
import { shouldAdvanceLetterStatus } from "../delivery/status";
import type { EmailStatus } from "../email/status";
import type { Env } from "../env";
import { createClient } from "@supabase/supabase-js";

function client(env: Env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("supabase_not_configured");
  }
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Map outbound email webhook status → letter lifecycle (future_delivery only). */
export function mapEmailStatusToLetterStatus(
  emailStatus: EmailStatus,
  eventType: string,
): LetterStatus | null {
  switch (emailStatus) {
    case "sent":
      return "SENT";
    case "delivered":
      return "DELIVERED";
    case "bounced":
      return "BOUNCED";
    case "complained":
    case "blocked":
      return "BLOCKED";
    case "failed":
      if (eventType === "activity.soft_bounced" || eventType === "email.failed") {
        return "RETRY_REQUIRED";
      }
      return "RETRY_REQUIRED";
    default:
      return null;
  }
}

/** Updates letter row only — never deletes ciphertext or the letter record. */
export async function syncLetterStatusFromOutboundWebhook(
  env: Env,
  letterId: string,
  nextLetterStatus: LetterStatus,
  eventType: string,
): Promise<{ updated: boolean }> {
  const letter = await fetchLetterById(env, letterId);
  if (!letter) return { updated: false };

  const current = letter.status as LetterStatus;
  if (!shouldAdvanceLetterStatus(current, nextLetterStatus)) {
    return { updated: false };
  }

  const patch: Record<string, unknown> = {
    status: nextLetterStatus,
    updated_at: new Date().toISOString(),
  };

  if (nextLetterStatus === "DELIVERED") {
    patch.last_error_category = null;
  } else if (
    nextLetterStatus === "BOUNCED" ||
    nextLetterStatus === "BLOCKED" ||
    nextLetterStatus === "RETRY_REQUIRED"
  ) {
    patch.last_error_category = eventType;
    patch.processing_lease_until = null;
    patch.processing_claimed_by = null;
  }

  const { data, error } = await client(env)
    .from("letter_vault_letters")
    .update(patch)
    .eq("id", letterId)
    .eq("status", current)
    .select("id")
    .maybeSingle();

  if (error) throw new Error(error.message);
  return { updated: Boolean(data) };
}
