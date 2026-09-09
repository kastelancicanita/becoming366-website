import type { Env } from "../env";
import { getVaultEnvironment } from "../env";

/** Scheduler / letter row marker when Surprise delivery awaits a compliant provider. */
export const SURPRISE_PROVIDER_PENDING_CATEGORY =
  "surprise_provider_pending" as const;

export type DeliveryEmailMode = "surprise" | "verified" | "verify_now";

export function isSurpriseDeliveryEmailChoiceAllowed(env: Env): boolean {
  return getVaultEnvironment(env) !== "production";
}

export function surpriseRecipientDeliveryStatus(
  env: Env,
  mode: string,
): string {
  if (mode === "surprise" && getVaultEnvironment(env) === "production") {
    return "blocked_pending_compliant_provider";
  }
  if (mode === "surprise") return "surprise_mode";
  return "verified_mode";
}

export function surpriseDeliveryUnavailableMessage(): string {
  return "Keep It a Surprise is not available yet. Please verify the delivery address now so we can deliver your letter when the day arrives.";
}
