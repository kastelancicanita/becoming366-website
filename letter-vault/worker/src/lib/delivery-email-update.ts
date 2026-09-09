import { generateSecureToken, maskEmail } from "../crypto/management-token";
import {
  activateSurpriseDeliveryEmail,
  auditDeliveryEmail,
  createDeliveryEmailChange,
} from "../db/management";
import { recordSurpriseDeclaration } from "../db/surprise-declaration";
import type { LetterRow } from "../db/letters";
import {
  buildDeliveryEmailVerifyHtml,
  buildDeliveryEmailVerifySubject,
  buildDeliveryEmailVerifyText,
} from "../email/templates/management";
import { sendViaResend } from "../email/resend-client";
import type { Env } from "../env";
import { jsonResponse } from "./management-response";
import {
  evaluateSurpriseSaveSafeguards,
  isSurpriseSaveRateLimited,
  recordSurpriseSaveAttempt,
  surpriseDeclarationAuditMetadata,
  surpriseSaveRateLimitBucket,
} from "./surprise-anti-abuse";
import {
  SURPRISE_PERSONAL_DECLARATION_TEXT,
} from "./surprise-declaration";
import {
  isSurpriseDeliveryEmailChoiceAllowed,
  surpriseDeliveryUnavailableMessage,
  surpriseRecipientDeliveryStatus,
} from "./surprise-delivery-policy";

export type DeliveryEmailRequestMode = "surprise" | "verify_now";

export type DeliveryEmailUpdateOptions = {
  surprisePersonalDeclarationAccepted?: boolean;
};

function managementBaseUrl(request: Request): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

export async function applyDeliveryEmailUpdate(
  env: Env,
  request: Request,
  letter: LetterRow,
  newEmail: string,
  mode: DeliveryEmailRequestMode,
  options: DeliveryEmailUpdateOptions = {},
): Promise<Response> {
  if (
    letter.recipient_email === newEmail &&
    letter.delivery_email_verified_at
  ) {
    return jsonResponse({
      status: "ok",
      phase: "phase6",
      message: "This delivery email is already active.",
      pending_verification: false,
      active_delivery_email_masked: maskEmail(newEmail),
      delivery_email_mode: letter.delivery_email_mode ?? "verified",
    });
  }

  const resolvedMode = mode === "surprise" ? "surprise" : "verify_now";

  if (resolvedMode === "surprise") {
    if (!isSurpriseDeliveryEmailChoiceAllowed(env)) {
      return jsonResponse(
        {
          status: "error",
          error: "surprise_unavailable",
          message: surpriseDeliveryUnavailableMessage(),
        },
        400,
      );
    }

    const saveSafeguard = evaluateSurpriseSaveSafeguards({
      env,
      email: newEmail,
      declarationAccepted: options.surprisePersonalDeclarationAccepted,
    });
    if (!saveSafeguard.ok) {
      return jsonResponse(
        {
          status: "error",
          error: saveSafeguard.code,
          message: surpriseSaveErrorMessage(saveSafeguard.code),
          surprise_declaration_text: SURPRISE_PERSONAL_DECLARATION_TEXT,
        },
        saveSafeguard.code === "surprise_save_rate_limited" ? 429 : 400,
      );
    }

    const rateBucket = await surpriseSaveRateLimitBucket(request, letter.id);
    if (await isSurpriseSaveRateLimited(env, rateBucket)) {
      return jsonResponse(
        {
          status: "error",
          error: "surprise_save_rate_limited",
          message: "Too many attempts. Please wait and try again.",
        },
        429,
      );
    }

    await recordSurpriseSaveAttempt(env, rateBucket);
    const acceptedAt = new Date().toISOString();
    await recordSurpriseDeclaration(env, letter.id, acceptedAt);
    await activateSurpriseDeliveryEmail(env, letter.id, saveSafeguard.email);
    await auditDeliveryEmail(
      env,
      letter.id,
      "surprise_declaration_accepted",
      saveSafeguard.email,
    );

    return jsonResponse({
      status: "ok",
      phase: "phase6",
      message:
        "Delivery email saved. The recipient will not be contacted until delivery day.",
      pending_verification: false,
      delivery_email_mode: "surprise",
      active_delivery_email_masked: maskEmail(saveSafeguard.email),
      letter_body_in_response: false,
      recipient_delivery_status: surpriseRecipientDeliveryStatus(
        env,
        "surprise",
      ),
      surprise_declaration: surpriseDeclarationAuditMetadata(),
    });
  }

  const rawVerifyToken = generateSecureToken();
  const previousActive = letter.recipient_email;
  await createDeliveryEmailChange(
    env,
    letter.id,
    newEmail,
    rawVerifyToken,
    previousActive,
  );

  await auditDeliveryEmail(
    env,
    letter.id,
    "delivery_email_change_requested",
    newEmail,
  );

  const verifyUrl = `${managementBaseUrl(request)}/v1/staging/management/delivery-email/confirm?token=${encodeURIComponent(rawVerifyToken)}`;
  await sendViaResend(env, {
    to: newEmail,
    subject: buildDeliveryEmailVerifySubject(),
    html: buildDeliveryEmailVerifyHtml(verifyUrl),
    text: buildDeliveryEmailVerifyText(verifyUrl),
  });

  return jsonResponse({
    status: "ok",
    phase: "phase6",
    message:
      "Verification sent to the new address. The current delivery email remains active until verification succeeds.",
    pending_verification: true,
    active_delivery_email_masked: letter.recipient_email
      ? maskEmail(letter.recipient_email)
      : null,
    delivery_email_mode: "verified",
    letter_body_in_response: false,
  });
}

function surpriseSaveErrorMessage(code: string): string {
  switch (code) {
    case "surprise_declaration_required":
      return "Please confirm the personal delivery declaration before saving Surprise delivery.";
    case "surprise_recipient_multi":
      return "Surprise delivery supports exactly one recipient address.";
    case "surprise_recipient_invalid":
    case "surprise_recipient_empty":
      return "Please enter a valid single recipient email address.";
    case "surprise_test_domain_blocked":
      return "Surprise delivery requires a real recipient address.";
    default:
      return "We couldn't save that address. Please try again.";
  }
}

export function customerDeliveryEmailCapabilities(env: Env) {
  const surpriseAllowed = isSurpriseDeliveryEmailChoiceAllowed(env);
  return {
    surprise_delivery_email_available: surpriseAllowed,
    surprise_unavailable_message: surpriseAllowed
      ? null
      : surpriseDeliveryUnavailableMessage(),
    surprise_declaration_text: surpriseAllowed
      ? SURPRISE_PERSONAL_DECLARATION_TEXT
      : null,
  };
}
