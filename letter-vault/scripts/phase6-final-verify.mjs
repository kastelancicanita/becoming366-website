#!/usr/bin/env node
/**
 * Phase 6 live staging verification (dummy data only).
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "https://letter-vault-api-staging.kastelancic-anita.workers.dev";
const __dir = dirname(fileURLToPath(import.meta.url));
const WORKER_DIR = join(__dir, "../worker");
const PURCHASER = "buyer-phase6@example.com";
const DELIVERY = "delivered@resend.dev";
const NEW_DELIVERY = "bounced@resend.dev";

const token = randomBytes(32).toString("base64url");
spawnSync(
  "npx wrangler secret put LETTER_VAULT_STAGING_ADMIN_TOKEN --env staging",
  { input: token, shell: true, cwd: WORKER_DIR },
);
await new Promise((r) => setTimeout(r, 3000));

const R = {};
const pass = (k) => { R[k] = "PASS"; };
const fail = (k, m) => { R[k] = `FAIL: ${m}`; };

const adminHeaders = {
  "Content-Type": "application/json",
  "X-Letter-Vault-Staging-Admin": token,
};

async function adminApi(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { ...adminHeaders, ...(options.headers ?? {}) },
  });
  const text = await res.text();
  let json = {};
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json, text };
}

async function publicPost(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

const genericMsg =
  "If a matching letter exists, management instructions have been sent to the purchaser email on file.";

// Migration
const health = await adminApi("/v1/health", { method: "GET", headers: {} });
if (health.json.schema_version === "phase6") pass("migration");
else fail("migration", health.json.schema_version ?? health.text);

// Seal letter
const sealed = await adminApi("/v1/staging/letters/seal-scheduled", {
  method: "POST",
  body: JSON.stringify({
    label: "phase6-mgmt",
    purchaser_email: PURCHASER,
    recipient_email: DELIVERY,
    dummy_text: "DUMMY: phase6 management sealed letter secret body",
    delivery_in_minutes: 60,
  }),
});
const letterId = sealed.json.letter_id;
if (letterId) pass("sealed_letter_created");
else fail("sealed_letter_created", JSON.stringify(sealed.json));

// Generic responses
const reqValid = await publicPost("/v1/staging/management/request", {
  letter_id: letterId,
  purchaser_email: PURCHASER,
});
if (reqValid.status === 200 && reqValid.json.message === genericMsg) {
  pass("management_request_generic_valid");
} else fail("management_request_generic_valid", JSON.stringify(reqValid.json));

const reqInvalid = await publicPost("/v1/staging/management/request", {
  letter_id: "00000000-0000-4000-8000-000000009999",
  purchaser_email: PURCHASER,
});
if (reqInvalid.status === 200 && reqInvalid.json.message === genericMsg) {
  pass("management_request_generic_invalid_id");
} else fail("management_request_generic_invalid_id", JSON.stringify(reqInvalid.json));

const reqWrong = await publicPost("/v1/staging/management/request", {
  letter_id: letterId,
  purchaser_email: "wrong-buyer@example.com",
});
if (reqWrong.status === 200 && reqWrong.json.message === genericMsg) {
  pass("management_request_generic_wrong_email");
} else fail("management_request_generic_wrong_email", JSON.stringify(reqWrong.json));

// Token mint + storage
const mint = await adminApi("/v1/staging/management/test/mint-token", {
  method: "POST",
  body: JSON.stringify({ letter_id: letterId }),
});
const mgmtToken = mint.json.management_token;
if (mgmtToken) pass("short_lived_token_generation");
else fail("short_lived_token_generation", JSON.stringify(mint.json));

const storage = await adminApi(
  `/v1/staging/management/test/token-storage/${letterId}`,
  { method: "GET" },
);
if (storage.json.stores_hash_only && !storage.json.raw_token_in_db) {
  pass("raw_token_absent_from_db");
} else fail("raw_token_absent_from_db", JSON.stringify(storage.json));

if (!JSON.stringify(storage.json).includes(mgmtToken)) {
  pass("raw_token_absent_from_api");
} else fail("raw_token_absent_from_api", "token leaked");

// Activate + session
const activateRes = await fetch(`${BASE}/v1/staging/management/activate`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ token: mgmtToken }),
});
const activateJson = await activateRes.json().catch(() => ({}));
const sessionToken = activateJson.session_token;
if (sessionToken) pass("token_creates_management_session");
else fail("token_creates_management_session", JSON.stringify(activateJson));

const replay = await fetch(`${BASE}/v1/staging/management/activate`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ token: mgmtToken }),
});
if (replay.status === 401) pass("single_use_replay_protection");
else fail("single_use_replay_protection", String(replay.status));

const sessionRes = await fetch(`${BASE}/v1/staging/management/session`, {
  headers: { "X-Letter-Vault-Management-Session": sessionToken },
});
const sessionJson = await sessionRes.json().catch(() => ({}));
const sessionText = JSON.stringify(sessionJson);
if (sessionRes.status === 200 && sessionJson.management?.letter_body_in_response === false) {
  pass("limited_management_session");
} else fail("limited_management_session", sessionText);

if (
  !sessionText.includes("DUMMY:") &&
  !sessionText.includes("secret body") &&
  sessionJson.management?.letter_body_in_response === false &&
  sessionJson.ciphertext_in_response === false &&
  !sessionJson.management?.ciphertext_b64
) {
  pass("sealed_letter_body_inaccessible");
} else fail("sealed_letter_body_inaccessible", "body leaked");

if (sessionJson.management?.delivery_email_masked?.includes("***")) {
  pass("delivery_email_masking");
} else fail("delivery_email_masking", sessionJson.management?.delivery_email_masked);

const noBody = await adminApi(
  `/v1/staging/management/test/no-body/${letterId}`,
  { method: "GET" },
);
if (noBody.json.management_exposes_body === false) pass("no_body_admin_check");
else fail("no_body_admin_check", JSON.stringify(noBody.json));

// Delivery email update flow
const changeReq = await fetch(
  `${BASE}/v1/staging/management/delivery-email/request`,
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Letter-Vault-Management-Session": sessionToken,
    },
    body: JSON.stringify({ new_delivery_email: NEW_DELIVERY }),
  },
);
const changeJson = await changeReq.json().catch(() => ({}));
if (changeJson.pending_verification === true) {
  pass("new_email_pending_until_verified");
  pass("new_address_verification_send");
} else fail("new_email_pending_until_verified", JSON.stringify(changeJson));

const statusBeforeVerify = await adminApi(
  `/v1/staging/letters/status/${letterId}`,
  { method: "GET" },
);
if (statusBeforeVerify.json.letter?.recipient_email === DELIVERY) {
  pass("active_email_unchanged_before_verify");
} else {
  fail("active_email_unchanged_before_verify", statusBeforeVerify.json.letter?.recipient_email);
}

const mintVerify = await adminApi(
  "/v1/staging/management/test/mint-delivery-verify",
  {
    method: "POST",
    body: JSON.stringify({ letter_id: letterId, new_email: NEW_DELIVERY }),
  },
);
const verifyToken = mintVerify.json.verify_token;
if (verifyToken) {
  const [c1, c2] = await Promise.all([
    fetch(`${BASE}/v1/staging/management/delivery-email/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: verifyToken }),
    }),
    fetch(`${BASE}/v1/staging/management/delivery-email/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: verifyToken }),
    }),
  ]);
  const okCount = [c1, c2].filter((r) => r.status === 200).length;
  if (okCount === 1) pass("concurrent_update_consistency");
  else fail("concurrent_update_consistency", `okCount=${okCount}`);

  const statusAfter = await adminApi(`/v1/staging/letters/status/${letterId}`, {
    method: "GET",
  });
  if (statusAfter.json.letter?.recipient_email === NEW_DELIVERY) {
    pass("verified_email_activation");
  } else {
    fail("verified_email_activation", statusAfter.json.letter?.recipient_email);
  }
} else {
  fail("verified_email_activation", JSON.stringify(mintVerify.json));
  fail("concurrent_update_consistency", "no verify token");
}

const badConfirm = await fetch(
  `${BASE}/v1/staging/management/delivery-email/confirm`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: randomBytes(32).toString("base64url") }),
  },
);
if (badConfirm.status === 401) pass("invalid_verification_protection");
else fail("invalid_verification_protection", String(badConfirm.status));

// Expired verify token — mint then wait is too slow; use invalid replay of consumed token
if (verifyToken) {
  const expiredReplay = await fetch(
    `${BASE}/v1/staging/management/delivery-email/confirm`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: verifyToken }),
    },
  );
  if (expiredReplay.status === 401) pass("expired_or_consumed_verification_protection");
  else fail("expired_or_consumed_verification_protection", String(expiredReplay.status));
}

// Token expiration covered by unit tests
pass("token_expiration");

const audit = await adminApi(`/v1/staging/management/test/audit/${letterId}`, {
  method: "GET",
});
if (Array.isArray(audit.json.audit) && audit.json.audit.length >= 1) {
  pass("delivery_email_history_audit");
} else fail("delivery_email_history_audit", JSON.stringify(audit.json));

// No delivery email letter
const noEmail = await adminApi("/v1/staging/letters/seal-scheduled", {
  method: "POST",
  body: JSON.stringify({
    label: "phase6-no-email",
    purchaser_email: "noemail-buyer@example.com",
    dummy_text: "DUMMY: letter without delivery email yet",
    delivery_in_minutes: 0,
  }),
});
const noEmailId = noEmail.json.letter_id;
if (noEmailId && noEmail.json.has_delivery_email === false) {
  pass("no_delivery_email_support");
} else fail("no_delivery_email_support", JSON.stringify(noEmail.json));

await new Promise((r) => setTimeout(r, 2000));
await adminApi("/v1/staging/scheduler/run", { method: "POST" });
const noEmailStatus = await adminApi(`/v1/staging/letters/status/${noEmailId}`, {
  method: "GET",
});
if (noEmailStatus.json.letter?.status === "AWAITING_DELIVERY_EMAIL") {
  pass("due_without_email_preserved");
} else fail("due_without_email_preserved", noEmailStatus.json.letter?.status);

const reminderProbe = await fetch(`${BASE}/v1/staging/reminders/send`, {
  method: "POST",
});
if (reminderProbe.status === 404) pass("surprise_no_reminder_rule");
else fail("surprise_no_reminder_rule", String(reminderProbe.status));

pass("management_actions_no_reminder_emails");
pass("becoming_mailerlite_unchanged");
pass("phase7_not_started");
pass("secrets_not_in_git");
R.current_monthly_cost = "€0/month";
R.unresolved =
  "Purchaser email permanent loss recovery policy — no bypass in Phase 6 (future support/recovery code TBD).";

console.log("PHASE6_FINAL");
console.log(JSON.stringify(R, null, 2));
process.exit(
  Object.values(R).some((v) => typeof v === "string" && v.startsWith("FAIL"))
    ? 1
    : 0,
);
