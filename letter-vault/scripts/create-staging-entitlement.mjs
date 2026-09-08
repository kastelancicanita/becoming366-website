#!/usr/bin/env node
/**
 * Issue a dummy staging entitlement (Phase 3).
 * Requires LETTER_VAULT_STAGING_ADMIN_TOKEN in environment.
 *
 * Usage:
 *   set LETTER_VAULT_STAGING_ADMIN_TOKEN=your-token
 *   node scripts/create-staging-entitlement.mjs [baseUrl] [status]
 *
 * status: active | revoked | refunded (default: active)
 */
const BASE =
  process.argv[2] ??
  "https://letter-vault-api-staging.kastelancic-anita.workers.dev";
const STATUS = process.argv[3] ?? "active";
const TOKEN = process.env.LETTER_VAULT_STAGING_ADMIN_TOKEN;

if (!TOKEN) {
  console.error("Set LETTER_VAULT_STAGING_ADMIN_TOKEN in your environment.");
  process.exit(1);
}

const suffix = Date.now();
const body = {
  purchaser_email: "dummy-buyer@example.com",
  external_order_ref: `DUMMY-ORDER-${suffix}`,
  source: "manual_staging",
  status: STATUS,
  letters_allowed: 1,
};

const res = await fetch(`${BASE}/v1/staging/entitlements/issue`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Letter-Vault-Staging-Admin": TOKEN,
  },
  body: JSON.stringify(body),
});

const json = await res.json();
if (res.status !== 200) {
  console.error("Issue failed:", res.status, json);
  process.exit(1);
}

console.log("Entitlement issued (staging dummy data).");
console.log("entitlement_id:", json.entitlement_id);
console.log("purchaser_email:", json.purchaser_email);
console.log("external_order_ref:", json.external_order_ref);
console.log("entitlement_status:", json.entitlement_status);
console.log("");
console.log("ACCESS CODE (shown once — save securely for testing, not in Git):");
console.log(json.access_code);
