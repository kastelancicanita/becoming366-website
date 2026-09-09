import type { Env } from "../env";

export function requireAdminToken(request: Request, env: Env): boolean {
  const expected = env.LETTER_VAULT_STAGING_ADMIN_TOKEN;
  if (!expected) return false;
  const header = request.headers.get("Authorization")?.trim() ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : header;
  return bearer === expected;
}
