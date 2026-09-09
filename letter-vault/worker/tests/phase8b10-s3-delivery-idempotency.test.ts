import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { LetterRow } from "../src/db/letters";
import type { Env } from "../src/env";
import { futureLetterDeliveryIdempotencyKey } from "../src/lib/idempotency-keys";

const resendSend = vi.fn();
const insertOutboundQueued = vi.fn();

vi.mock("../src/email/delivery-provider", () => ({
  getDeliveryProvider: (id: string) => ({
    id,
    sendFutureDelivery: (...args: unknown[]) => resendSend(...args),
  }),
}));

vi.mock("../src/crypto/envelope", () => ({
  verifyEnvelope: vi.fn(async () => true),
  decryptPayload: vi.fn(async () => new TextEncoder().encode("DUMMY: letter body")),
}));

vi.mock("../src/db/email-store", () => ({
  insertOutboundQueued: (...args: unknown[]) => insertOutboundQueued(...args),
  markOutboundSending: vi.fn(async () => {}),
  markOutboundSendResult: vi.fn(async () => {}),
}));

vi.mock("../src/db/letters", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/db/letters")>();
  return {
    ...actual,
    startDeliveryAttempt: vi.fn(async () => ({ id: "attempt-1" })),
    finishDeliveryAttempt: vi.fn(async () => {}),
    updateLetterAfterDelivery: vi.fn(async () => {}),
    letterToEnvelope: (letter: LetterRow) => letter,
  };
});

import { processClaimedLetter } from "../src/delivery/scheduler";

const TEST_MASTER = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const LETTER_ID = "00000000-0000-4000-8000-000000000099";

function stagingEnv(): Env {
  return {
    VAULT_ENV: "staging",
    LETTER_VAULT_MASTER_KEY_V1: TEST_MASTER,
    RESEND_API_KEY: "re_test_key",
  };
}

function baseLetter(overrides: Partial<LetterRow> = {}): LetterRow {
  return {
    id: LETTER_ID,
    label: "test",
    purchaser_email: "buyer@example.com",
    recipient_email: "friend@example.com",
    delivery_at: new Date(Date.now() - 60_000).toISOString(),
    delivery_timezone: "UTC",
    status: "SEALED",
    delivery_email_verified_at: "2026-01-01T00:00:00.000Z",
    delivery_email_mode: "verified",
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

describe("future-letter delivery idempotency key", () => {
  beforeEach(() => {
    resendSend.mockReset();
    insertOutboundQueued.mockReset();
    resendSend.mockResolvedValue({
      ok: true,
      providerId: "resend",
      providerMessageId: "msg_resend_1",
      errorSummary: null,
    });
    insertOutboundQueued.mockResolvedValue({
      row: { id: "out-1", provider_message_id: null },
      duplicate: false,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("uses production-safe LV-DELIVERY-{letterId} format", () => {
    expect(futureLetterDeliveryIdempotencyKey(LETTER_ID)).toBe(
      `LV-DELIVERY-${LETTER_ID}`,
    );
    expect(futureLetterDeliveryIdempotencyKey(LETTER_ID)).not.toContain("DUMMY");
  });

  it("returns the same key across retries for one letter", () => {
    const first = futureLetterDeliveryIdempotencyKey(LETTER_ID);
    const second = futureLetterDeliveryIdempotencyKey(LETTER_ID);
    expect(first).toBe(second);
    expect(first).toBe(`LV-DELIVERY-${LETTER_ID}`);
  });

  it("queues outbound with the stable key on first send attempt", async () => {
    await processClaimedLetter(stagingEnv(), baseLetter(), TEST_MASTER, "resend");

    expect(insertOutboundQueued).toHaveBeenCalledWith(
      stagingEnv(),
      expect.objectContaining({
        idempotency_key: `LV-DELIVERY-${LETTER_ID}`,
        letter_ref: LETTER_ID,
        email_type: "future_delivery",
      }),
    );
    expect(resendSend).toHaveBeenCalledOnce();
  });

  it("does not call provider again when duplicate outbound already has message id", async () => {
    insertOutboundQueued.mockResolvedValueOnce({
      row: { id: "out-dup", provider_message_id: "msg_existing" },
      duplicate: true,
    });

    const outcome = await processClaimedLetter(
      stagingEnv(),
      baseLetter({ attempt_count: 1 }),
      TEST_MASTER,
      "resend",
    );

    expect(outcome).toBe("sent");
    expect(insertOutboundQueued).toHaveBeenCalledWith(
      stagingEnv(),
      expect.objectContaining({
        idempotency_key: `LV-DELIVERY-${LETTER_ID}`,
      }),
    );
    expect(resendSend).not.toHaveBeenCalled();
  });
});
