/**
 * Worker environment bindings.
 * Secrets are set via `wrangler secret put` or `.dev.vars` (gitignored).
 */
export interface Env {
  VAULT_ENV: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  /** Server-side master key (KEK) — never expose to clients. Set via wrangler secret. */
  LETTER_VAULT_MASTER_KEY_V1?: string;
  /** Staging-only: admin token for issuing dummy entitlements + access-code HMAC pepper. */
  LETTER_VAULT_STAGING_ADMIN_TOKEN?: string;
  /** Resend API key — Cloudflare secret only. */
  RESEND_API_KEY?: string;
  /** Resend webhook signing secret (whsec_...) — Cloudflare secret only. */
  RESEND_WEBHOOK_SECRET?: string;
}

export type VaultEnvironment = "development" | "staging" | "production";

export function getVaultEnvironment(env: Env): VaultEnvironment {
  const value = env.VAULT_ENV?.toLowerCase();
  if (value === "staging") return "staging";
  if (value === "production") return "production";
  return "development";
}

export function hasSupabaseConfig(env: Env): boolean {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
}
