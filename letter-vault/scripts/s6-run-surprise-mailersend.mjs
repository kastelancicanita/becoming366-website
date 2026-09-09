#!/usr/bin/env node
/**
 * S6: backdate LV letter, run scheduler, verify MailerSend outbound.
 */
const BASE =
  "https://letter-vault-api-staging.kastelancic-anita.workers.dev";

const token = process.env.LETTER_VAULT_STAGING_ADMIN_TOKEN;
const PUBLIC_ID = process.argv[2] ?? "LV-20E0B6E6";
const PURCHASER = process.argv[3] ?? "vault-p7-single@example.com";

if (!token) {
  console.error("Set LETTER_VAULT_STAGING_ADMIN_TOKEN");
  process.exit(1);
}

const admin = {
  "Content-Type": "application/json",
  "X-Letter-Vault-Staging-Admin": token,
};

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { ...admin, ...(opts.headers ?? {}) },
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function main() {
  const before = await api(
    `/v1/staging/letters/by-public-id?public_letter_id=${encodeURIComponent(PUBLIC_ID)}&purchaser_email=${encodeURIComponent(PURCHASER)}`,
  );
  console.log("BEFORE", JSON.stringify(before, null, 2));
  if (before.status !== 200) process.exit(1);

  const backdate = await api("/v1/staging/letters/backdate-delivery", {
    method: "POST",
    body: JSON.stringify({
      public_letter_id: PUBLIC_ID,
      purchaser_email: PURCHASER,
      minutes_ago: 10,
    }),
  });
  console.log("BACKDATE", JSON.stringify(backdate, null, 2));
  if (backdate.status !== 200) process.exit(1);

  await new Promise((r) => setTimeout(r, 2000));

  const sched = await api("/v1/staging/scheduler/run", { method: "POST" });
  console.log("SCHEDULER", JSON.stringify(sched, null, 2));

  await new Promise((r) => setTimeout(r, 3000));

  const after = await api(
    `/v1/staging/letters/by-public-id?public_letter_id=${encodeURIComponent(PUBLIC_ID)}&purchaser_email=${encodeURIComponent(PURCHASER)}`,
  );
  console.log("AFTER", JSON.stringify(after, null, 2));

  const letter = after.json.letter ?? {};
  const attempts = after.json.delivery_attempts ?? [];
  const mailersend = attempts.some((a) => a.provider === "mailersend");
  const sent = letter.status === "SENT" || letter.status === "DELIVERED";

  console.log(
    JSON.stringify(
      {
        s6_surprise_saved: Boolean(letter.recipient_email),
        s6_letter_sent: sent,
        s6_mailersend_provider: mailersend,
        s6_provider_message_id: letter.provider_message_id ?? null,
        s6_scheduler: sched.json,
      },
      null,
      2,
    ),
  );

  process.exit(sent && mailersend ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
