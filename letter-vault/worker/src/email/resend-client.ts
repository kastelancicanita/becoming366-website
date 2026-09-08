import type { Env } from "../env";

export const VAULT_SENDER =
  "The Letter Vault <letters@vault.becoming366.com>" as const;

export interface ResendSendResult {
  ok: boolean;
  providerMessageId: string | null;
  errorSummary: string | null;
  httpStatus: number;
}

export async function sendViaResend(
  env: Env,
  input: {
    to: string;
    subject: string;
    html: string;
    text: string;
  },
): Promise<ResendSendResult> {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      providerMessageId: null,
      errorSummary: "resend_not_configured",
      httpStatus: 503,
    };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: VAULT_SENDER,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      text: input.text,
    }),
  });

  const body = (await response.json().catch(() => ({}))) as {
    id?: string;
    message?: string;
    name?: string;
  };

  if (!response.ok) {
    return {
      ok: false,
      providerMessageId: null,
      errorSummary: body.message ?? body.name ?? `http_${response.status}`,
      httpStatus: response.status,
    };
  }

  return {
    ok: true,
    providerMessageId: body.id ?? null,
    errorSummary: null,
    httpStatus: response.status,
  };
}
