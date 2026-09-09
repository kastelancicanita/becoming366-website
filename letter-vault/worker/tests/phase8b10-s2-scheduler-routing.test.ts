import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { LetterRow } from "../src/db/letters";
import type { Env } from "../src/env";

const resendSend = vi.fn();
const mailersendSend = vi.fn();

vi.mock("../src/email/delivery-provider", () => ({
  getDeliveryProvider: (id: string) => ({
    id,
    sendFutureDelivery:
      id === "mailersend"
        ? (...args: unknown[]) => mailersendSend(...args)
        : (...args: unknown[]) => resendSend(...args),
  }),
}));

vi.mock("../src/crypto/envelope", () => ({
  verifyEnvelope: vi.fn(async () => true),
  decryptPayload: vi.fn(async () => new TextEncoder().encode("DUMMY: letter body")),
}));

vi.mock("../src/db/email-store", () => ({
  insertOutboundQueued: vi.fn(async () => ({
    row: { id: "out-1", provider_message_id: null },
    duplicate: false,
  })),
  markOutboundSending: vi.fn(async () => {}),
  markOutboundSendResult: vi.fn(async () => {}),
}));

const finishDeliveryAttempt = vi.fn(async () => {});
const updateLetterAfterDelivery = vi.fn(async () => {});
const startDeliveryAttempt = vi.fn(async () => ({ id: "attempt-1" }));

vi.mock("../src/db/letters", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/db/letters")>();
  return {
    ...actual,
    startDeliveryAttempt: (...args: unknown[]) => startDeliveryAttempt(...args),
    finishDeliveryAttempt: (...args: unknown[]) => finishDeliveryAttempt(...args),
    updateLetterAfterDelivery: (...args: unknown[]) => updateLetterAfterDelivery(...args),
    letterToEnvelope: (letter: LetterRow) => letter,
  };
});

import { processClaimedLetter } from "../src/delivery/scheduler";
import { evaluateRecipientBodyDelivery } from "../src/lib/surprise-delivery-policy";

const TEST_MASTER = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

function stagingEnv(overrides: Partial<Env> = {}): Env {
  return {
    VAULT_ENV: "staging",
    LETTER_VAULT_MASTER_KEY_V1: TEST_MASTER,
    RESEND_API_KEY: "re_test_key",
    MAILERSEND_API_TOKEN: "mlsn_test_token",
    MAILERSEND_SURPRISE_FROM_EMAIL: "letters@vault.becoming366.com",
    ...overrides,
  };
}

function baseLetter(overrides: Partial<LetterRow> = {}): LetterRow {
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

describe("8B-10 S2 scheduler provider routing", () => {
  beforeEach(() => {
    resendSend.mockReset();
    mailersendSend.mockReset();
    resendSend.mockResolvedValue({
      ok: true,
      providerId: "resend",
      providerMessageId: "msg_resend_1",
      errorSummary: null,
    });
    mailersendSend.mockResolvedValue({
      ok: true,
      providerId: "mailersend",
      providerMessageId: "msg_ms_1",
      errorSummary: null,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("Surprise future-letter delivery uses MailerSend provider", async () => {
    const letter = baseLetter({ delivery_email_mode: "surprise" });
    const decision = evaluateRecipientBodyDelivery(stagingEnv(), letter);
    expect(decision).toEqual({ allowed: true, providerId: "mailersend" });

    const outcome = await processClaimedLetter(
      stagingEnv(),
      letter,
      TEST_MASTER,
      decision.allowed ? decision.providerId : "resend",
    );

    expect(outcome).toBe("sent");
    expect(mailerSendSendCalled()).toBe(true);
    expect(resendSend).not.toHaveBeenCalled();
  });

  it("verified future-letter delivery uses Resend provider", async () => {
    const letter = baseLetter({
      delivery_email_mode: "verified",
      delivery_email_verified_at: "2026-01-01T00:00:00.000Z",
    });
    const decision = evaluateRecipientBodyDelivery(stagingEnv(), letter);
    expect(decision).toEqual({ allowed: true, providerId: "resend" });

    const outcome = await processClaimedLetter(
      stagingEnv(),
      letter,
      TEST_MASTER,
      decision.allowed ? decision.providerId : "mailersend",
    );

    expect(outcome).toBe("sent");
    expect(resendSend).toHaveBeenCalledOnce();
    expect(mailerSendSendCalled()).toBe(false);
  });

  it("verify_now with verified timestamp uses Resend provider", async () => {
    const letter = baseLetter({
      delivery_email_mode: "verify_now",
      delivery_email_verified_at: "2026-01-01T00:00:00.000Z",
    });
    const decision = evaluateRecipientBodyDelivery(stagingEnv(), letter);
    expect(decision).toEqual({ allowed: true, providerId: "resend" });

    await processClaimedLetter(
      stagingEnv(),
      letter,
      TEST_MASTER,
      decision.allowed ? decision.providerId : "mailersend",
    );

    expect(resendSend).toHaveBeenCalledOnce();
    expect(mailerSendSendCalled()).toBe(false);
  });

  it("Surprise never falls back to Resend when MailerSend is unavailable", async () => {
    mailersendSend.mockResolvedValueOnce({
      ok: false,
      providerId: "mailersend",
      providerMessageId: null,
      errorSummary: "mailersend_not_configured",
    });

    const letter = baseLetter({ delivery_email_mode: "surprise" });
    const outcome = await processClaimedLetter(
      stagingEnv({ MAILERSEND_API_TOKEN: undefined }),
      letter,
      TEST_MASTER,
      "mailersend",
    );

    expect(outcome).toBe("failed");
    expect(mailerSendSendCalled()).toBe(true);
    expect(resendSend).not.toHaveBeenCalled();
    expect(updateLetterAfterDelivery).toHaveBeenCalledWith(
      stagingEnv({ MAILERSEND_API_TOKEN: undefined }),
      letter.id,
      expect.objectContaining({
        status: "RETRY_REQUIRED",
        last_error_category: "mailersend",
        clear_lease: true,
      }),
    );
  });

  it("production Surprise is blocked before any provider send", async () => {
    const letter = baseLetter({ delivery_email_mode: "surprise" });
    const decision = evaluateRecipientBodyDelivery(
      stagingEnv({ VAULT_ENV: "production" }),
      letter,
    );
    expect(decision).toEqual({
      allowed: false,
      reason: "surprise_resend_blocked_production",
    });
    expect(resendSend).not.toHaveBeenCalled();
    expect(mailerSendSendCalled()).toBe(false);
  });

  it("duplicate outbound with provider_message_id does not send again", async () => {
    const { insertOutboundQueued } = await import("../src/db/email-store");
    vi.mocked(insertOutboundQueued).mockResolvedValueOnce({
      row: { id: "out-dup", provider_message_id: "msg_existing" },
      duplicate: true,
    } as never);

    const letter = baseLetter({
      delivery_email_mode: "verified",
      delivery_email_verified_at: "2026-01-01T00:00:00.000Z",
    });

    const outcome = await processClaimedLetter(
      stagingEnv(),
      letter,
      TEST_MASTER,
      "resend",
    );

    expect(outcome).toBe("sent");
    expect(resendSend).not.toHaveBeenCalled();
    expect(mailerSendSendCalled()).toBe(false);
  });
});

function mailerSendSendCalled(): boolean {
  return mailersendSend.mock.calls.length > 0;
}
