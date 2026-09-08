/**
 * Access code generation and hashing.
 * Raw codes are shown once at issuance only; DB stores HMAC-SHA256 hash only.
 */

const ACCESS_CODE_BYTES = 24; // 192 bits entropy before encoding

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function formatAccessCode(raw: string): string {
  return `LV-${raw}`;
}

export function generateAccessCodeRaw(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(ACCESS_CODE_BYTES));
  return bytesToBase64Url(bytes);
}

export function generateAccessCode(): string {
  return formatAccessCode(generateAccessCodeRaw());
}

export async function hashAccessCode(
  pepper: string,
  accessCode: string,
): Promise<string> {
  const normalized = accessCode.trim();
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(normalized),
  );
  return [...new Uint8Array(signature)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function normalizePurchaserEmail(email: string): string {
  return email.trim().toLowerCase();
}
