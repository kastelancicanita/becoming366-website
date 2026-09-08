#!/usr/bin/env node
/**
 * Issue fresh Phase 7 staging entitlements for all collection mechanisms.
 * Rotates admin token and prints access codes for Anita's browser QA.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "https://letter-vault-api-staging.kastelancic-anita.workers.dev";
const __dir = dirname(fileURLToPath(import.meta.url));
const WORKER_DIR = join(__dir, "../worker");
const ts = Date.now();

const token = randomBytes(32).toString("base64url");
spawnSync(
  "npx wrangler secret put LETTER_VAULT_STAGING_ADMIN_TOKEN --env staging",
  { input: token, shell: true, cwd: WORKER_DIR },
);
await new Promise((r) => setTimeout(r, 4000));

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
  purchaser_email: "vault-p7-single@example.com",
  external_order_ref: `DUMMY-P7-SINGLE-${ts}`,
  product_type: "SINGLE",
  letters_allowed: 1,
  display_title: "Single Letter",
});

const fixedMilestones = await issue({
  purchaser_email: "vault-p7-milestones@example.com",
  external_order_ref: `DUMMY-P7-FIXED-${ts}`,
  product_type: "COLLECTION",
  collection_mechanism: "FIXED_MILESTONES",
  letters_allowed: 5,
  display_title: "5 Milestone Letters to My Daughter",
  template_config: { milestones: [16, 18, 21, 25, 30, 40, 50] },
});

const recurring = await issue({
  purchaser_email: "vault-p7-recurring@example.com",
  external_order_ref: `DUMMY-P7-RECUR-${ts}`,
  product_type: "COLLECTION",
  collection_mechanism: "RECURRING",
  letters_allowed: 5,
  display_title: "5 Anniversary Letters",
  template_config: { recurring_type: "anniversary" },
});

const freeCollection = await issue({
  purchaser_email: "vault-p7-free@example.com",
  external_order_ref: `DUMMY-P7-FREE-${ts}`,
  product_type: "COLLECTION",
  collection_mechanism: "FREE_COLLECTION",
  letters_allowed: 5,
  display_title: "5 Letters for the Future",
});

const health = await fetch(`${BASE}/v1/health`).then((r) => r.json());

console.log("PHASE7_STAGING_TEST_ENTITLEMENTS");
console.log(
  JSON.stringify(
    {
      deployed_at: new Date().toISOString(),
      schema_version: health.schema_version,
      single: {
        email: "vault-p7-single@example.com",
        access_code: single.json.access_code,
        status: single.status,
      },
      fixed_milestones: {
        email: "vault-p7-milestones@example.com",
        access_code: fixedMilestones.json.access_code,
        status: fixedMilestones.status,
      },
      recurring: {
        email: "vault-p7-recurring@example.com",
        access_code: recurring.json.access_code,
        status: recurring.status,
      },
      free_collection: {
        email: "vault-p7-free@example.com",
        access_code: freeCollection.json.access_code,
        status: freeCollection.status,
      },
      admin_token_for_cli: token,
    },
    null,
    2,
  ),
);
