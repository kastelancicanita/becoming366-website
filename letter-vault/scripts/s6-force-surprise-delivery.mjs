#!/usr/bin/env node
/**
 * S6 staging: force-set Surprise delivery email (admin only).
 * Requires migrations 009 + 010 applied in Supabase first.
 *
 * Usage:
 *   set LETTER_VAULT_STAGING_ADMIN_TOKEN=...
 *   node s6-force-surprise-delivery.mjs LV-20E0B6E6 kastelancic.anita@gmail.com
 */
const BASE =
  process.env.LETTER_VAULT_API_STAGING ??
  "https://letter-vault-api-staging.kastelancic-anita.workers.dev";

const token = process.env.LETTER_VAULT_STAGING_ADMIN_TOKEN;
const publicLetterId = process.argv[2] ?? "LV-20E0B6E6";
const deliveryEmail = process.argv[3] ?? "kastelancic.anita@gmail.com";
const purchaserEmail =
  process.argv[4] ?? "vault-p7-single@example.com";

if (!token) {
  console.error("Missing LETTER_VAULT_STAGING_ADMIN_TOKEN");
  process.exit(1);
}

const headers = {
  "Content-Type": "application/json",
  "X-Letter-Vault-Staging-Admin": token,
};

async function main() {
  const health = await fetch(`${BASE}/v1/health`).then((r) => r.json());
  console.log("health.schema_version:", health.schema_version);
  console.log("surprise_delivery_schema:", health.surprise_delivery_schema ?? "n/a");

  const res = await fetch(`${BASE}/v1/staging/surprise/force-set-delivery`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      public_letter_id: publicLetterId,
      purchaser_email: purchaserEmail,
      delivery_email: deliveryEmail,
    }),
  });
  const json = await res.json().catch(() => ({}));
  console.log(JSON.stringify({ http: res.status, ...json }, null, 2));
  process.exit(res.status === 200 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
