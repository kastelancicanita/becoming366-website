#!/usr/bin/env node
/**
 * Staging E2E: management request path → UI activate URL → POST activate → session.
 * Simulates email-link prefetch (GET worker activate must not be used in email URLs).
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "https://letter-vault-api-staging.kastelancic-anita.workers.dev";
const PREVIEW_UI =
  "https://letter-vault-phase7-preview.becoming366-website.pages.dev/letter-vault/index.html";
const ORIGIN = "https://letter-vault-phase7-preview.becoming366-website.pages.dev";
const PURCHASER = "delivered@resend.dev";
const __dir = dirname(fileURLToPath(import.meta.url));
const WORKER_DIR = join(__dir, "../worker");

const token = randomBytes(32).toString("base64url");
const put = spawnSync(
  "npx wrangler secret put LETTER_VAULT_STAGING_ADMIN_TOKEN --env staging",
  { input: token, shell: true, cwd: WORKER_DIR, encoding: "utf8" },
);
if (put.status !== 0) {
  console.error("wrangler secret put failed", put.stderr || put.stdout || put.error);
  process.exit(1);
}
await new Promise((r) => setTimeout(r, 25000));

const admin = { "X-Letter-Vault-Staging-Admin": token };

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Origin: ORIGIN,
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let json = {};
  try {
    json = JSON.parse(text);
  } catch {
    json = { _raw: text };
  }
  return { status: res.status, json, headers: res.headers };
}

async function waitForAdmin(maxAttempts = 8) {
  for (let i = 0; i < maxAttempts; i++) {
    const probe = await api("/v1/staging/entitlements/issue", {
      method: "POST",
      headers: admin,
      body: JSON.stringify({
        purchaser_email: "probe@example.com",
        external_order_ref: `DUMMY-PROBE-${Date.now()}-${i}`,
        product_type: "SINGLE",
        letters_allowed: 1,
        display_title: "Probe",
      }),
    });
    if (probe.status === 200) return true;
    await new Promise((r) => setTimeout(r, 5000));
  }
  return false;
}

const adminReady = await waitForAdmin();
if (!adminReady) {
  console.error(JSON.stringify({ error: "admin_token_not_ready", admin_token_for_cli: token }, null, 2));
  process.exit(1);
}

const out = { steps: [] };

function step(name, ok, detail) {
  out.steps.push({ name, ok, detail });
}

const issue = await api("/v1/staging/entitlements/issue", {
  method: "POST",
  headers: admin,
  body: JSON.stringify({
    purchaser_email: PURCHASER,
    external_order_ref: `DUMMY-P7-MAGIC-${Date.now()}`,
    product_type: "SINGLE",
    letters_allowed: 1,
    display_title: "Single Letter",
  }),
});
step("issue_single", issue.status === 200 && issue.json.access_code, issue);

const enter = await api("/v1/vault/enter", {
  method: "POST",
  body: JSON.stringify({
    access_code: issue.json.access_code,
    purchaser_email: PURCHASER,
  }),
});
step("vault_enter", enter.status === 200, { status: enter.status });
const vaultHdr = { "X-Letter-Vault-Session": enter.json.vault_session_token };

await api("/v1/vault/single/prepare", {
  method: "POST",
  headers: vaultHdr,
  body: "{}",
});
const st = await api("/v1/vault/state", { headers: vaultHdr });
const slotId = st.json.slots?.[0]?.slot_id;
const seal = await api(`/v1/vault/slots/${slotId}/seal`, {
  method: "POST",
  headers: vaultHdr,
  body: JSON.stringify({
    letter_text: "DUMMY: magic link E2E",
    delivery_at: new Date(Date.now() + 86400000 * 400).toISOString(),
  }),
});
step("seal_letter", seal.status === 200, {
  status: seal.status,
  public_letter_id: seal.json.public_letter_id,
});

const publicLetterId = seal.json.public_letter_id;
const letterUuid = seal.json.letter_id;

const req = await api("/v1/staging/management/request", {
  method: "POST",
  body: JSON.stringify({
    letter_id: publicLetterId,
    purchaser_email: PURCHASER,
  }),
});
step("management_request", req.status === 200, { status: req.status });

const mint = await api("/v1/staging/management/test/mint-token", {
  method: "POST",
  headers: admin,
  body: JSON.stringify({ letter_id: letterUuid }),
});
const rawToken = mint.json.management_token;
step("mint_token", mint.status === 200 && rawToken, { status: mint.status });

const uiUrl = new URL(PREVIEW_UI);
uiUrl.searchParams.set("management_token", rawToken);
step(
  "ui_url_not_worker_get",
  !uiUrl.toString().includes("/v1/staging/management/activate"),
  { ui_url: uiUrl.toString() },
);

const storageBefore = await api(
  `/v1/staging/management/test/token-storage/${letterUuid}`,
  { method: "GET", headers: admin },
);
step("token_row_exists_unused", storageBefore.json.token_rows > 0, storageBefore.json);

const prefetchUi = await fetch(uiUrl.toString(), { redirect: "follow" });
step(
  "prefetch_ui_does_not_consume",
  prefetchUi.status === 200,
  { status: prefetchUi.status },
);

const storageAfterPrefetch = await api(
  `/v1/staging/management/test/token-storage/${letterUuid}`,
  { method: "GET", headers: admin },
);
const rowsAfter = storageAfterPrefetch.json.token_rows ?? 0;
const unusedAfter =
  Array.isArray(storageAfterPrefetch.json.rows) &&
  storageAfterPrefetch.json.rows.some((r) => !r.used_at);
step(
  "token_still_unused_after_ui_prefetch",
  rowsAfter > 0 && storageBefore.json.token_rows === rowsAfter,
  storageAfterPrefetch.json,
);

const activate = await api("/v1/staging/management/activate", {
  method: "POST",
  body: JSON.stringify({ token: rawToken }),
});
step(
  "post_activate",
  activate.status === 200 &&
    activate.json.status === "ok" &&
    activate.json.session_token,
  { status: activate.status, public_letter_id: activate.json.public_letter_id },
);

const sessionView = await api("/v1/staging/management/session", {
  headers: {
    "X-Letter-Vault-Management-Session": activate.json.session_token,
  },
});
step(
  "session_view",
  sessionView.status === 200 && sessionView.json.status === "ok",
  { status: sessionView.status, letter_id: sessionView.json.public_letter_id },
);

const deliveryReq = await api("/v1/staging/management/delivery-email/request", {
  method: "POST",
  headers: {
    "X-Letter-Vault-Management-Session": activate.json.session_token,
  },
  body: JSON.stringify({
    new_delivery_email: "delivered@resend.dev",
    delivery_email_mode: "surprise",
  }),
});
step(
  "delivery_email_screen_available",
  deliveryReq.status === 200,
  { status: deliveryReq.status, mode: deliveryReq.json.delivery_email_mode },
);

out.all_passed = out.steps.every((s) => s.ok);

const anitaIssue = await api("/v1/staging/entitlements/issue", {
  method: "POST",
  headers: admin,
  body: JSON.stringify({
    purchaser_email: PURCHASER,
    external_order_ref: `DUMMY-P7-ANITA-${Date.now()}`,
    product_type: "SINGLE",
    letters_allowed: 1,
    display_title: "Single Letter",
  }),
});
out.fresh_single_for_anita = {
  purchaser_email: PURCHASER,
  access_code: anitaIssue.json.access_code ?? null,
  issue_status: anitaIssue.status,
  admin_token_for_scripts: token,
  note: "Unsealed — seal letter, then Manage my Vault → SEND ME A SECURE LINK",
};

console.log(JSON.stringify(out, null, 2));
process.exit(out.all_passed ? 0 : 1);
