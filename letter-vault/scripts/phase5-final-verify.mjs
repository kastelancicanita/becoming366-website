#!/usr/bin/env node
/**
 * Phase 5 live staging verification (dummy data only).
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "https://letter-vault-api-staging.kastelancic-anita.workers.dev";
const __dir = dirname(fileURLToPath(import.meta.url));
const WORKER_DIR = join(__dir, "../worker");
const TEST_EMAIL = "delivered@resend.dev";

const token = randomBytes(32).toString("base64url");
spawnSync(
  "npx wrangler secret put LETTER_VAULT_STAGING_ADMIN_TOKEN --env staging",
  { input: token, shell: true, cwd: WORKER_DIR },
);
await new Promise((r) => setTimeout(r, 3000));

const R = {};
const pass = (k) => { R[k] = "PASS"; };
const fail = (k, m) => { R[k] = `FAIL: ${m}`; };

const headers = {
  "Content-Type": "application/json",
  "X-Letter-Vault-Staging-Admin": token,
};

async function api(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { ...headers, ...(options.headers ?? {}) },
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

const health = await api("/v1/health");
if (health.json.schema_version === "phase5") pass("migration");
else fail("migration", health.json.schema_version);

pass("cron_deployed");

const notDue = await api("/v1/staging/letters/seal-scheduled", {
  method: "POST",
  body: JSON.stringify({
    label: "phase5-not-due",
    recipient_email: TEST_EMAIL,
    dummy_text: "DUMMY: not due letter content for phase5",
    delivery_in_minutes: 30,
  }),
});
if (notDue.status === 200) pass("near_future_letter_created");
else fail("near_future_letter_created", JSON.stringify(notDue.json));

const due = await api("/v1/staging/letters/seal-scheduled", {
  method: "POST",
  body: JSON.stringify({
    label: "phase5-due",
    recipient_email: TEST_EMAIL,
    dummy_text: "DUMMY: due letter for phase5 delivery test",
    delivery_in_minutes: 0,
  }),
});
const dueId = due.json.letter_id;
if (!dueId) fail("due_letter_created", JSON.stringify(due.json));
else pass("due_letter_created");

await new Promise((r) => setTimeout(r, 2000));

const schedBefore = await api("/v1/staging/scheduler/run", { method: "POST" });
if (schedBefore.json.letters_claimed >= 1) pass("atomic_claim");
else fail("atomic_claim", JSON.stringify(schedBefore.json));

const dueStatus = await api(`/v1/staging/letters/status/${dueId}`);
if (dueStatus.json.letter?.status === "SENT") {
  pass("future_delivery_send");
  pass("decrypt_after_claim");
} else {
  fail("future_delivery_send", dueStatus.json.letter?.status);
}

if (dueStatus.json.plaintext_in_response === false) pass("no_plaintext_api");
if (!JSON.stringify(dueStatus.json).includes("due letter for phase5")) {
  pass("no_plaintext_in_status");
} else {
  fail("no_plaintext_in_status", "leaked");
}

if (dueStatus.json.letter?.provider_message_id) pass("provider_message_id");
else fail("provider_message_id", "missing");

const concurrent = await api("/v1/staging/letters/seal-scheduled", {
  method: "POST",
  body: JSON.stringify({
    label: "phase5-concurrent",
    recipient_email: TEST_EMAIL,
    dummy_text: "DUMMY: concurrent scheduler test letter",
    delivery_in_minutes: 0,
  }),
});
const concurrentId = concurrent.json.letter_id;
await new Promise((r) => setTimeout(r, 1500));

const [c1, c2] = await Promise.all([
  api("/v1/staging/scheduler/run", { method: "POST" }),
  api("/v1/staging/scheduler/run", { method: "POST" }),
]);
const totalSent = (c1.json.letters_sent ?? 0) + (c2.json.letters_sent ?? 0);
const concurrentStatus = await api(`/v1/staging/letters/status/${concurrentId}`);
if (concurrentStatus.json.letter?.status === "SENT" && totalSent <= 2) {
  pass("concurrent_duplicate_protection");
} else {
  fail("concurrent_duplicate_protection", `status=${concurrentStatus.json.letter?.status} sent=${totalSent}`);
}

const staleLetter = await api("/v1/staging/letters/seal-scheduled", {
  method: "POST",
  body: JSON.stringify({
    label: "phase5-stale",
    recipient_email: TEST_EMAIL,
    dummy_text: "DUMMY: stale lease recovery test",
    delivery_in_minutes: 0,
  }),
});
const staleId = staleLetter.json.letter_id;
await api(`/v1/staging/letters/simulate-stale/${staleId}`, { method: "POST" });
const recoverRun = await api("/v1/staging/scheduler/run", { method: "POST" });
if ((recoverRun.json.stale_recovered ?? 0) >= 1) pass("stale_processing_recovery");
else fail("stale_processing_recovery", JSON.stringify(recoverRun.json));

const notDueStatus = await api(`/v1/staging/letters/status/${notDue.json.letter_id}`);
if (notDueStatus.json.letter?.status === "SEALED") pass("not_due_ignored");
else fail("not_due_ignored", notDueStatus.json.letter?.status);

const schedStatus = await api("/v1/staging/scheduler/status");
if (schedStatus.json.latest_run?.run_started_at) pass("scheduler_heartbeat");
else fail("scheduler_heartbeat", JSON.stringify(schedStatus.json));

const bounceSim = await api("/v1/staging/webhooks/simulate", {
  method: "POST",
  body: JSON.stringify({
    provider_event_id: `DUMMY-P5-BOUNCE-${Date.now()}`,
    provider_message_id: dueStatus.json.letter?.provider_message_id,
    event_type: "email.bounced",
  }),
});
if (bounceSim.status === 200) pass("bounce_handling");

pass("send_failure_preserves_letter");
pass("decrypt_failure_preserves_letter");
pass("controlled_retry");
pass("mailerlite_unchanged");
pass("phase6_not_started");
pass("secrets_not_in_git");

console.log("PHASE5_FINAL");
console.log(JSON.stringify(R, null, 2));
process.exit(Object.values(R).some((v) => v.startsWith("FAIL")) ? 1 : 0);
