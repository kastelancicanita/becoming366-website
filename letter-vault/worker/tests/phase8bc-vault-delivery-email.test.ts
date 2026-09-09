import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyDeliveryEmailUpdate,
  customerDeliveryEmailCapabilities,
} from "../src/lib/delivery-email-update";
import {
  isSurpriseDeliveryEmailChoiceAllowed,
  surpriseDeliveryUnavailableMessage,
} from "../src/lib/surprise-delivery-policy";
import type { Env } from "../src/env";
import type { LetterRow } from "../src/db/letters";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const LETTER_VAULT_ROOT = join(TEST_DIR, "..", "..");

const letterId = "00000000-0000-4000-8000-000000000001";

function letterRow(): LetterRow {
  return {
    id: letterId,
    label: "test",
    purchaser_email: "buyer@example.com",
    recipient_email: null,
    delivery_at: new Date(Date.now() + 3600_000).toISOString(),
    delivery_timezone: "UTC",
    status: "SEALED",
    delivery_email_verified_at: null,
    delivery_email_mode: "verified",
    ciphertext_b64: "abc",
    ciphertext_nonce_b64: "n",
    wrapped_dek_b64: "w",
    wrap_nonce_b64: "wn",
    master_key_version: "v1",
    content_hash: "hash",
    processing_lease_until: null,
    processing_claimed_by: null,
    attempt_count: 0,
    max_attempts: 3,
    entitlement_ref: "ent-1",
    last_error_category: null,
    provider_message_id: null,
    sent_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

vi.mock("../src/db/management", () => ({
  activateSurpriseDeliveryEmail: vi.fn(async () => undefined),
  auditDeliveryEmail: vi.fn(async () => undefined),
  createDeliveryEmailChange: vi.fn(async () => undefined),
}));

vi.mock("../src/db/surprise-declaration", () => ({
  recordSurpriseDeclaration: vi.fn(async () => undefined),
  fetchSurpriseDeclaration: vi.fn(async () => null),
  deferSurpriseLetterForSafeguard: vi.fn(async () => undefined),
}));

vi.mock("../src/email/resend-client", () => ({
  sendViaResend: vi.fn(async () => ({ ok: true, providerMessageId: "msg-1" })),
}));

describe("surprise delivery email choice", () => {
  it("allows surprise in staging", () => {
    expect(
      isSurpriseDeliveryEmailChoiceAllowed({ VAULT_ENV: "staging" }),
    ).toBe(true);
  });

  it("blocks surprise in production", () => {
    expect(
      isSurpriseDeliveryEmailChoiceAllowed({ VAULT_ENV: "production" }),
    ).toBe(false);
    expect(customerDeliveryEmailCapabilities({ VAULT_ENV: "production" })).toEqual({
      surprise_delivery_email_available: false,
      surprise_delivery_feature_flag_enabled: false,
      surprise_unavailable_message: surpriseDeliveryUnavailableMessage(),
      surprise_declaration_text: null,
    });
  });
});

describe("applyDeliveryEmailUpdate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects surprise mode in production", async () => {
    const res = await applyDeliveryEmailUpdate(
      { VAULT_ENV: "production" } as Env,
      new Request("https://example.com/v1/vault/delivery-email"),
      letterRow(),
      "child@example.com",
      "surprise",
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: string };
    expect(json.error).toBe("surprise_unavailable");
  });

  it("rejects staging surprise without declaration", async () => {
    const res = await applyDeliveryEmailUpdate(
      { VAULT_ENV: "staging" } as Env,
      new Request("https://example.com/v1/vault/delivery-email"),
      letterRow(),
      "child@example.com",
      "surprise",
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: string };
    expect(json.error).toBe("surprise_declaration_required");
  });

  it("accepts verify_now in production", async () => {
    const res = await applyDeliveryEmailUpdate(
      { VAULT_ENV: "production", RESEND_API_KEY: "re_test" } as Env,
      new Request("https://example.com/v1/vault/delivery-email"),
      letterRow(),
      "child@example.com",
      "verify_now",
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { status?: string; pending_verification?: boolean };
    expect(json.status).toBe("ok");
    expect(json.pending_verification).toBe(true);
  });
});

describe("vault session delivery email UI regression", () => {
  it("routes active vault session to vault delivery endpoint", () => {
    const manageJs = readFileSync(
      join(LETTER_VAULT_ROOT, "js", "manage.js"),
      "utf8",
    );
    expect(manageJs).toContain("openVaultDeliveryEmail");
    expect(manageJs).toContain('authChannel === "vault"');
    expect(manageJs).toContain('"/v1/vault/delivery-email"');
    expect(manageJs).toContain("hasActiveVaultSession()");
  });

  it("hides surprise mode when API reports surprise unavailable", () => {
    const manageJs = readFileSync(
      join(LETTER_VAULT_ROOT, "js", "manage.js"),
      "utf8",
    );
    expect(manageJs).toContain("surprise_delivery_email_available");
    expect(manageJs).toContain("applySurpriseModeUi");
    expect(manageJs).toContain("mgmt-surprise-unavailable");
    expect(manageJs).toContain("mgmt-surprise-declaration");
  });
});
