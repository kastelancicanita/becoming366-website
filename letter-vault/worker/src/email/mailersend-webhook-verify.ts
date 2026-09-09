/**
 * MailerSend webhook signature verification (HMAC-SHA256 hex over raw body).
 * @see https://developers.mailersend.com/api/v1/account/webhooks
 */

/** Public test secret used only for webhook.test URL validation pings. */
export const MAILERSEND_WEBHOOK_TEST_SECRET =
  "test_Am3L1GuOIc4blLUuHqAPxxwkZaJyEk8G" as const;

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

async function hmacSha256Hex(
  secret: string,
  message: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function extractMailerSendSignature(request: Request): string | null {
  return request.headers.get("Signature")?.trim() ?? null;
}

export async function verifyMailerSendWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  signingSecret: string,
): Promise<boolean> {
  if (!signatureHeader || !signingSecret) return false;
  const expected = await hmacSha256Hex(signingSecret, rawBody);
  return timingSafeEqual(expected, signatureHeader.trim());
}

export interface MailerSendWebhookPayload {
  type: string;
  created_at?: string;
  message?: string;
  data?: {
    id?: string;
    message_id?: string;
    email_id?: string;
    email?: string;
    type?: string;
    subject?: string;
  };
}

export function parseMailerSendWebhookPayload(
  rawBody: string,
): MailerSendWebhookPayload {
  return JSON.parse(rawBody) as MailerSendWebhookPayload;
}

export function mailerSendProviderEventId(
  payload: MailerSendWebhookPayload,
): string | null {
  const activityId = payload.data?.id?.trim();
  if (activityId) return `mailersend:${activityId}`;
  if (payload.type === "webhook.test") {
    return `mailersend:test:${payload.created_at ?? "ping"}`;
  }
  return null;
}

export function mailerSendProviderMessageId(
  payload: MailerSendWebhookPayload,
): string | null {
  return payload.data?.message_id?.trim() ?? null;
}
