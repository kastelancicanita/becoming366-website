import { createClient } from "@supabase/supabase-js";
import type { Env } from "../env";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 20;

function supabase(env: Env) {
  return createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function hashBucketKey(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function isBucketRateLimited(
  env: Env,
  bucketKey: string,
  maxAttempts: number,
  windowMs: number,
): Promise<boolean> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return false;
  }

  const since = new Date(Date.now() - windowMs).toISOString();
  const client = supabase(env);

  const { count, error } = await client
    .from("letter_vault_auth_attempts")
    .select("id", { count: "exact", head: true })
    .eq("bucket_key", bucketKey)
    .gte("created_at", since);

  if (error) {
    return false;
  }

  return (count ?? 0) >= maxAttempts;
}

export async function isRateLimited(
  env: Env,
  bucketKey: string,
): Promise<boolean> {
  return isBucketRateLimited(env, bucketKey, MAX_ATTEMPTS, WINDOW_MS);
}

export async function recordAuthAttempt(
  env: Env,
  bucketKey: string,
): Promise<void> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return;
  }

  await supabase(env)
    .from("letter_vault_auth_attempts")
    .insert({ bucket_key: bucketKey });
}

export function clientIp(request: Request): string {
  return (
    request.headers.get("CF-Connecting-IP") ??
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ??
    "unknown"
  );
}
