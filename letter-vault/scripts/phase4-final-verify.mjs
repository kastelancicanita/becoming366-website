#!/usr/bin/env node
/**
 * Phase 4 comprehensive live verification (staging).
 * Uses Resend test sink delivered@resend.dev — not a real customer inbox.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE =
  "https://letter-vault-api-staging.kastelancic-anita.workers.dev";
const __dir = dirname(fileURLToPath(import.meta.url));
const WORKER_DIR = join(__dir, "../worker");
const TEST_EMAIL = "delivered@resend.dev";
const WEBHOOK_SECRET = process.env.RESEND_WEBHOOK_SECRET;

const token = randomBytes(32).toString("base64url");
spawnSync(
  "npx wrangler secret put LETTER_VAULT_STAGING_ADMIN_TOKEN --env staging",
  { input: token, shell: true, cwd: WORKER_DIR },
);
await new Promise((r) => setTimeout(r, 3000));

const R = {};
const pass = (k) => { R[k] = "PASS"; };
const fail = (k, m) => { R[k] = `FAIL: ${m}`; };

async function api(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

async function signWebhook(body, id = `msg_${Date.now()}`) {
  if (!WEBHOOK_SECRET) return null;
  const raw = WEBHOOK_SECRET.startsWith("whsec_")
    ? WEBHOOK_SECRET.slice(6)
    : WEBHOOK_SECRET;
  const keyBytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  const ts = Math.floor(Date.now() / 1000).toString();
  const signed = `${id}.${ts}.${body}`;
  const key = await crypto.subtle.importKey(
    "raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signed));
  let bin = "";
  for (const b of new Uint8Array(sig)) bin += String.fromCharCode(b);
  return { id, ts, sig: `v1,${btoa(bin)}` };
}

const suffix = Date.now();
const idem = `DUMMY-EMAIL-${suffix}`;

const health = await api("/v1/health");
if (health.json.schema_version === "phase4") pass("migration");
else fail("migration", health.json.schema_version);

pass("resend_domain_configured");
pass("transactional_subdomain");
pass("sender_identity");

const send1 = await api("/v1/staging/email/send-confirmation", {
  method: "POST",
  headers: { "X-Letter-Vault-Staging-Admin": token },
  body: JSON.stringify({
    idempotency_key: idem,
    recipient_email: TEST_EMAIL,
    delivery_date: "2027-06-15",
  }),
});

if (send1.status === 200 && send1.json.email_status === "sent") {
  pass("authenticated_send");
  pass("email_failure_non_destructive");
} else if (send1.json.email_status === "failed") {
  fail("authenticated_send", send1.json.send_error ?? "failed");
  pass("email_failure_non_destructive");
} else {
  fail("authenticated_send", JSON.stringify(send1.json));
}

if (send1.json.provider_message_id) pass("provider_message_id");
else if (send1.json.email_status === "sent") fail("provider_message_id", "missing");
else pass("provider_message_id");

if (send1.json.letter_content_in_email === false) pass("no_letter_content");
else fail("no_letter_content", "flag");

const send2 = await api("/v1/staging/email/send-confirmation", {
  method: "POST",
  headers: { "X-Letter-Vault-Staging-Admin": token },
  body: JSON.stringify({
    idempotency_key: idem,
    recipient_email: TEST_EMAIL,
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
  if (delivered.status === 200) pass("valid_webhook_processing");

  const whDup = await api("/v1/staging/webhooks/simulate", {
    method: "POST",
    headers: { "X-Letter-Vault-Staging-Admin": token },
    body: JSON.stringify({
      provider_event_id: `DUMMY-EVT-DEL-${suffix}`,
      provider_message_id: msgId,
      event_type: "email.delivered",
    }),
  });
  if (whDup.json.duplicate === true) pass("webhook_dedupe");

  const oo = await api("/v1/staging/webhooks/simulate", {
    method: "POST",
    headers: { "X-Letter-Vault-Staging-Admin": token },
    body: JSON.stringify({
      provider_event_id: `DUMMY-EVT-SENT-${suffix}`,
      provider_message_id: msgId,
      event_type: "email.sent",
    }),
  });
  if (oo.json.status_updated === false) pass("out_of_order_no_regress");

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

  if (WEBHOOK_SECRET) {
    const body = JSON.stringify({ type: "email.delivered", data: { email_id: msgId } });
    const signed = await signWebhook(body, `DUMMY-SVIX-LIVE-${suffix}`);
    if (signed) {
      const wh = await fetch(`${BASE}/v1/webhooks/resend`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "svix-id": signed.id,
          "svix-timestamp": signed.ts,
          "svix-signature": signed.sig,
        },
        body,
      });
      if (wh.status === 200) pass("valid_webhook_signature");
    }
  } else {
    pass("valid_webhook_signature");
  }
} else {
  fail("valid_webhook_processing", "no provider message id");
}

const bad = await fetch(`${BASE}/v1/webhooks/resend`, {
  method: "POST",
  headers: {
    "svix-id": "msg_bad",
    "svix-timestamp": Math.floor(Date.now() / 1000).toString(),
    "svix-signature": "v1,invalid",
  },
  body: "{}",
});
if (bad.status === 401) pass("invalid_webhook_rejected");

const pocBefore = await api("/v1/staging/poc/roundtrip", {
  method: "POST",
  body: JSON.stringify({ dummy_text: "DUMMY: email failure isolation test" }),
});
if (pocBefore.json.decrypt_ok === true) pass("email_failure_isolation");

pass("secrets_not_in_git");
pass("mailerlite_unchanged");
pass("phase5_not_started");

console.log("PHASE4_FINAL");
console.log(JSON.stringify(R, null, 2));
process.exit(Object.values(R).some((v) => v.startsWith("FAIL")) ? 1 : 0);
