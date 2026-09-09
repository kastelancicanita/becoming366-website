import {
  applyWebhookStatus,
  findOutboundByProviderMessageId,
  recordWebhookEvent,
  updateOutboundErrorSummary,
  type OutboundEmailRow,
} from "../db/email-store";
import { upsertRecipientSuppression } from "../db/recipient-suppression";
import type { EmailStatus } from "../email/status";
import type { Env } from "../env";
import {
  mapEmailStatusToLetterStatus,
  syncLetterStatusFromOutboundWebhook,
} from "./letter-webhook-sync";
import type { RecipientSuppressionReason } from "../db/recipient-suppression";

export function suppressionReasonForEvent(
  eventType: string,
): RecipientSuppressionReason | null {
  switch (eventType) {
    case "activity.hard_bounced":
    case "email.bounced":
      return "hard_bounce";
    case "activity.spam_complaint":
    case "email.complained":
      return "spam_complaint";
    case "recipient.on_hold_added":
      return "on_hold";
    default:
      return null;
  }
}

export async function processInboundEmailWebhook(
  env: Env,
  input: {
    providerEventId: string;
    providerMessageId: string | null;
    eventType: string;
    mappedStatus: EmailStatus | null;
    errorSummary?: string | null;
    recipientEmail?: string | null;
  },
): Promise<{
  duplicate: boolean;
  processed: boolean;
  outbound_matched: boolean;
  status_updated: boolean;
  letter_updated: boolean;
}> {
  const outbound = input.providerMessageId
    ? await findOutboundByProviderMessageId(env, input.providerMessageId)
    : null;

  const dedupe = await recordWebhookEvent(env, {
    provider_event_id: input.providerEventId,
    provider_message_id: input.providerMessageId,
    event_type: input.eventType,
    outbound_email_id: outbound?.id ?? null,
    status_applied: input.mappedStatus,
  });

  if (!dedupe.inserted) {
    return {
      duplicate: true,
      processed: true,
      outbound_matched: Boolean(outbound),
      status_updated: false,
      letter_updated: false,
    };
  }

  if (!outbound || !input.mappedStatus) {
    return {
      duplicate: false,
      processed: true,
      outbound_matched: false,
      status_updated: false,
      letter_updated: false,
    };
  }

  const apply = await applyWebhookStatus(
    env,
    outbound.id,
    outbound.status,
    input.mappedStatus,
    input.eventType,
  );

  if (input.errorSummary) {
    await updateOutboundErrorSummary(env, outbound.id, input.errorSummary);
  }

  const suppressReason =
    suppressionReasonForEvent(input.eventType) ??
    (input.mappedStatus === "bounced"
      ? "hard_bounce"
      : input.mappedStatus === "complained"
        ? "spam_complaint"
        : null);

  const recipientEmail =
    input.recipientEmail?.trim().toLowerCase() ??
    outbound.recipient_email?.trim().toLowerCase() ??
    null;

  if (suppressReason && recipientEmail) {
    await upsertRecipientSuppression(env, {
      recipientEmail,
      reason: suppressReason,
      provider: outbound.provider,
      sourceEventType: input.eventType,
      sourceProviderMessageId: input.providerMessageId,
    });
  }

  let letterUpdated = false;
  if (outbound.email_type === "future_delivery" && outbound.letter_ref) {
    const nextLetterStatus = mapEmailStatusToLetterStatus(
      input.mappedStatus,
      input.eventType,
    );
    if (nextLetterStatus) {
      const letterSync = await syncLetterStatusFromOutboundWebhook(
        env,
        outbound.letter_ref,
        nextLetterStatus,
        input.eventType,
      );
      letterUpdated = letterSync.updated;
    }
  }

  return {
    duplicate: false,
    processed: true,
    outbound_matched: true,
    status_updated: apply.updated,
    letter_updated: letterUpdated,
  };
}

export function outboundRecipientEmail(outbound: OutboundEmailRow): string {
  return outbound.recipient_email;
}
