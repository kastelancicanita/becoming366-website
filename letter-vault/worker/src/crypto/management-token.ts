/**
 * Secure token generation and hashing for management flows.
 */

const TOKEN_BYTES = 32;

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function generateSecureToken(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)));
}

export async function hashToken(pepper: string, token: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(token.trim()),
  );
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***@***";
  const visible = local.slice(0, 1);
  return `${visible}***@${domain}`;
}

export const MANAGEMENT_TOKEN_TTL_MS = 20 * 60 * 1000;
export const MANAGEMENT_SESSION_TTL_MS = 30 * 60 * 1000;
export const DELIVERY_EMAIL_VERIFY_TTL_MS = 30 * 60 * 1000;

export function expiresAtFromNow(ttlMs: number): string {
  return new Date(Date.now() + ttlMs).toISOString();
}

export function isExpired(iso: string): boolean {
  return new Date(iso).getTime() <= Date.now();
}
