import type { Env } from "../env";

/** Purchaser magic links open the preview UI; activation happens via POST (avoids email prefetch consuming one-time GET tokens). */
export function buildManagementUiActivateUrl(env: Env, rawToken: string): string {
  const uiBase =
    env.LETTER_VAULT_UI_BASE_URL?.replace(/\/$/, "") ??
    "https://becoming366-website.pages.dev";
  const url = new URL(`${uiBase}/letter-vault/index.html`);
  url.searchParams.set("management_token", rawToken);
  return url.toString();
}
