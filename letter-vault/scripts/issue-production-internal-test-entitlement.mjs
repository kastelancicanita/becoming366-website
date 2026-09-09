#!/usr/bin/env node
/**
 * Issue one INTERNAL_TEST production entitlement for friend E2E (8B-A).
 * Not an Etsy sale — admin-only, single letter, real purchaser email.
 *
 * Usage (cmd — never paste secrets in chat):
 *   set LETTER_VAULT_PRODUCTION_ADMIN_TOKEN=<production admin token>
 *   node letter-vault/scripts/issue-production-internal-test-entitlement.mjs --email friend@gmail.com
 */
const ISSUE_URL =
  "https://letter-vault-api-production.kastelancic-anita.workers.dev/v1/production/ops/issue-internal-test-entitlement";
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
  let email = "";
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--email" && argv[i + 1]) {
      email = argv[++i];
    }
  }
  if (!email) {
    console.error(
      "Usage: node issue-production-internal-test-entitlement.mjs --email <friend_real_email>",
    );
    process.exit(1);
  }
  return { email };
}

async function main() {
  const token = requireEnv("LETTER_VAULT_PRODUCTION_ADMIN_TOKEN");
  const { email } = parseArgs(process.argv);

  console.log("=== Letter Vault — INTERNAL_TEST friend E2E entitlement (8B-A) ===");
  console.log("Not an Etsy sale. No automatic email.");
  console.log("");

  const response = await fetch(ISSUE_URL, {
    method: "POST",
    headers: {
      [ADMIN_HEADER]: token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ purchaser_email: email }),
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("Issue failed:", response.status, json);
    process.exit(1);
  }

  console.log("Kind:", json.kind);
  console.log("Entitlement ID:", json.entitlement_id);
  console.log("Order ref:", json.external_order_ref);
  console.log("Purchaser:", json.purchaser_email);
  console.log("Display title:", json.display_title);
  console.log("Etsy sale:", json.etsy_sale);
  console.log("");
  console.log("=== ACCESS CODE (copy now — shown once) ===");
  console.log(json.access_code);
  console.log("===========================================");
  console.log("");
  console.log(json.delivery_instructions ?? "");
  console.log("");
  console.log("Cleanup after E2E:");
  console.log(json.cleanup ?? "");
}

main().catch((err) => {
  console.error("Failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
