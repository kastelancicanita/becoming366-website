import { describe, expect, it, vi, afterEach } from "vitest";
import type { LetterRow } from "../src/db/letters";
import type { Env } from "../src/env";

const deferSurpriseLetterForSafeguard = vi.fn(async () => {});
const fetchSurpriseDeclaration = vi.fn(async () => null as null);
const auditDeliveryEmail = vi.fn(async () => {});

vi.mock("../src/db/recipient-suppression", () => ({
  isRecipientSuppressed: vi.fn(async () => false),
  upsertRecipientSuppression: vi.fn(async () => {}),
}));

vi.mock("../src/db/surprise-declaration", () => ({
  deferSurpriseLetterForSafeguard: (...args: unknown[]) =>
    deferSurpriseLetterForSafeguard(...args),
  fetchSurpriseDeclaration: (...args: unknown[]) =>
    fetchSurpriseDeclaration(...args),
  recordSurpriseDeclaration: vi.fn(async () => {}),
}));

vi.mock("../src/db/management", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/db/management")>();
  return {
    ...actual,
    auditDeliveryEmail: (...args: unknown[]) => auditDeliveryEmail(...args),
  };
});

import {
  evaluateSurpriseSaveSafeguards,
  evaluateSurpriseSendGate,
  evaluateSurpriseSendSafeguards,
  validateSingleSurpriseRecipient,
} from "../src/lib/surprise-anti-abuse";
import {
  SURPRISE_PERSONAL_DECLARATION_TEXT,
  isSurprisePersonalDeclarationAccepted,
} from "../src/lib/surprise-declaration";
import { deferSurpriseSendIfBlocked } from "../src/delivery/scheduler";
import { sendViaMailerSend } from "../src/email/mailersend-client";
import { applyDeliveryEmailUpdate } from "../src/lib/delivery-email-update";

function stagingEnv(overrides: Partial<Env> = {}): Env {
  return { VAULT_ENV: "staging", ...overrides };
}

function surpriseLetter(overrides: Partial<LetterRow> = {}): LetterRow {
  return {
    id: "letter-uuid-1",
    label: "test",
    purchaser_email: "buyer@example.com",
    recipient_email: "friend@example.com",
    delivery_at: new Date(Date.now() - 60_000).toISOString(),
    delivery_timezone: "UTC",
    status: "SEALED",
    delivery_email_verified_at: null,
    delivery_email_mode: "surprise",
    ciphertext_b64: "x",
    ciphertext_nonce_b64: "x",
    wrapped_dek_b64: "x",
    wrap_nonce_b64: "x",
    master_key_version: "v1",
    content_hash: "x",
    processing_lease_until: null,
    processing_claimed_by: null,
    attempt_count: 0,
    max_attempts: 3,
    entitlement_ref: null,
    last_error_category: null,
    provider_message_id: null,
    sent_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("8B-10 S3 purchaser declaration", () => {
  it("uses the approved personal/non-commercial semantic lock", () => {
    expect(SURPRISE_PERSONAL_DECLARATION_TEXT).toContain("one person I personally know");
    expect(SURPRISE_PERSONAL_DECLARATION_TEXT).toContain("not marketing");
    expect(SURPRISE_PERSONAL_DECLARATION_TEXT.toLowerCase()).not.toContain("permission");
    expect(SURPRISE_PERSONAL_DECLARATION_TEXT.toLowerCase()).not.toContain("opt-in");
    expect(SURPRISE_PERSONAL_DECLARATION_TEXT.toLowerCase()).not.toContain("consent");
  });

  it("requires explicit acceptance", () => {
    expect(isSurprisePersonalDeclarationAccepted(true)).toBe(true);
    expect(isSurprisePersonalDeclarationAccepted(false)).toBe(false);
    expect(isSurprisePersonalDeclarationAccepted(undefined)).toBe(false);
  });

  it("blocks surprise save without declaration", () => {
    const result = evaluateSurpriseSaveSafeguards({
      env: stagingEnv(),
      email: "friend@example.com",
      declarationAccepted: false,
    });
    expect(result).toEqual({ ok: false, code: "surprise_declaration_required" });
  });
});

describe("8B-10 S3 recipient safeguards", () => {
  it("accepts exactly one recipient email", () => {
    expect(validateSingleSurpriseRecipient("friend@example.com")).toEqual({
      ok: true,
      email: "friend@example.com",
    });
  });

  it("rejects CC/BCC/list patterns", () => {
    expect(validateSingleSurpriseRecipient("a@example.com,b@example.com").ok).toBe(
      false,
    );
    expect(validateSingleSurpriseRecipient("bcc:friend@example.com").ok).toBe(
      false,
    );
  });

  it("blocks production dummy/test domains for Surprise", () => {
    const result = evaluateSurpriseSaveSafeguards({
      env: stagingEnv({ VAULT_ENV: "production" }),
      email: "delivered@resend.dev",
      declarationAccepted: true,
    });
    expect(result).toEqual({ ok: false, code: "surprise_test_domain_blocked" });
  });
});

describe("8B-10 S3 send-time gate", () => {
  it("requires stored declaration before send", async () => {
    const gate = await evaluateSurpriseSendGate(
      stagingEnv(),
      surpriseLetter(),
      async () => null,
    );
    expect(gate).toEqual({
      allowed: false,
      errorCategory: "surprise_declaration_missing",
      auditEmail: "friend@example.com",
    });
  });

  it("allows send when declaration exists and recipient is valid", async () => {
    const gate = await evaluateSurpriseSendGate(
      stagingEnv(),
      surpriseLetter(),
      async () => ({
        declaration_version: "2026-09-v1",
        accepted_at: "2026-09-09T00:00:00.000Z",
      }),
    );
    expect(gate).toEqual({ allowed: true });
  });

  it("passes through verified letters without declaration lookup", async () => {
    const fetchMock = vi.fn(async () => null);
    const gate = await evaluateSurpriseSendGate(
      stagingEnv(),
      surpriseLetter({
        delivery_email_mode: "verified",
        delivery_email_verified_at: "2026-01-01T00:00:00.000Z",
      }),
      fetchMock,
    );
    expect(gate).toEqual({ allowed: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("8B-10 S3 scheduler defer without abandoning letter", () => {
  afterEach(() => {
    deferSurpriseLetterForSafeguard.mockClear();
    auditDeliveryEmail.mockClear();
    fetchSurpriseDeclaration.mockReset();
    fetchSurpriseDeclaration.mockResolvedValue(null);
  });

  it("defers due Surprise without declaration and preserves for retry", async () => {
    const blocked = await deferSurpriseSendIfBlocked(stagingEnv(), surpriseLetter());
    expect(blocked).toBe(true);
    expect(deferSurpriseLetterForSafeguard).toHaveBeenCalledWith(
      stagingEnv(),
      "letter-uuid-1",
      "surprise_declaration_missing",
    );
    expect(auditDeliveryEmail).toHaveBeenCalled();
  });

  it("does not defer verified letters", async () => {
    const blocked = await deferSurpriseSendIfBlocked(
      stagingEnv(),
      surpriseLetter({
        delivery_email_mode: "verified",
        delivery_email_verified_at: "2026-01-01T00:00:00.000Z",
      }),
    );
    expect(blocked).toBe(false);
    expect(deferSurpriseLetterForSafeguard).not.toHaveBeenCalled();
  });
});

describe("8B-10 S3 MailerSend adapter recipient enforcement", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects multi-recipient payloads without calling MailerSend API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendViaMailerSend(
      stagingEnv({
        MAILERSEND_API_TOKEN: "mlsn_test",
        MAILERSEND_SURPRISE_FROM_EMAIL: "letters@vault.becoming366.com",
      }),
      {
        to: "a@example.com,b@example.com",
        subject: "Test",
        html: "<p>Hi</p>",
        text: "Hi",
      },
    );

    expect(result.ok).toBe(false);
    expect(result.errorSummary).toBe("surprise_recipient_multi");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("8B-10 S3 delivery email save integration", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("rejects staging surprise save without declaration acceptance", async () => {
    const res = await applyDeliveryEmailUpdate(
      stagingEnv(),
      new Request("https://example.com/v1/vault/delivery-email"),
      surpriseLetter(),
      "child@example.com",
      "surprise",
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: string };
    expect(json.error).toBe("surprise_declaration_required");
  });
});

describe("8B-10 S3 send safeguard sync checks", () => {
  it("flags invalid stored recipient at send time", () => {
    const result = evaluateSurpriseSendSafeguards(
      stagingEnv(),
      { recipient_email: "not-an-email" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("surprise_recipient_invalid");
    }
  });
});
