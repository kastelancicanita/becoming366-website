#!/usr/bin/env node
/**
 * Staging API seal smoke test for Phase 7 UX pass.
 * Does not weaken security — uses issued dummy entitlement only.
 */
const BASE = "https://letter-vault-api-staging.kastelancic-anita.workers.dev";

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, opts);
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function main() {
  const enter = await api("/v1/vault/enter", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://becoming366-website.pages.dev" },
    body: JSON.stringify({
      access_code: process.env.LV_ACCESS_CODE || "LV-i9ejAO7AZ3ttSXQW1ZMLZPbW916dANt2",
      purchaser_email: process.env.LV_EMAIL || "vault-collection@example.com",
    }),
  });
  console.log("ENTER", enter.status, enter.json.status, enter.json.message || "");
  if (enter.status !== 200) process.exit(1);

  const session = enter.json.vault_session_token;
  const hdr = {
    "Content-Type": "application/json",
    "X-Letter-Vault-Session": session,
    Origin: "https://becoming366-website.pages.dev",
  };

  let slots = enter.json.slots || [];
  if (enter.json.needs_collection_init) {
    const options = await api("/v1/vault/collection/milestone-options", {
      method: "POST",
      headers: hdr,
      body: JSON.stringify({ base_date: "2010-06-15" }),
    });
    const selected = (options.json.future_valid_options || [])
      .slice(0, 5)
      .map((o) => o.age);
    const init = await api("/v1/vault/collection/init", {
      method: "POST",
      headers: hdr,
      body: JSON.stringify({
        base_date: "2010-06-15",
        shared_recipient_context: { relationship: "My daughter" },
        selected_milestone_ages: selected,
      }),
    });
    console.log("INIT", init.status, init.json.slots?.length || init.json.message);
    slots = init.json.slots || [];
  }

  const open = slots.find((s) => s.slot_status === "UNWRITTEN");
  if (!open) {
    console.log("NO_OPEN_SLOTS", slots.map((s) => s.slot_status));
    process.exit(0);
  }

  console.log("SLOT", open.moment_label, formatDate(open.delivery_at));

  await api("/v1/vault/slots/" + open.slot_id, {
    method: "PATCH",
    headers: hdr,
    body: JSON.stringify({
      delivery_at: open.delivery_at,
      recipient_context: { relationship: "My daughter" },
      moment_label: open.moment_label,
    }),
  });

  const seal = await api("/v1/vault/slots/" + open.slot_id + "/seal", {
    method: "POST",
    headers: hdr,
    body: JSON.stringify({
      letter_text: "DUMMY: Phase 7 UX verify " + new Date().toISOString(),
      delivery_at: open.delivery_at,
      recipient_context: { relationship: "My daughter" },
      moment_label: open.moment_label,
    }),
  });
  console.log("SEAL", seal.status, seal.json.status, seal.json.public_letter_id || seal.json.message);
  process.exit(seal.status === 200 && seal.json.status === "ok" ? 0 : 1);
}

function formatDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
