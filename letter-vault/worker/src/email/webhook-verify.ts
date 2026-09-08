/**
 * Svix webhook signature verification (used by Resend).
 * Raw body required — never verify parsed JSON.
 */

const TIMESTAMP_TOLERANCE_SEC = 300;

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function decodeSecret(webhookSecret: string): Uint8Array {
  const raw = webhookSecret.startsWith("whsec_")
    ? webhookSecret.slice(6)
    : webhookSecret;
  const binary = atob(raw);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function hmacSha256Base64(
  keyBytes: Uint8Array,
  message: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  let binary = "";
  for (const byte of new Uint8Array(sig)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export interface SvixHeaders {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

export function extractSvixHeaders(request: Request): SvixHeaders {
  return {
    id: request.headers.get("svix-id"),
    timestamp: request.headers.get("svix-timestamp"),
    signature: request.headers.get("svix-signature"),
  };
}

export async function verifySvixWebhook(
  webhookSecret: string,
  rawBody: string,
  headers: SvixHeaders,
): Promise<boolean> {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;

  const ts = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(ts)) return false;

  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - ts) > TIMESTAMP_TOLERANCE_SEC) return false;

  const signedContent = `${id}.${timestamp}.${rawBody}`;
  const keyBytes = decodeSecret(webhookSecret);
  const expected = await hmacSha256Base64(keyBytes, signedContent);

  const parts = signature.split(" ");
  for (const part of parts) {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) continue;
    if (timingSafeEqual(sig, expected)) return true;
  }

  return false;
}

export interface ResendWebhookPayload {
  type: string;
  created_at?: string;
  data?: {
    email_id?: string;
    from?: string;
    to?: string[];
    subject?: string;
    bounce?: { message?: string };
  };
}

export function parseResendWebhookPayload(rawBody: string): ResendWebhookPayload {
  return JSON.parse(rawBody) as ResendWebhookPayload;
}
