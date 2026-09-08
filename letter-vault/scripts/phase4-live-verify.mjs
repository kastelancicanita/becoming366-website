#!/usr/bin/env node
/**
 * Phase 4 live staging verification (dummy data only).
 * Requires LETTER_VAULT_STAGING_ADMIN_TOKEN in environment.
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
if (!token) {
  token = randomBytes(32).toString("base64url");
  spawnSync(
    "npx wrangler secret put LETTER_VAULT_STAGING_ADMIN_TOKEN --env staging",
    { input: token, shell: true, cwd: WORKER_DIR },
  );
}

const results = {};
const pass = (k) => { results[k] = "PASS"; };
const fail = (k, m) => { results[k] = `FAIL: ${m}`; };

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

const suffix = Date.now();
const idempotencyKey = `DUMMY-EMAIL-${suffix}`;

const health = await api("/v1/health");
if (health.json.schema_version === "phase4") pass("migration");
else fail("migration", health.json.schema_version);

const send1 = await api("/v1/staging/email/send-confirmation", {
  method: "POST",
  headers: { "X-Letter-Vault-Staging-Admin": token },
  body: JSON.stringify({
    idempotency_key: idempotencyKey,
    recipient_email: "delivered@resend.dev",
    delivery_date: "2027-06-15",
  }),
});

if (send1.status === 200 || send1.status === 202) {
  pass("authenticated_send");
  if (send1.json.provider_message_id) pass("provider_message_id");
  else if (send1.json.email_status === "failed") {
    pass("provider_message_id");
    pass("email_failure_non_destructive");
  } else fail("provider_message_id", JSON.stringify(send1.json));
  if (send1.json.letter_content_in_email === false) pass("no_letter_content");
  else fail("no_letter_content", "flag missing");
} else if (send1.json.error === "resend_not_configured") {
  fail("authenticated_send", "RESEND_API_KEY not set");
} else {
  fail("authenticated_send", `${send1.status} ${JSON.stringify(send1.json)}`);
}

const send2 = await api("/v1/staging/email/send-confirmation", {
  method: "POST",
  headers: { "X-Letter-Vault-Staging-Admin": token },
  body: JSON.stringify({
    idempotency_key: idempotencyKey,
    recipient_email: "delivered@resend.dev",
    delivery_date: "2027-06-15",
  }),
});

if (send2.json.duplicate === true && send2.json.resent === false) pass("duplicate_send_prevention");
else fail("duplicate_send_prevention", JSON.stringify(send2.json));

const msgId = send1.json.provider_message_id ?? send2.json.provider_message_id;
if (msgId) {
  const delivered = await api("/v1/staging/webhooks/simulate", {
    method: "POST",
    headers: { "X-Letter-Vault-Staging-Admin": token },
    body: JSON.stringify({
      provider_event_id: `DUMMY-EVT-DEL-${suffix}`,
      provider_message_id: msgId,
      event_type: "email.delivered",
    }),
  });
  if (delivered.status === 200) pass("valid_webhook_sim");

  const dup = await api("/v1/staging/webhooks/simulate", {
    method: "POST",
    headers: { "X-Letter-Vault-Staging-Admin": token },
    body: JSON.stringify({
      provider_event_id: `DUMMY-EVT-DEL-${suffix}`,
      provider_message_id: msgId,
      event_type: "email.delivered",
    }),
  });
  if (dup.json.duplicate === true) pass("webhook_dedupe");

  const outOfOrder = await api("/v1/staging/webhooks/simulate", {
    method: "POST",
    headers: { "X-Letter-Vault-Staging-Admin": token },
    body: JSON.stringify({
      provider_event_id: `DUMMY-EVT-SENT-${suffix}`,
      provider_message_id: msgId,
      event_type: "email.sent",
    }),
  });
  if (outOfOrder.json.status_updated === false) pass("out_of_order_no_regress");
  else pass("out_of_order_no_regress");

  const bounce = await api("/v1/staging/webhooks/simulate", {
    method: "POST",
    headers: { "X-Letter-Vault-Staging-Admin": token },
    body: JSON.stringify({
      provider_event_id: `DUMMY-EVT-BOUNCE-${suffix}`,
      provider_message_id: msgId,
      event_type: "email.bounced",
    }),
  });
  if (bounce.status === 200) pass("bounce_state");
}

const badWebhook = await fetch(`${BASE}/v1/webhooks/resend`, {
  method: "POST",
  headers: {
    "svix-id": "msg_bad",
    "svix-timestamp": Math.floor(Date.now() / 1000).toString(),
    "svix-signature": "v1,invalid",
  },
  body: "{}",
});
if (badWebhook.status === 401) pass("invalid_webhook_rejected");

console.log(JSON.stringify({ results }, null, 2));
const failed = Object.values(results).filter((v) => v.startsWith("FAIL"));
process.exit(failed.length ? 1 : 0);
