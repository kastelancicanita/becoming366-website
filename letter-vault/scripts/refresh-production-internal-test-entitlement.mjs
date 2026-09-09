#!/usr/bin/env node
/**
 * Revoke the previous friend E2E INTERNAL_TEST entitlement, then issue a fresh one.
 * Access code prints once in this terminal only.
 *
 * Usage (cmd):
 *   set LETTER_VAULT_PRODUCTION_ADMIN_TOKEN=<production admin token>
 *   node letter-vault/scripts/refresh-production-internal-test-entitlement.mjs --email larosaapartman@gmail.com
 */
const REVOKE_URL =
  "https://letter-vault-api-production.kastelancic-anita.workers.dev/v1/production/ops/revoke-internal-test-entitlement";
const ISSUE_URL =
  "https://letter-vault-api-production.kastelancic-anita.workers.dev/v1/production/ops/issue-internal-test-entitlement";
const ADMIN_HEADER = "X-Letter-Vault-Staging-Admin";

/** Previous friend E2E entitlement — safe to revoke when refreshing. */
const PREVIOUS_ENTITLEMENT_ID = "004f5b89-377d-4bbe-ae87-707a551eba6f";

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
  let revokeId = PREVIOUS_ENTITLEMENT_ID;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--email" && argv[i + 1]) {
      email = argv[++i];
    } else if (argv[i] === "--revoke-id" && argv[i + 1]) {
      revokeId = argv[++i];
    } else if (argv[i] === "--skip-revoke") {
      revokeId = "";
    }
  }
  if (!email) {
    console.error(
      "Usage: node refresh-production-internal-test-entitlement.mjs --email <friend_real_email>",
    );
    process.exit(1);
  }
  return { email, revokeId };
}

async function post(url, token, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      [ADMIN_HEADER]: token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  return { response, json };
}

async function main() {
  const token = requireEnv("LETTER_VAULT_PRODUCTION_ADMIN_TOKEN");
  const { email, revokeId } = parseArgs(process.argv);

  console.log("=== Letter Vault — refresh INTERNAL_TEST friend E2E ===");
  console.log("");

  if (revokeId) {
    console.log("Revoking previous entitlement:", revokeId);
    const { response, json } = await post(REVOKE_URL, token, {
      entitlement_id: revokeId,
    });
    if (response.status === 404) {
      console.log("Previous entitlement already removed (404) — continuing.");
    } else if (!response.ok) {
      console.error("Revoke failed:", response.status, json);
      process.exit(1);
    } else {
      console.log("Revoke OK — letters deleted:", json.letters_deleted ?? 0);
    }
    console.log("");
  }

  console.log("Issuing fresh INTERNAL_TEST for:", email);
  const { response, json } = await post(ISSUE_URL, token, {
    purchaser_email: email,
  });
  if (!response.ok) {
    console.error("Issue failed:", response.status, json);
    process.exit(1);
  }

  console.log("Entitlement ID:", json.entitlement_id);
  console.log("Order ref:", json.external_order_ref);
  console.log("");
  console.log("=== ACCESS CODE (copy now — shown once) ===");
  console.log(json.access_code);
  console.log("===========================================");
  console.log("");
  console.log(
    json.delivery_instructions ??
      "Send the code manually to your friend. Enter at https://becoming366.com/letter-vault/",
  );
}

main().catch((err) => {
  console.error("Failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
