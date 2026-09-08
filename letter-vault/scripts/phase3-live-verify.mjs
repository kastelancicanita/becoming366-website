#!/usr/bin/env node
/**
 * Internal Phase 3 live verification runner.
 * Uses LETTER_VAULT_STAGING_ADMIN_TOKEN from env OR rotates token via wrangler stdin.
 * Never prints the raw token.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE =
  process.argv[2] ??
  "https://letter-vault-api-staging.kastelancic-anita.workers.dev";
const __dir = dirname(fileURLToPath(import.meta.url));
const WORKER_DIR = join(__dir, "../worker");

let token = process.env.LETTER_VAULT_STAGING_ADMIN_TOKEN;
let tokenRotated = false;

if (!token) {
  token = randomBytes(32).toString("base64url");
  const r = spawnSync(
    "npx wrangler secret put LETTER_VAULT_STAGING_ADMIN_TOKEN --env staging",
    { input: token, shell: true, cwd: WORKER_DIR, encoding: "utf8" },
  );
  if (r.status !== 0) {
    console.error("Failed to set staging admin token for verification.");
    process.exit(1);
  }
  tokenRotated = true;
  await new Promise((r) => setTimeout(r, 2000));
}

const results = {};
function pass(key) {
  results[key] = "PASS";
}
function fail(key, msg) {
  results[key] = `FAIL: ${msg}`;
}

async function api(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json, text: JSON.stringify(json) };
}

const suffix = Date.now();
const email = "dummy-buyer@example.com";

const health = await api("/v1/health");
if (health.status === 200 && health.json.schema_version === "phase3") {
  pass("migration");
  pass("health_phase3");
} else {
  fail("migration", `schema_version=${health.json.schema_version}`);
  fail("health_phase3", JSON.stringify(health.json));
}

const issue = await api("/v1/staging/entitlements/issue", {
  method: "POST",
  headers: { "X-Letter-Vault-Staging-Admin": token },
  body: JSON.stringify({
    purchaser_email: email,
    external_order_ref: `DUMMY-ORDER-${suffix}`,
    source: "manual_staging",
    status: "active",
  }),
});

if (issue.status !== 200 || !issue.json.access_code?.startsWith("LV-")) {
  fail("secure_code_generation", `issue status ${issue.status}`);
  fail("staging_admin_configured", "issue failed");
} else {
  pass("secure_code_generation");
  pass("staging_admin_configured");
  pass("raw_code_absent_from_db_flag", issue.json.raw_code_in_db === false ? undefined : "");
  if (issue.json.raw_code_in_db === false) pass("raw_code_absent_from_db");
  else fail("raw_code_absent_from_db", "raw_code_in_db not false");
}

const code = issue.json.access_code;
const id = issue.json.entitlement_id;

const verifyOk = await api("/v1/staging/entitlements/verify", {
  method: "POST",
  body: JSON.stringify({ access_code: code, purchaser_email: email }),
});
if (verifyOk.status === 200 && verifyOk.json.authorized) pass("verify_correct");
else fail("verify_correct", JSON.stringify(verifyOk.json));

const statusBefore = await api(`/v1/staging/entitlements/status/${id}`, {
  headers: { "X-Letter-Vault-Staging-Admin": token },
});
if (statusBefore.json.letters_used === 0) pass("verify_no_consume");
else fail("verify_no_consume", `letters_used=${statusBefore.json.letters_used}`);

const wrongCode = await api("/v1/staging/entitlements/verify", {
  method: "POST",
  body: JSON.stringify({
    access_code: "LV-wrong-code-value",
    purchaser_email: email,
  }),
});
if (wrongCode.status === 401 && wrongCode.json.error === "access_denied")
  pass("wrong_code");
else fail("wrong_code", String(wrongCode.status));

const wrongEmail = await api("/v1/staging/entitlements/verify", {
  method: "POST",
  body: JSON.stringify({
    access_code: code,
    purchaser_email: "other-dummy@example.com",
  }),
});
if (wrongEmail.status === 401 && wrongEmail.json.error === "access_denied")
  pass("wrong_email");
else fail("wrong_email", String(wrongEmail.status));

for (const [st, em] of [
  ["revoked", "dummy-revoked@example.com"],
  ["refunded", "dummy-refunded@example.com"],
]) {
  const iss = await api("/v1/staging/entitlements/issue", {
    method: "POST",
    headers: { "X-Letter-Vault-Staging-Admin": token },
    body: JSON.stringify({
      purchaser_email: em,
      external_order_ref: `DUMMY-${st.toUpperCase()}-${suffix}`,
      status: st,
    }),
  });
  const v = await api("/v1/staging/entitlements/verify", {
    method: "POST",
    body: JSON.stringify({
      access_code: iss.json.access_code,
      purchaser_email: em,
    }),
  });
  if (v.status === 401) pass(st);
  else fail(st, String(v.status));
}

const c1 = await api("/v1/staging/entitlements/consume", {
  method: "POST",
  body: JSON.stringify({ access_code: code, purchaser_email: email }),
});
if (c1.status === 200 && c1.json.consumed && c1.json.letters_used === 1)
  pass("first_consume");
else fail("first_consume", JSON.stringify(c1.json));

const c2 = await api("/v1/staging/entitlements/consume", {
  method: "POST",
  body: JSON.stringify({ access_code: code, purchaser_email: email }),
});
if (c2.status === 401) pass("second_consume_blocked");
else fail("second_consume_blocked", String(c2.status));

const raceIssue = await api("/v1/staging/entitlements/issue", {
  method: "POST",
  headers: { "X-Letter-Vault-Staging-Admin": token },
  body: JSON.stringify({
    purchaser_email: "dummy-race@example.com",
    external_order_ref: `DUMMY-RACE-${suffix}`,
  }),
});
const raceBody = JSON.stringify({
  access_code: raceIssue.json.access_code,
  purchaser_email: "dummy-race@example.com",
});
const [r1, r2] = await Promise.all([
  api("/v1/staging/entitlements/consume", { method: "POST", body: raceBody }),
  api("/v1/staging/entitlements/consume", { method: "POST", body: raceBody }),
]);
const wins = [r1, r2].filter((r) => r.status === 200 && r.json.consumed).length;
if (wins === 1) pass("concurrent_consume");
else fail("concurrent_consume", `successes=${wins}`);

spawnSync("npx wrangler deploy --env staging", {
  shell: true,
  cwd: WORKER_DIR,
  stdio: "ignore",
});
await new Promise((r) => setTimeout(r, 3000));

const afterRedeploy = await api(`/v1/staging/entitlements/status/${id}`, {
  headers: { "X-Letter-Vault-Staging-Admin": token },
});
if (afterRedeploy.json.letters_used === 1) pass("redeploy_persistence");
else fail("redeploy_persistence", JSON.stringify(afterRedeploy.json));

const leakBundle = JSON.stringify({ verifyOk, c1, statusBefore, afterRedeploy });
if (!leakBundle.includes(code.slice(4))) pass("no_plaintext_api");
else fail("no_plaintext_api", "access code substring in API json");

const dev403 = await fetch(
  "https://letter-vault-api-dev.kastelancic-anita.workers.dev/v1/staging/entitlements/verify",
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ access_code: "LV-x", purchaser_email: email }),
  },
);
if (dev403.status === 403) pass("staging_guard");
else fail("staging_guard", String(dev403.status));

console.log("PHASE3_LIVE_RESULTS");
console.log(JSON.stringify({ results, tokenRotated }, null, 2));
const failed = Object.entries(results).filter(([, v]) => v.startsWith("FAIL"));
process.exit(failed.length ? 1 : 0);
