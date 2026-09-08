import {
  applyWebhookStatus,
  findOutboundByProviderMessageId,
  recordWebhookEvent,
  updateOutboundErrorSummary,
} from "../db/email-store";
import { mapResendEventType } from "../email/status";
import {
  extractSvixHeaders,
  parseResendWebhookPayload,
  verifySvixWebhook,
} from "../email/webhook-verify";
import type { Env } from "../env";
import { jsonResponse } from "../lib/access-response";

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

    const outbound = providerMessageId
      ? await findOutboundByProviderMessageId(env, providerMessageId)
      : null;

    const dedupe = await recordWebhookEvent(env, {
      provider_event_id: providerEventId,
      provider_message_id: providerMessageId,
      event_type: eventType,
      outbound_email_id: outbound?.id ?? null,
      status_applied: mappedStatus,
    });

    if (!dedupe.inserted) {
      return jsonResponse({ status: "ok", duplicate: true });
    }

    if (!outbound || !mappedStatus) {
      return jsonResponse({ status: "ok", processed: true, outbound_matched: false });
    }

    const apply = await applyWebhookStatus(
      env,
      outbound.id,
      outbound.status,
      mappedStatus,
      eventType,
    );

    if (eventType === "email.bounced" || eventType === "email.failed") {
      const bounceMsg = payload.data?.bounce?.message ?? eventType;
      await updateOutboundErrorSummary(env, outbound.id, bounceMsg);
    }

    return jsonResponse({
      status: "ok",
      processed: true,
      outbound_matched: true,
      status_updated: apply.updated,
      duplicate: false,
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
  const outbound = await findOutboundByProviderMessageId(env, providerMessageId);

  const dedupe = await recordWebhookEvent(env, {
    provider_event_id: providerEventId,
    provider_message_id: providerMessageId,
    event_type: eventType,
    outbound_email_id: outbound?.id ?? null,
    status_applied: mappedStatus,
  });

  if (!dedupe.inserted) {
    return jsonResponse({ status: "ok", duplicate: true });
  }

  if (!outbound || !mappedStatus) {
    return jsonResponse({ status: "ok", processed: true, outbound_matched: false });
  }

  const apply = await applyWebhookStatus(
    env,
    outbound.id,
    outbound.status,
    mappedStatus,
    eventType,
  );

  return jsonResponse({
    status: "ok",
    processed: true,
    status_updated: apply.updated,
    email_status: mappedStatus,
  });
}
