import { mapResendEventType, mapMailerSendEventType } from "../email/status";
import {
  extractSvixHeaders,
  parseResendWebhookPayload,
  verifySvixWebhook,
} from "../email/webhook-verify";
import {
  extractMailerSendSignature,
  mailerSendProviderEventId,
  mailerSendProviderMessageId,
  MAILERSEND_WEBHOOK_TEST_SECRET,
  parseMailerSendWebhookPayload,
  verifyMailerSendWebhookSignature,
} from "../email/mailersend-webhook-verify";
import type { Env } from "../env";
import { jsonResponse } from "../lib/access-response";
import { processInboundEmailWebhook } from "../lib/inbound-webhook";

export async function handleResendWebhook(
  request: Request,
  env: Env,
): Promise<Response> {
  const secret = env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    return jsonResponse({ error: "webhook_not_configured" }, 503);
  }

  const rawBody = await request.text();
  const headers = extractSvixHeaders(request);

  const valid = await verifySvixWebhook(secret, rawBody, headers);
  if (!valid) {
    return jsonResponse({ error: "invalid_signature" }, 401);
  }

  let payload;
  try {
    payload = parseResendWebhookPayload(rawBody);
  } catch {
    return jsonResponse({ error: "invalid_payload" }, 400);
  }

  try {
    const providerEventId = headers.id!;
    const providerMessageId = payload.data?.email_id ?? null;
    const eventType = payload.type ?? "unknown";
    const mappedStatus = mapResendEventType(eventType);

    const bounceMsg =
      eventType === "email.bounced" || eventType === "email.failed"
        ? payload.data?.bounce?.message ?? eventType
        : null;

    const result = await processInboundEmailWebhook(env, {
      providerEventId,
      providerMessageId,
      eventType,
      mappedStatus,
      errorSummary: bounceMsg,
      recipientEmail: payload.data?.to?.[0] ?? null,
    });

    return jsonResponse({
      status: "ok",
      processed: result.processed,
      outbound_matched: result.outbound_matched,
      status_updated: result.status_updated,
      letter_updated: result.letter_updated,
      duplicate: result.duplicate,
    });
  } catch {
    return jsonResponse({ error: "webhook_processing_failed" }, 500);
  }
}

export async function handleMailerSendWebhook(
  request: Request,
  env: Env,
): Promise<Response> {
  const rawBody = await request.text();
  const signature = extractMailerSendSignature(request);

  let payload;
  try {
    payload = parseMailerSendWebhookPayload(rawBody);
  } catch {
    return jsonResponse({ error: "invalid_payload" }, 400);
  }

  const isTestPing = payload.type === "webhook.test";
  const signingSecret = isTestPing
    ? MAILERSEND_WEBHOOK_TEST_SECRET
    : env.MAILERSEND_WEBHOOK_SECRET?.trim();

  if (!signingSecret) {
    return jsonResponse({ error: "webhook_not_configured" }, 503);
  }

  const valid = await verifyMailerSendWebhookSignature(
    rawBody,
    signature,
    signingSecret,
  );
  if (!valid) {
    return jsonResponse({ error: "invalid_signature" }, 401);
  }

  if (isTestPing) {
    return jsonResponse({ status: "ok", test_ping: true });
  }

  try {
    const providerEventId = mailerSendProviderEventId(payload);
    if (!providerEventId) {
      return jsonResponse({ error: "invalid_payload" }, 400);
    }

    const providerMessageId = mailerSendProviderMessageId(payload);
    const eventType = payload.type ?? "unknown";
    const mappedStatus = mapMailerSendEventType(eventType);

    const result = await processInboundEmailWebhook(env, {
      providerEventId,
      providerMessageId,
      eventType,
      mappedStatus,
      errorSummary:
        eventType === "activity.hard_bounced" ||
        eventType === "activity.soft_bounced"
          ? eventType
          : null,
      recipientEmail: payload.data?.email ?? null,
    });

    return jsonResponse({
      status: "ok",
      processed: result.processed,
      outbound_matched: result.outbound_matched,
      status_updated: result.status_updated,
      letter_updated: result.letter_updated,
      duplicate: result.duplicate,
    });
  } catch {
    return jsonResponse({ error: "webhook_processing_failed" }, 500);
  }
}

/**
 * Staging-only: simulate webhook processing without Resend delivery.
 * Tests dedupe and out-of-order handling with dummy event IDs.
 */
export async function handleStagingWebhookSimulate(
  request: Request,
  env: Env,
): Promise<Response> {
  const token = env.LETTER_VAULT_STAGING_ADMIN_TOKEN;
  if (!token || request.headers.get("X-Letter-Vault-Staging-Admin") !== token) {
    return jsonResponse({ error: "forbidden" }, 403);
  }

  if (env.VAULT_ENV?.toLowerCase() !== "staging") {
    return jsonResponse({ error: "forbidden" }, 403);
  }

  let body: {
    provider_event_id?: string;
    provider_message_id?: string;
    event_type?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const providerEventId = body.provider_event_id?.trim() ?? "";
  const providerMessageId = body.provider_message_id?.trim() ?? "";
  const eventType = body.event_type?.trim() ?? "";

  if (!providerEventId.startsWith("DUMMY-") || !providerMessageId || !eventType) {
    return jsonResponse({ error: "validation_failed" }, 400);
  }

  const mappedStatus = mapResendEventType(eventType);

  const result = await processInboundEmailWebhook(env, {
    providerEventId,
    providerMessageId,
    eventType,
    mappedStatus,
  });

  return jsonResponse({
    status: "ok",
    processed: result.processed,
    status_updated: result.status_updated,
    letter_updated: result.letter_updated,
    email_status: mappedStatus,
    duplicate: result.duplicate,
  });
}
