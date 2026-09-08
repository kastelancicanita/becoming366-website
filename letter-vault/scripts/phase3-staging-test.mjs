#!/usr/bin/env node
/**
 * Phase 3 live staging verification (dummy data only).
 * Requires LETTER_VAULT_STAGING_ADMIN_TOKEN in environment.
 */
const BASE =
  process.argv[2] ??
  "https://letter-vault-api-staging.kastelancic-anita.workers.dev";
const TOKEN = process.env.LETTER_VAULT_STAGING_ADMIN_TOKEN;

if (!TOKEN) {
  console.error("Set LETTER_VAULT_STAGING_ADMIN_TOKEN in your environment.");
  process.exit(1);
}

function assert(condition, message) {
  if (!condition) {
    console.error("FAIL:", message);
    process.exit(1);
  }
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
  return { status: res.status, json };
}

console.log("Phase 3 live staging verification");
console.log("Base:", BASE);

const health = await api("/v1/health");
console.log("Health:", health.status, health.json.schema_version);
assert(health.status === 200, "health failed");
assert(
  health.json.schema_version === "phase3" || health.json.schema_version === "phase2",
  "migration 003 may be pending",
);

const suffix = Date.now();
const issue = await api("/v1/staging/entitlements/issue", {
  method: "POST",
  headers: { "X-Letter-Vault-Staging-Admin": TOKEN },
  body: JSON.stringify({
    purchaser_email: "dummy-buyer@example.com",
    external_order_ref: `DUMMY-ORDER-${suffix}`,
    source: "manual_staging",
    status: "active",
  }),
});
assert(issue.status === 200, "issue failed");
const { access_code: code, entitlement_id: id } = issue.json;
assert(code && code.startsWith("LV-"), "access code missing");
assert(issue.json.raw_code_in_db === false, "raw code flagged in db");

const verifyOk = await api("/v1/staging/entitlements/verify", {
  method: "POST",
  body: JSON.stringify({
    access_code: code,
    purchaser_email: "dummy-buyer@example.com",
  }),
});
assert(verifyOk.status === 200 && verifyOk.json.authorized === true, "verify ok");
assert(verifyOk.json.entitlement_consumed === false, "verify consumed entitlement");

const statusBefore = await api(`/v1/staging/entitlements/status/${id}`, {
  headers: { "X-Letter-Vault-Staging-Admin": TOKEN },
});
assert(statusBefore.json.letters_used === 0, "verify should not consume");

const wrongCode = await api("/v1/staging/entitlements/verify", {
  method: "POST",
  body: JSON.stringify({
    access_code: "LV-wrong-code-value",
    purchaser_email: "dummy-buyer@example.com",
  }),
});
assert(wrongCode.status === 401 && wrongCode.json.error === "access_denied", "wrong code");

const wrongEmail = await api("/v1/staging/entitlements/verify", {
  method: "POST",
  body: JSON.stringify({
    access_code: code,
    purchaser_email: "other-dummy@example.com",
  }),
});
assert(wrongEmail.status === 401 && wrongEmail.json.error === "access_denied", "wrong email");

const revoked = await api("/v1/staging/entitlements/issue", {
  method: "POST",
  headers: { "X-Letter-Vault-Staging-Admin": TOKEN },
  body: JSON.stringify({
    purchaser_email: "dummy-revoked@example.com",
    external_order_ref: `DUMMY-REVOKED-${suffix}`,
    status: "revoked",
  }),
});
const revokedCode = revoked.json.access_code;
const revokedVerify = await api("/v1/staging/entitlements/verify", {
  method: "POST",
  body: JSON.stringify({
    access_code: revokedCode,
    purchaser_email: "dummy-revoked@example.com",
  }),
});
assert(revokedVerify.status === 401, "revoked rejected");

const refunded = await api("/v1/staging/entitlements/issue", {
  method: "POST",
  headers: { "X-Letter-Vault-Staging-Admin": TOKEN },
  body: JSON.stringify({
    purchaser_email: "dummy-refunded@example.com",
    external_order_ref: `DUMMY-REFUNDED-${suffix}`,
    status: "refunded",
  }),
});
const refundedCode = refunded.json.access_code;
const refundedVerify = await api("/v1/staging/entitlements/verify", {
  method: "POST",
  body: JSON.stringify({
    access_code: refundedCode,
    purchaser_email: "dummy-refunded@example.com",
  }),
});
assert(refundedVerify.status === 401, "refunded rejected");

const consume1 = await api("/v1/staging/entitlements/consume", {
  method: "POST",
  body: JSON.stringify({
    access_code: code,
    purchaser_email: "dummy-buyer@example.com",
  }),
});
assert(consume1.status === 200 && consume1.json.consumed === true, "first consume");
assert(consume1.json.letters_used === 1, "letters_used 1");

const consume2 = await api("/v1/staging/entitlements/consume", {
  method: "POST",
  body: JSON.stringify({
    access_code: code,
    purchaser_email: "dummy-buyer@example.com",
  }),
});
assert(consume2.status === 401, "second consume blocked");

const [raceA, raceB] = await Promise.all([
  api("/v1/staging/entitlements/issue", {
    method: "POST",
    headers: { "X-Letter-Vault-Staging-Admin": TOKEN },
    body: JSON.stringify({
      purchaser_email: "dummy-race@example.com",
      external_order_ref: `DUMMY-RACE-${suffix}`,
    }),
  }),
]);
const raceCode = raceA.json.access_code;
const raceBody = JSON.stringify({
  access_code: raceCode,
  purchaser_email: "dummy-race@example.com",
});
const [r1, r2] = await Promise.all([
  api("/v1/staging/entitlements/consume", { method: "POST", body: raceBody }),
  api("/v1/staging/entitlements/consume", { method: "POST", body: raceBody }),
]);
const raceSuccesses = [r1, r2].filter((r) => r.status === 200 && r.json.consumed).length;
assert(raceSuccesses === 1, "concurrent consume exactly one success");

const leakCheck = JSON.stringify({ verifyOk, consume1, statusBefore });
assert(!leakCheck.includes(code.slice(3)), "raw code leaked in test output objects");

console.log("");
console.log("PASS — Phase 3 staging verification complete.");
