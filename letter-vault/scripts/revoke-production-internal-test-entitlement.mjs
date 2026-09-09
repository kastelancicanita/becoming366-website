#!/usr/bin/env node
/**
 * Hard-delete an INTERNAL_TEST production entitlement and related rows (8B-A).
 *
 * Usage:
 *   set LETTER_VAULT_PRODUCTION_ADMIN_TOKEN=<production admin token>
 *   node letter-vault/scripts/revoke-production-internal-test-entitlement.mjs --id <entitlement_uuid>
 *   node letter-vault/scripts/revoke-production-internal-test-entitlement.mjs --ref INTERNAL_TEST-...
 */
const REVOKE_URL =
  "https://letter-vault-api-production.kastelancic-anita.workers.dev/v1/production/ops/revoke-internal-test-entitlement";
const ADMIN_HEADER = "X-Letter-Vault-Staging-Admin";

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Missing ${name}.`);
    process.exit(1);
  }
  return value;
}

function parseArgs(argv) {
  let entitlementId = "";
  let externalOrderRef = "";
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--id" && argv[i + 1]) {
      entitlementId = argv[++i];
    } else if (argv[i] === "--ref" && argv[i + 1]) {
      externalOrderRef = argv[++i];
    }
  }
  if (!entitlementId && !externalOrderRef) {
    console.error(
      "Usage: node revoke-production-internal-test-entitlement.mjs --id <uuid> OR --ref INTERNAL_TEST-...",
    );
    process.exit(1);
  }
  return { entitlementId, externalOrderRef };
}

async function main() {
  const token = requireEnv("LETTER_VAULT_PRODUCTION_ADMIN_TOKEN");
  const { entitlementId, externalOrderRef } = parseArgs(process.argv);

  const body = {};
  if (entitlementId) body.entitlement_id = entitlementId;
  if (externalOrderRef) body.external_order_ref = externalOrderRef;

  const response = await fetch(REVOKE_URL, {
    method: "POST",
    headers: {
      [ADMIN_HEADER]: token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("Revoke failed:", response.status, json);
    process.exit(1);
  }

  console.log("INTERNAL_TEST cleanup OK");
  console.log("Entitlement ID:", json.entitlement_id);
  console.log("Order ref:", json.external_order_ref);
  console.log("Letters deleted:", json.letters_deleted);
}

main().catch((err) => {
  console.error("Failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
