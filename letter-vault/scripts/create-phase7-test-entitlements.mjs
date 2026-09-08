#!/usr/bin/env node
/**
 * Issue Phase 7 staging entitlements (single or collection).
 * Rotates admin token and prints access codes for Anita's manual UI test.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "https://letter-vault-api-staging.kastelancic-anita.workers.dev";
const __dir = dirname(fileURLToPath(import.meta.url));
const WORKER_DIR = join(__dir, "../worker");

const token = randomBytes(32).toString("base64url");
spawnSync(
  "npx wrangler secret put LETTER_VAULT_STAGING_ADMIN_TOKEN --env staging",
  { input: token, shell: true, cwd: WORKER_DIR },
);
await new Promise((r) => setTimeout(r, 3000));

const headers = {
  "Content-Type": "application/json",
  "X-Letter-Vault-Staging-Admin": token,
};

async function issue(body) {
  const res = await fetch(`${BASE}/v1/staging/entitlements/issue`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

const single = await issue({
  purchaser_email: "vault-single@example.com",
  external_order_ref: `DUMMY-P7-SINGLE-${Date.now()}`,
  product_type: "SINGLE",
  letters_allowed: 1,
  display_title: "Single Letter",
});

const collection = await issue({
  purchaser_email: "vault-collection@example.com",
  external_order_ref: `DUMMY-P7-COLL-${Date.now()}`,
  product_type: "COLLECTION",
  collection_mechanism: "FIXED_MILESTONES",
  letters_allowed: 5,
  display_title: "5 Milestone Letters to My Daughter",
  template_config: { milestones: [16, 18, 21, 25, 30, 40, 50] },
});

console.log("PHASE7_TEST_ENTITLEMENTS");
console.log(JSON.stringify({ single, collection, admin_token_for_cli: token }, null, 2));
