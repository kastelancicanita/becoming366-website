import {
  fetchOutboundSummary,
  findOutboundByIdempotencyKey,
  insertOutboundQueued,
  markOutboundSendResult,
  markOutboundSending,
} from "../db/email-store";
import { sendViaResend, VAULT_SENDER } from "../email/resend-client";
import {
  buildSealConfirmationHtml,
  buildSealConfirmationSubject,
  buildSealConfirmationText,
  templateContainsPrivateLetterContent,
} from "../email/templates/seal-confirmation";
import type { Env } from "../env";
import { accessDeniedResponse, jsonResponse } from "../lib/access-response";
import { assertDummyPurchaserEmail } from "../lib/dummy-guard";
import { stagingOnlyResponse } from "../lib/staging-guard";

function requireStagingAdmin(request: Request, env: Env): boolean {
  const token = env.LETTER_VAULT_STAGING_ADMIN_TOKEN;
  if (!token) return false;
  return request.headers.get("X-Letter-Vault-Staging-Admin") === token;
}

export interface SendConfirmationBody {
  idempotency_key?: string;
  recipient_email?: string;
  delivery_date?: string;
  letter_ref?: string;
  entitlement_ref?: string;
}

/**
 * Staging-only: send seal confirmation email (dummy data).
 * Idempotent — duplicate idempotency_key will not send twice.
 * Email failure does NOT affect letter/entitlement data.
 */
export async function handleSendSealConfirmation(
  request: Request,
  env: Env,
): Promise<Response> {
  const blocked = stagingOnlyResponse(env);
  if (blocked) return blocked;

  if (!requireStagingAdmin(request, env)) {
    return accessDeniedResponse();
  }

  if (!env.RESEND_API_KEY) {
    return jsonResponse(
      {
        error: "resend_not_configured",
        message: "RESEND_API_KEY secret is not set.",
      },
      503,
    );
  }

  let body: SendConfirmationBody;
  try {
    body = (await request.json()) as SendConfirmationBody;
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const idempotencyKey = body.idempotency_key?.trim() ?? "";
  const recipientEmail = body.recipient_email?.trim().toLowerCase() ?? "";
  const deliveryDate = body.delivery_date?.trim() ?? "";

  if (!idempotencyKey.startsWith("DUMMY-") || idempotencyKey.length > 128) {
    return jsonResponse(
      {
        error: "validation_failed",
        message: "idempotency_key must start with DUMMY- (staging only)",
      },
      400,
    );
  }

  const emailError = assertDummyPurchaserEmail(recipientEmail);
  if (emailError) {
    return jsonResponse({ error: "validation_failed", message: emailError }, 400);
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate)) {
    return jsonResponse(
      {
        error: "validation_failed",
        message: "delivery_date must be ISO date YYYY-MM-DD",
      },
      400,
    );
  }

  const html = buildSealConfirmationHtml({ deliveryDateIso: deliveryDate });
  const text = buildSealConfirmationText({ deliveryDateIso: deliveryDate });

  if (templateContainsPrivateLetterContent(html)) {
    return jsonResponse({ error: "template_invalid" }, 500);
  }

  try {
    const { row, duplicate } = await insertOutboundQueued(env, {
      idempotency_key: idempotencyKey,
      recipient_email: recipientEmail,
      delivery_date: deliveryDate,
      letter_ref: body.letter_ref ?? null,
      entitlement_ref: body.entitlement_ref ?? null,
    });

    if (!row) {
      return jsonResponse({ error: "insert_failed" }, 500);
    }

    if (duplicate || row.provider_message_id) {
      return jsonResponse({
        status: "ok",
        phase: "phase4",
        duplicate: true,
        outbound_email_id: row.id,
        provider_message_id: row.provider_message_id,
        email_status: row.status,
        resent: false,
        letter_content_in_email: false,
      });
    }

    await markOutboundSending(env, row.id);

    const sendResult = await sendViaResend(env, {
      to: recipientEmail,
      subject: buildSealConfirmationSubject(),
      html,
      text,
    });

    const updated = await markOutboundSendResult(env, row.id, {
      ok: sendResult.ok,
      providerMessageId: sendResult.providerMessageId,
      errorSummary: sendResult.errorSummary,
    });

    return jsonResponse({
      status: sendResult.ok ? "ok" : "accepted_with_send_failure",
      phase: "phase4",
      duplicate: false,
      outbound_email_id: updated.id,
      provider_message_id: updated.provider_message_id,
      email_status: updated.status,
      sender: VAULT_SENDER,
      resent: false,
      letter_content_in_email: false,
      send_error: sendResult.ok ? undefined : updated.error_summary,
      note: sendResult.ok
        ? undefined
        : "Email send failed but letter/entitlement data is unaffected.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "send_failed";
    if (message.includes("letter_vault_email_outbound")) {
      return jsonResponse(
        {
          error: "email_table_missing",
          message: "Run migration 004_phase4_email.sql in Supabase.",
        },
        503,
      );
    }
    return jsonResponse({ error: "send_failed", message }, 500);
  }
}

/** Admin-only status read — no letter content, no API keys. */
export async function handleEmailOutboundStatus(
  request: Request,
  env: Env,
  id: string,
): Promise<Response> {
  const blocked = stagingOnlyResponse(env);
  if (blocked) return blocked;

  if (!requireStagingAdmin(request, env)) {
    return accessDeniedResponse();
  }

  try {
    const summary = await fetchOutboundSummary(env, id);
    if (!summary) return accessDeniedResponse();

    return jsonResponse({
      status: "ok",
      phase: "phase4",
      outbound: summary,
      letter_content_in_response: false,
      api_keys_in_response: false,
    });
  } catch {
    return jsonResponse({ error: "status_failed" }, 500);
  }
}

/** Test helper: confirm idempotency without resending. */
export async function handleEmailIdempotencyCheck(
  request: Request,
  env: Env,
): Promise<Response> {
  const blocked = stagingOnlyResponse(env);
  if (blocked) return blocked;

  if (!requireStagingAdmin(request, env)) {
    return accessDeniedResponse();
  }

  const url = new URL(request.url);
  const key = url.searchParams.get("idempotency_key") ?? "";
  if (!key.startsWith("DUMMY-")) {
    return jsonResponse({ error: "validation_failed" }, 400);
  }

  try {
    const existing = await findOutboundByIdempotencyKey(env, key);
    return jsonResponse({
      status: "ok",
      exists: Boolean(existing),
      outbound_email_id: existing?.id ?? null,
      provider_message_id: existing?.provider_message_id ?? null,
      email_status: existing?.status ?? null,
    });
  } catch {
    return jsonResponse({ error: "status_failed" }, 500);
  }
}
