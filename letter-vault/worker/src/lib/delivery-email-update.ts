import { generateSecureToken, maskEmail } from "../crypto/management-token";
import {
  activateSurpriseDeliveryEmail,
  auditDeliveryEmail,
  createDeliveryEmailChange,
} from "../db/management";
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
  isSurpriseDeliveryEmailChoiceAllowed,
  surpriseDeliveryUnavailableMessage,
  surpriseRecipientDeliveryStatus,
} from "./surprise-delivery-policy";

export type DeliveryEmailRequestMode = "surprise" | "verify_now";

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

    await activateSurpriseDeliveryEmail(env, letter.id, newEmail);
    return jsonResponse({
      status: "ok",
      phase: "phase6",
      message:
        "Delivery email saved. The recipient will not be contacted until delivery day.",
      pending_verification: false,
      delivery_email_mode: "surprise",
      active_delivery_email_masked: maskEmail(newEmail),
      letter_body_in_response: false,
      recipient_delivery_status: surpriseRecipientDeliveryStatus(
        env,
        "surprise",
      ),
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

export function customerDeliveryEmailCapabilities(env: Env) {
  const surpriseAllowed = isSurpriseDeliveryEmailChoiceAllowed(env);
  return {
    surprise_delivery_email_available: surpriseAllowed,
    surprise_unavailable_message: surpriseAllowed
      ? null
      : surpriseDeliveryUnavailableMessage(),
  };
}
