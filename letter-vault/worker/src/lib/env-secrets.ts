import type { Env } from "../env";
import { getVaultEnvironment } from "../env";

/**
 * HMAC pepper for access codes, vault sessions, and management tokens.
 * Production uses LETTER_VAULT_ACCESS_PEPPER (never staging admin token).
 */
export function getAccessPepper(env: Env): string {
  if (getVaultEnvironment(env) === "production") {
    const pepper = env.LETTER_VAULT_ACCESS_PEPPER?.trim();
    if (!pepper) throw new Error("access_pepper_not_configured");
    return pepper;
  }

  const pepper = env.LETTER_VAULT_STAGING_ADMIN_TOKEN?.trim();
  if (!pepper) throw new Error("access_pepper_not_configured");
  return pepper;
}

/** Staging entitlement issue routes (Bearer or raw Authorization). */
export function requireAdminToken(request: Request, env: Env): boolean {
  const expected = env.LETTER_VAULT_STAGING_ADMIN_TOKEN?.trim();
  if (!expected) return false;
  const header = request.headers.get("Authorization")?.trim() ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : header;
  return bearer === expected;
}

/** Production ops routes (X-Letter-Vault-Staging-Admin header — legacy name). */
export function requireProductionAdmin(request: Request, env: Env): boolean {
  const token = env.LETTER_VAULT_PRODUCTION_ADMIN_TOKEN?.trim();
  if (!token) return false;
  const header = request.headers.get("X-Letter-Vault-Staging-Admin")?.trim();
  return header === token;
}
