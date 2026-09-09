import type { Env } from "../env";
import { getVaultEnvironment } from "../env";
import { isDummyEmailDomain } from "./dummy-guard";
import {
  clientIp,
  hashBucketKey,
  isBucketRateLimited,
  recordAuthAttempt,
} from "./rate-limit";
import {
  isSurprisePersonalDeclarationAccepted,
  SURPRISE_DECLARATION_VERSION,
} from "./surprise-declaration";

/** Scheduler marker when a safeguard defers a due Surprise send (recoverable). */
export const SURPRISE_SEND_DEFERRED_CATEGORY = "surprise_send_deferred" as const;

const SINGLE_EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

const SURPRISE_SAVE_WINDOW_MS = 15 * 60 * 1000;
const SURPRISE_SAVE_MAX_ATTEMPTS = 10;

export type SurpriseRecipientValidationCode =
  | "surprise_recipient_empty"
  | "surprise_recipient_multi"
  | "surprise_recipient_invalid";

export type SurpriseSaveBlockCode =
  | "surprise_declaration_required"
  | SurpriseRecipientValidationCode
  | "surprise_test_domain_blocked"
  | "surprise_save_rate_limited";

export type SurpriseSendSafeguardCode =
  | "surprise_declaration_missing"
  | "surprise_recipient_suppressed"
  | SurpriseRecipientValidationCode
  | "surprise_test_domain_blocked";

/**
 * Surprise delivery addresses are delivery-only and must never sync to MailerLite
 * or any marketing list. No marketing integration reads recipient_email.
 */

/** Exactly one Surprise recipient — no lists, CC/BCC, or bulk patterns. */
export function validateSingleSurpriseRecipient(
  email: string | null | undefined,
): { ok: true; email: string } | { ok: false; code: SurpriseRecipientValidationCode } {
  const normalized = email?.trim().toLowerCase() ?? "";
  if (!normalized) {
    return { ok: false, code: "surprise_recipient_empty" };
  }
  if (
    normalized.includes(",") ||
    normalized.includes(";") ||
    normalized.includes(" ") ||
    normalized.includes("cc:") ||
    normalized.includes("bcc:")
  ) {
    return { ok: false, code: "surprise_recipient_multi" };
  }
  const atCount = (normalized.match(/@/g) ?? []).length;
  if (atCount !== 1 || !SINGLE_EMAIL_RE.test(normalized)) {
    return { ok: false, code: "surprise_recipient_invalid" };
  }
  return { ok: true, email: normalized };
}

/** Production Surprise must not target dummy / test sink domains. */
export function isSurpriseTestRecipientDomainBlocked(
  env: Env,
  email: string,
): boolean {
  if (getVaultEnvironment(env) !== "production") return false;
  return isDummyEmailDomain(email);
}

export async function surpriseSaveRateLimitBucket(
  request: Request,
  letterId: string,
): Promise<string> {
  const ip = clientIp(request);
  return hashBucketKey(`surprise-save:${ip}:${letterId}`);
}

export async function isSurpriseSaveRateLimited(
  env: Env,
  bucketKey: string,
): Promise<boolean> {
  // Staging QA: allow repeated Surprise save attempts during MailerSend verification (S6).
  if (getVaultEnvironment(env) === "staging") {
    return false;
  }
  return isBucketRateLimited(
    env,
    bucketKey,
    SURPRISE_SAVE_MAX_ATTEMPTS,
    SURPRISE_SAVE_WINDOW_MS,
  );
}

export async function recordSurpriseSaveAttempt(
  env: Env,
  bucketKey: string,
): Promise<void> {
  await recordAuthAttempt(env, bucketKey);
}

export function evaluateSurpriseSaveSafeguards(input: {
  env: Env;
  email: string;
  declarationAccepted: boolean | undefined;
}): { ok: true; email: string } | { ok: false; code: SurpriseSaveBlockCode } {
  if (!isSurprisePersonalDeclarationAccepted(input.declarationAccepted)) {
    return { ok: false, code: "surprise_declaration_required" };
  }

  const recipient = validateSingleSurpriseRecipient(input.email);
  if (!recipient.ok) {
    return { ok: false, code: recipient.code };
  }

  if (isSurpriseTestRecipientDomainBlocked(input.env, recipient.email)) {
    return { ok: false, code: "surprise_test_domain_blocked" };
  }

  return { ok: true, email: recipient.email };
}

/** Sync send-time checks (declaration presence verified separately via DB). */
export function evaluateSurpriseSendSafeguards(
  env: Env,
  letter: { recipient_email: string | null },
): { ok: true; email: string } | { ok: false; code: SurpriseSendSafeguardCode } {
  const recipient = validateSingleSurpriseRecipient(letter.recipient_email);
  if (!recipient.ok) {
    return { ok: false, code: recipient.code };
  }

  if (isSurpriseTestRecipientDomainBlocked(env, recipient.email)) {
    return { ok: false, code: "surprise_test_domain_blocked" };
  }

  return { ok: true, email: recipient.email };
}

export function surpriseDeclarationAuditMetadata(): {
  declaration_version: string;
} {
  return { declaration_version: SURPRISE_DECLARATION_VERSION };
}

export type SurpriseSendGateResult =
  | { allowed: true }
  | {
      allowed: false;
      errorCategory: SurpriseSendSafeguardCode | "surprise_declaration_missing";
      auditEmail: string | null;
    };

/** Async send-time gate: sync recipient checks + stored declaration record. */
export async function evaluateSurpriseSendGate(
  env: Env,
  letter: { id: string; recipient_email: string | null; delivery_email_mode?: string | null },
  fetchDeclaration: (
    env: Env,
    letterId: string,
  ) => Promise<{ declaration_version: string; accepted_at: string } | null>,
  checkSuppressed: (
    env: Env,
    recipientEmail: string,
  ) => Promise<boolean> = async () => false,
): Promise<SurpriseSendGateResult> {
  if (letter.delivery_email_mode !== "surprise") {
    return { allowed: true };
  }

  const safeguard = evaluateSurpriseSendSafeguards(env, letter);
  if (!safeguard.ok) {
    return {
      allowed: false,
      errorCategory: safeguard.code,
      auditEmail: letter.recipient_email,
    };
  }

  if (await checkSuppressed(env, safeguard.email)) {
    return {
      allowed: false,
      errorCategory: "surprise_recipient_suppressed",
      auditEmail: safeguard.email,
    };
  }

  const declaration = await fetchDeclaration(env, letter.id);
  if (!declaration) {
    return {
      allowed: false,
      errorCategory: "surprise_declaration_missing",
      auditEmail: safeguard.email,
    };
  }

  return { allowed: true };
}
