import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyDeliveryEmailUpdate,
  customerDeliveryEmailCapabilities,
} from "../src/lib/delivery-email-update";
import {
  SURPRISE_DELIVERY_ENABLED_VALUE,
  evaluateRecipientBodyDelivery,
  isSurpriseDeliveryFeatureEnabled,
  isSurpriseDeliveryEmailChoiceAllowed,
  surpriseDeliveryUnavailableMessage,
  surpriseRecipientDeliveryStatus,
} from "../src/lib/surprise-delivery-policy";
import { SURPRISE_PERSONAL_DECLARATION_TEXT } from "../src/lib/surprise-declaration";
import type { Env } from "../src/env";
import type { LetterRow } from "../src/db/letters";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const LETTER_VAULT_ROOT = join(TEST_DIR, "..", "..");

const letterIdA = "00000000-0000-4000-8000-000000000001";
const letterIdB = "00000000-0000-4000-8000-000000000002";

function productionEnv(overrides: Partial<Env> = {}): Env {
  return { VAULT_ENV: "production", ...overrides };
}

function letterRow(id = letterIdA): LetterRow {
  return {
    id,
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

describe("8B-10 S5 SURPRISE_DELIVERY_ENABLED gate", () => {
  it("accepts only explicit true (case-insensitive trim)", () => {
    expect(isSurpriseDeliveryFeatureEnabled(productionEnv())).toBe(false);
    expect(
      isSurpriseDeliveryFeatureEnabled(
        productionEnv({ SURPRISE_DELIVERY_ENABLED: undefined }),
      ),
    ).toBe(false);
    expect(
      isSurpriseDeliveryFeatureEnabled(
        productionEnv({ SURPRISE_DELIVERY_ENABLED: "" }),
      ),
    ).toBe(false);
    expect(
      isSurpriseDeliveryFeatureEnabled(
        productionEnv({ SURPRISE_DELIVERY_ENABLED: "TRUE" }),
      ),
    ).toBe(true);
    expect(
      isSurpriseDeliveryFeatureEnabled(
        productionEnv({ SURPRISE_DELIVERY_ENABLED: " true " }),
      ),
    ).toBe(true);
    expect(
      isSurpriseDeliveryFeatureEnabled(
        productionEnv({ SURPRISE_DELIVERY_ENABLED: "1" }),
      ),
    ).toBe(false);
    expect(
      isSurpriseDeliveryFeatureEnabled(
        productionEnv({ SURPRISE_DELIVERY_ENABLED: "yes" }),
      ),
    ).toBe(false);
    expect(SURPRISE_DELIVERY_ENABLED_VALUE).toBe("true");
  });

  it("blocks production Surprise when flag is missing or OFF", () => {
    expect(isSurpriseDeliveryEmailChoiceAllowed(productionEnv())).toBe(false);
    expect(
      customerDeliveryEmailCapabilities(productionEnv()),
    ).toEqual({
      surprise_delivery_email_available: false,
      surprise_delivery_feature_flag_enabled: false,
      surprise_unavailable_message: surpriseDeliveryUnavailableMessage(),
      surprise_declaration_text: null,
    });
    expect(
      evaluateRecipientBodyDelivery(productionEnv(), {
        recipient_email: "child@example.com",
        delivery_email_verified_at: null,
        delivery_email_mode: "surprise",
      }),
    ).toEqual({
      allowed: false,
      reason: "surprise_resend_blocked_production",
    });
    expect(
      surpriseRecipientDeliveryStatus(productionEnv(), "surprise"),
    ).toBe("blocked_pending_compliant_provider");
  });

  it("unlocks production Surprise only when flag is ON", () => {
    const enabled = productionEnv({ SURPRISE_DELIVERY_ENABLED: "true" });
    expect(isSurpriseDeliveryEmailChoiceAllowed(enabled)).toBe(true);
    expect(customerDeliveryEmailCapabilities(enabled)).toEqual({
      surprise_delivery_email_available: true,
      surprise_delivery_feature_flag_enabled: true,
      surprise_unavailable_message: null,
      surprise_declaration_text: SURPRISE_PERSONAL_DECLARATION_TEXT,
    });
    expect(
      evaluateRecipientBodyDelivery(enabled, {
        recipient_email: "child@example.com",
        delivery_email_verified_at: null,
        delivery_email_mode: "surprise",
      }),
    ).toEqual({ allowed: true, providerId: "mailersend" });
    expect(surpriseRecipientDeliveryStatus(enabled, "surprise")).toBe(
      "surprise_mode",
    );
  });

  it("does not require the flag in staging", () => {
    expect(
      isSurpriseDeliveryEmailChoiceAllowed({ VAULT_ENV: "staging" }),
    ).toBe(true);
  });
});

describe("8B-10 S5 API bypass while flag OFF", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects direct surprise save in production when flag is OFF", async () => {
    const res = await applyDeliveryEmailUpdate(
      productionEnv(),
      new Request("https://example.com/v1/vault/delivery-email"),
      letterRow(),
      "child@example.com",
      "surprise",
      { surprisePersonalDeclarationAccepted: true },
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: string };
    expect(json.error).toBe("surprise_unavailable");
  });
});

describe("8B-10 S5 safeguards still enforced when flag ON", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires declaration in production when flag is ON", async () => {
    const res = await applyDeliveryEmailUpdate(
      productionEnv({ SURPRISE_DELIVERY_ENABLED: "true" }),
      new Request("https://example.com/v1/vault/delivery-email"),
      letterRow(),
      "child@example.com",
      "surprise",
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: string };
    expect(json.error).toBe("surprise_declaration_required");
  });

  it("accepts production surprise save with declaration when flag is ON", async () => {
    const res = await applyDeliveryEmailUpdate(
      productionEnv({ SURPRISE_DELIVERY_ENABLED: "true" }),
      new Request("https://example.com/v1/vault/delivery-email"),
      letterRow(),
      "friend@gmail.com",
      "surprise",
      { surprisePersonalDeclarationAccepted: true },
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { status?: string; delivery_email_mode?: string };
    expect(json.status).toBe("ok");
    expect(json.delivery_email_mode).toBe("surprise");
  });
});

describe("8B-10 S5 Verify Now unchanged", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts verify_now in production regardless of flag", async () => {
    const res = await applyDeliveryEmailUpdate(
      productionEnv({ RESEND_API_KEY: "re_test" }),
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

describe("8B-10 S5 collection letters keep one recipient per letter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows different recipient emails on separate letters in one entitlement", async () => {
    const enabled = productionEnv({
      SURPRISE_DELIVERY_ENABLED: "true",
      RESEND_API_KEY: "re_test",
    });
    const resA = await applyDeliveryEmailUpdate(
      enabled,
      new Request("https://example.com/v1/vault/delivery-email"),
      letterRow(letterIdA),
      "daughter@gmail.com",
      "surprise",
      { surprisePersonalDeclarationAccepted: true },
    );
    const resB = await applyDeliveryEmailUpdate(
      enabled,
      new Request("https://example.com/v1/vault/delivery-email"),
      letterRow(letterIdB),
      "son@gmail.com",
      "verify_now",
    );
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    const jsonA = (await resA.json()) as { delivery_email_mode?: string };
    const jsonB = (await resB.json()) as { pending_verification?: boolean };
    expect(jsonA.delivery_email_mode).toBe("surprise");
    expect(jsonB.pending_verification).toBe(true);
  });
});

describe("8B-10 S5 UI wiring", () => {
  it("drives Surprise visibility from API capabilities, not hardcoded production", () => {
    const manageJs = readFileSync(join(LETTER_VAULT_ROOT, "js", "manage.js"), "utf8");
    const appJs = readFileSync(join(LETTER_VAULT_ROOT, "js", "app.js"), "utf8");
    expect(manageJs).toContain("surprise_delivery_email_available");
    expect(manageJs).toContain("applySurpriseModeUi");
    expect(manageJs).toContain("surprise_personal_declaration_accepted");
    expect(appJs).toContain("applyDeliveryCapabilities");
    expect(appJs).toContain("surprise_delivery_email_available");
  });

  it("does not set SURPRISE_DELIVERY_ENABLED in production wrangler vars", () => {
    const wrangler = readFileSync(
      join(TEST_DIR, "..", "wrangler.toml"),
      "utf8",
    );
    expect(wrangler).toContain("SURPRISE_DELIVERY_ENABLED intentionally omitted");
    expect(wrangler).not.toMatch(
      /\[env\.production\][\s\S]*SURPRISE_DELIVERY_ENABLED\s*=\s*"true"/,
    );
  });
});
