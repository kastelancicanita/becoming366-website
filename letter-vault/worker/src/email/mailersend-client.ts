import type { Env } from "../env";
import { validateSingleSurpriseRecipient } from "../lib/surprise-anti-abuse";

export interface MailerSendSendResult {
  ok: boolean;
  providerMessageId: string | null;
  errorSummary: string | null;
  httpStatus: number;
}

/** Default Surprise sender — override via MAILERSEND_SURPRISE_FROM_EMAIL when set. */
export const MAILERSEND_SURPRISE_SENDER_DEFAULT =
  "The Letter Vault <letters@vault.becoming366.com>" as const;

function surpriseFromAddress(env: Env): string | null {
  const email = env.MAILERSEND_SURPRISE_FROM_EMAIL?.trim();
  if (!email) return null;
  const name = env.MAILERSEND_SURPRISE_FROM_NAME?.trim() || "The Letter Vault";
  return `${name} <${email}>`;
}

/** POST /v1/email — used by MailerSendDeliveryProvider (Surprise path, S2+). */
export async function sendViaMailerSend(
  env: Env,
  input: {
    to: string;
    subject: string;
    html: string;
    text: string;
  },
): Promise<MailerSendSendResult> {
  const recipient = validateSingleSurpriseRecipient(input.to);
  if (!recipient.ok) {
    return {
      ok: false,
      providerMessageId: null,
      errorSummary: recipient.code,
      httpStatus: 400,
    };
  }

  const token = env.MAILERSEND_API_TOKEN?.trim();
  if (!token) {
    return {
      ok: false,
      providerMessageId: null,
      errorSummary: "mailersend_not_configured",
      httpStatus: 503,
    };
  }

  const from = surpriseFromAddress(env);
  if (!from) {
    return {
      ok: false,
      providerMessageId: null,
      errorSummary: "mailersend_from_not_configured",
      httpStatus: 503,
    };
  }

  const response = await fetch("https://api.mailersend.com/v1/email", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: {
        email: from.match(/<([^>]+)>/)?.[1] ?? from,
        name: from.replace(/<[^>]+>/, "").trim() || "The Letter Vault",
      },
      to: [{ email: recipient.email }],
      subject: input.subject,
      html: input.html,
      text: input.text,
    }),
  });

  const body = (await response.json().catch(() => ({}))) as {
    message_id?: string;
    message?: string;
  };

  if (!response.ok) {
    return {
      ok: false,
      providerMessageId: null,
      errorSummary: body.message ?? `http_${response.status}`,
      httpStatus: response.status,
    };
  }

  const messageId =
    response.headers.get("x-message-id")?.trim() || body.message_id?.trim() || null;

  return {
    ok: true,
    providerMessageId: messageId,
    errorSummary: null,
    httpStatus: response.status,
  };
}
