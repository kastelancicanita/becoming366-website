#!/usr/bin/env node
/**
 * Live staging Phase 2 POC test (dummy data only).
 * Usage: node scripts/phase2-staging-test.mjs [baseUrl]
 */
const BASE =
  process.argv[2] ??
  "https://letter-vault-api-staging.kastelancic-anita.workers.dev";

const DUMMY = "DUMMY: Phase 2 live staging encryption test — not real letter content.";

async function request(path, options = {}) {
  const url = `${BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

function assert(condition, message) {
  if (!condition) {
    console.error("FAIL:", message);
    process.exit(1);
  }
}

console.log("Letter Vault Phase 2 — live staging test");
console.log("Base URL:", BASE);
console.log("");

const health = await request("/v1/health");
console.log("1. Health:", health.status, health.json);
assert(health.status === 200, "health check failed");
assert(
  health.json.schema_version === "phase2" || health.json.schema_version === "phase1",
  "unexpected schema_version",
);

const roundtrip = await request("/v1/staging/poc/roundtrip", {
  method: "POST",
  body: JSON.stringify({ dummy_text: DUMMY }),
});
console.log("2. Roundtrip:", roundtrip.status, roundtrip.json);
assert(roundtrip.status === 200, "roundtrip failed");
assert(roundtrip.json.decrypt_ok === true, "roundtrip decrypt_ok false");
assert(roundtrip.json.plaintext_in_response === false, "plaintext leaked in roundtrip");

const seal = await request("/v1/staging/poc/seal", {
  method: "POST",
  body: JSON.stringify({ label: "phase2-live", dummy_text: DUMMY }),
});
console.log("3. Seal:", seal.status, seal.json);
if (seal.status === 503 && seal.json.error === "poc_table_missing") {
  console.error("");
  console.error("Migration 002 not applied yet.");
  console.error("Run migrations/002_phase2_crypto_poc.sql in Supabase SQL Editor, then re-run this script.");
  process.exit(1);
}
assert(seal.status === 200, "seal failed");
assert(seal.json.plaintext_in_response === false, "plaintext leaked in seal");
assert(seal.json.id, "seal missing id");

const verify = await request(`/v1/staging/poc/verify/${seal.json.id}`);
console.log("4. Verify:", verify.status, verify.json);
assert(verify.status === 200, "verify failed");
assert(verify.json.decrypt_ok === true, "verify decrypt_ok false");
assert(verify.json.plaintext_in_response === false, "plaintext leaked in verify");
assert(!JSON.stringify(verify.json).includes("Phase 2 live"), "dummy text leaked in verify response");

console.log("");
console.log("PASS — Phase 2 staging encryption POC verified.");
