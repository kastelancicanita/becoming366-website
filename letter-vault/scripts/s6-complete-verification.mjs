#!/usr/bin/env node
/**
 * S6 final verification: MailerSend webhook state, Verify Now → Resend, production dry-run names.
 */
const STAGING =
  "https://letter-vault-api-staging.kastelancic-anita.workers.dev";
const PRODUCTION =
  "https://letter-vault-api-production.kastelancic-anita.workers.dev";
const ORIGIN =
  "https://letter-vault-phase7-preview.becoming366-website.pages.dev";

const token = process.env.LETTER_VAULT_STAGING_ADMIN_TOKEN;
if (!token) {
  console.error("Missing LETTER_VAULT_STAGING_ADMIN_TOKEN");
  process.exit(1);
}

const admin = {
  "Content-Type": "application/json",
  "X-Letter-Vault-Staging-Admin": token,
};

async function api(base, path, opts = {}) {
  const res = await fetch(base + path, {
    ...opts,
    headers: {
      ...admin,
      Origin: ORIGIN,
      ...(opts.headers ?? {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

const report = {
  surprise_letter: "LV-20E0B6E6",
  mailersend_webhook: {},
  verify_now_resend: {},
  production_dry_run: {},
};

const surprise = await api(
  STAGING,
  `/v1/staging/letters/by-public-id?public_letter_id=LV-20E0B6E6&purchaser_email=${encodeURIComponent("vault-p7-single@example.com")}`,
  { headers: { ...admin } },
);
const letter = surprise.json.letter ?? {};
const outbound = surprise.json.outbound_emails ?? [];
const future = outbound.find((o) => o.email_type === "future_delivery");

report.mailersend_webhook = {
  letter_status: letter.status ?? null,
  provider_message_id: letter.provider_message_id ?? null,
  future_delivery_provider: future?.provider ?? null,
  future_delivery_status: future?.status ?? null,
  outbound_count: outbound.length,
  pass:
    letter.status === "DELIVERED" || letter.status === "SENT"
      ? future?.provider === "mailersend"
      : false,
  delivered: letter.status === "DELIVERED",
};

const issue = await api(STAGING, "/v1/staging/entitlements/issue", {
  method: "POST",
  body: JSON.stringify({
    purchaser_email: "vault-p7-verify-now@example.com",
    external_order_ref: `DUMMY-S6-VERIFY-${Date.now()}`,
    product_type: "SINGLE",
    letters_allowed: 1,
    display_title: "S6 Verify Now",
  }),
});

const enter = await api(STAGING, "/v1/vault/enter", {
  method: "POST",
  body: JSON.stringify({
    access_code: issue.json.access_code,
    purchaser_email: "vault-p7-verify-now@example.com",
  }),
});

const vaultHdr = {
  "Content-Type": "application/json",
  "X-Letter-Vault-Session": enter.json.vault_session_token,
};

await api(STAGING, "/v1/vault/single/prepare", {
  method: "POST",
  headers: vaultHdr,
  body: "{}",
});
const st = await api(STAGING, "/v1/vault/state", { headers: vaultHdr });
const slotId = st.json.slots?.[0]?.slot_id;
const seal = await api(STAGING, `/v1/vault/slots/${slotId}/seal`, {
  method: "POST",
  headers: vaultHdr,
  body: JSON.stringify({
    letter_text: "DUMMY: S6 verify now Resend path",
    delivery_at: new Date(Date.now() + 86400000 * 400).toISOString(),
  }),
});

const publicId = seal.json.public_letter_id;
const verifySave = await api(STAGING, "/v1/vault/delivery-email", {
  method: "POST",
  headers: vaultHdr,
  body: JSON.stringify({
    public_letter_id: publicId,
    delivery_email: "delivered@resend.dev",
    delivery_email_mode: "verify_now",
  }),
});

const verifyLookup = await api(
  STAGING,
  `/v1/staging/letters/by-public-id?public_letter_id=${encodeURIComponent(publicId)}&purchaser_email=${encodeURIComponent("vault-p7-verify-now@example.com")}`,
);

const verifyOutbound = verifyLookup.json.outbound_emails ?? [];
const mailersendOnVerify = verifyOutbound.some((o) => o.provider === "mailersend");

report.verify_now_resend = {
  public_letter_id: publicId ?? null,
  save_status: verifySave.status,
  save_ok: verifySave.json.status === "ok",
  pending_verification: verifySave.json.pending_verification === true,
  mailersend_outbound_on_verify_letter: mailersendOnVerify,
  pass:
    verifySave.status === 200 &&
    verifySave.json.status === "ok" &&
    verifySave.json.pending_verification === true &&
    !mailersendOnVerify,
};

const prodHealth = await fetch(`${PRODUCTION}/v1/health`).then((r) => r.json());
report.production_dry_run = {
  health_ok: prodHealth.status === "ok",
  environment: prodHealth.environment ?? null,
  schema_version: prodHealth.schema_version ?? null,
  surprise_delivery_schema: prodHealth.surprise_delivery_schema ?? "not_exposed_on_production",
  required_secret_names_only: [
    "MAILERSEND_API_TOKEN",
    "MAILERSEND_SURPRISE_FROM_EMAIL",
    "MAILERSEND_SURPRISE_FROM_NAME",
    "MAILERSEND_WEBHOOK_SECRET",
    "SURPRISE_DELIVERY_ENABLED",
  ],
  production_surprise_must_remain: "unset or not exactly true",
  production_cron: "OFF (no triggers in wrangler production env)",
  no_production_deploy_in_s6: true,
  pass: prodHealth.environment === "production",
};

console.log("S6_COMPLETE_VERIFICATION");
console.log(JSON.stringify(report, null, 2));

const allPass =
  report.mailersend_webhook.pass &&
  report.verify_now_resend.pass &&
  report.production_dry_run.pass;

process.exit(allPass ? 0 : 1);
