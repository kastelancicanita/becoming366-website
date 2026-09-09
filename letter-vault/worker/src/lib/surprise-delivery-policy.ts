import type { Env } from "../env";
import { getVaultEnvironment } from "../env";

/** Scheduler / letter row marker when Surprise delivery awaits a compliant provider. */
export const SURPRISE_PROVIDER_PENDING_CATEGORY =
  "surprise_provider_pending" as const;

export type DeliveryEmailMode = "surprise" | "verified" | "verify_now";

/** Registered recipient-body delivery backends (S2 routes Surprise → mailersend). */
export type DeliveryProviderId = "resend" | "mailersend";

export type RecipientBodyDeliveryBlockReason =
  | "surprise_resend_blocked_production"
  | "recipient_not_ready";

export type RecipientBodyDeliveryDecision =
  | { allowed: true; providerId: DeliveryProviderId }
  | { allowed: false; reason: RecipientBodyDeliveryBlockReason };

/** Customer API: Surprise choice on delivery-email screens (production blocked until S5). */
export function isSurpriseDeliveryEmailChoiceAllowed(env: Env): boolean {
  return getVaultEnvironment(env) !== "production";
}

export function surpriseDeliveryUnavailableMessage(): string {
  return "Keep It a Surprise is not available yet. Please verify the delivery address now so we can deliver your letter when the day arrives.";
}

export function isSurpriseMode(letter: {
  delivery_email_mode?: string | null;
}): boolean {
  return letter.delivery_email_mode === "surprise";
}

/**
 * Whether the worker may send the letter body to the recipient on delivery day.
 * S2: staging/dev Surprise routes to MailerSend; production Surprise stays blocked until S5.
 */
export function evaluateRecipientBodyDelivery(
  env: Env,
  letter: {
    recipient_email: string | null;
    delivery_email_verified_at: string | null;
    delivery_email_mode?: string | null;
  },
): RecipientBodyDeliveryDecision {
  if (!letter.recipient_email) {
    return { allowed: false, reason: "recipient_not_ready" };
  }

  if (isSurpriseMode(letter)) {
    if (getVaultEnvironment(env) === "production") {
      return { allowed: false, reason: "surprise_resend_blocked_production" };
    }
    return { allowed: true, providerId: "mailersend" };
  }

  if (!letter.delivery_email_verified_at) {
    return { allowed: false, reason: "recipient_not_ready" };
  }

  return { allowed: true, providerId: "resend" };
}

/** Purchaser / operational mail (seal confirmation, verify-now, magic links). */
export function mayUseResendForOperationalMail(_env: Env): boolean {
  return true;
}

/** API hint when Surprise is saved or delivery mode is shown in UI. */
export function surpriseRecipientDeliveryStatus(
  env: Env,
  mode: string,
): string {
  if (mode === "surprise" && getVaultEnvironment(env) === "production") {
    return "blocked_pending_compliant_provider";
  }
  if (mode === "surprise") return "surprise_mode";
  if (mode === "verify_now") return "verify_required";
  return "verified_mode";
}
