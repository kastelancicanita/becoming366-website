import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  mapMailerSendEventType,
  mapResendEventType,
  shouldAdvanceEmailStatus,
} from "../src/email/status";
import {
  MAILERSEND_WEBHOOK_TEST_SECRET,
  parseMailerSendWebhookPayload,
  verifyMailerSendWebhookSignature,
} from "../src/email/mailersend-webhook-verify";
import {
  mapEmailStatusToLetterStatus,
  syncLetterStatusFromOutboundWebhook,
} from "../src/lib/letter-webhook-sync";
import {
  processInboundEmailWebhook,
  suppressionReasonForEvent,
} from "../src/lib/inbound-webhook";
import { handleMailerSendWebhook, handleResendWebhook } from "../src/routes/webhooks";
import type { Env } from "../src/env";

const applyWebhookStatus = vi.fn();
const recordWebhookEvent = vi.fn();
const findOutboundByProviderMessageId = vi.fn();
const updateOutboundErrorSummary = vi.fn();
const upsertRecipientSuppression = vi.fn();
const fetchLetterById = vi.fn();
const letterUpdate = vi.fn();

vi.mock("../src/db/email-store", () => ({
  applyWebhookStatus: (...args: unknown[]) => applyWebhookStatus(...args),
  recordWebhookEvent: (...args: unknown[]) => recordWebhookEvent(...args),
  findOutboundByProviderMessageId: (...args: unknown[]) =>
    findOutboundByProviderMessageId(...args),
  updateOutboundErrorSummary: (...args: unknown[]) =>
    updateOutboundErrorSummary(...args),
}));

vi.mock("../src/db/recipient-suppression", () => ({
  upsertRecipientSuppression: (...args: unknown[]) =>
    upsertRecipientSuppression(...args),
  isRecipientSuppressed: vi.fn(async () => false),
}));

vi.mock("../src/db/letters", () => ({
  fetchLetterById: (...args: unknown[]) => fetchLetterById(...args),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(() => ({
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            select: vi.fn(() => ({
              maybeSingle: letterUpdate,
            })),
          })),
        })),
      })),
    })),
  })),
}));

function stagingEnv(overrides: Partial<Env> = {}): Env {
  return {
    VAULT_ENV: "staging",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
    RESEND_WEBHOOK_SECRET: "whsec_" + btoa("resend-test-secret"),
    MAILERSEND_WEBHOOK_SECRET: "ms_live_webhook_secret",
    ...overrides,
  };
}

async function signMailerSendBody(
  secret: string,
  rawBody: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(rawBody),
  );
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

describe("8B-10 S4 MailerSend event mapping", () => {
  it("maps delivery lifecycle events separately from engagement", () => {
    expect(mapMailerSendEventType("activity.sent")).toBe("sent");
    expect(mapMailerSendEventType("activity.delivered")).toBe("delivered");
    expect(mapMailerSendEventType("activity.hard_bounced")).toBe("bounced");
    expect(mapMailerSendEventType("activity.soft_bounced")).toBe("failed");
    expect(mapMailerSendEventType("activity.spam_complaint")).toBe("complained");
  });

  it("does not treat opened/clicked as delivered", () => {
    expect(mapMailerSendEventType("activity.opened")).toBeNull();
    expect(mapMailerSendEventType("activity.clicked")).toBeNull();
  });

  it("maps sent and delivered to different letter statuses", () => {
    expect(mapEmailStatusToLetterStatus("sent", "activity.sent")).toBe("SENT");
    expect(mapEmailStatusToLetterStatus("delivered", "activity.delivered")).toBe(
      "DELIVERED",
    );
    expect(mapEmailStatusToLetterStatus("sent", "activity.sent")).not.toBe(
      "DELIVERED",
    );
  });

  it("does not regress delivered → sent on out-of-order events", () => {
    expect(shouldAdvanceEmailStatus("delivered", "sent")).toBe(false);
  });
});

describe("8B-10 S4 MailerSend webhook verification", () => {
  it("verifies HMAC-SHA256 Signature header over raw body", async () => {
    const body = JSON.stringify({
      type: "activity.sent",
      data: { id: "evt1", message_id: "msg1" },
    });
    const signature = await signMailerSendBody("ms_live_webhook_secret", body);
    const valid = await verifyMailerSendWebhookSignature(
      body,
      signature,
      "ms_live_webhook_secret",
    );
    expect(valid).toBe(true);
  });

  it("rejects tampered payloads", async () => {
    const body = JSON.stringify({ type: "activity.sent", data: { id: "evt1" } });
    const signature = await signMailerSendBody("ms_live_webhook_secret", body);
    const valid = await verifyMailerSendWebhookSignature(
      '{"type":"activity.delivered"}',
      signature,
      "ms_live_webhook_secret",
    );
    expect(valid).toBe(false);
  });

  it("accepts webhook.test ping with public test secret only", async () => {
    const body = JSON.stringify({
      type: "webhook.test",
      message: "This is a ping test message",
    });
    const signature = await signMailerSendBody(MAILERSEND_WEBHOOK_TEST_SECRET, body);
    const response = await handleMailerSendWebhook(
      new Request("https://example.com/v1/webhooks/mailersend", {
        method: "POST",
        headers: { Signature: signature, "Content-Type": "application/json" },
        body,
      }),
      stagingEnv({ MAILERSEND_WEBHOOK_SECRET: undefined }),
    );
    expect(response.status).toBe(200);
    const json = (await response.json()) as { test_ping?: boolean };
    expect(json.test_ping).toBe(true);
  });
});

describe("8B-10 S4 inbound webhook processing", () => {
  beforeEach(() => {
    applyWebhookStatus.mockReset();
    recordWebhookEvent.mockReset();
    findOutboundByProviderMessageId.mockReset();
    updateOutboundErrorSummary.mockReset();
    upsertRecipientSuppression.mockReset();
    fetchLetterById.mockReset();
    letterUpdate.mockReset();

    recordWebhookEvent.mockResolvedValue({ inserted: true });
    applyWebhookStatus.mockResolvedValue({ updated: true });
    findOutboundByProviderMessageId.mockResolvedValue({
      id: "out-1",
      status: "sent",
      email_type: "future_delivery",
      letter_ref: "letter-1",
      recipient_email: "friend@example.com",
      provider: "mailersend",
    });
    fetchLetterById.mockResolvedValue({
      id: "letter-1",
      status: "SENT",
      ciphertext_b64: "encrypted",
    });
    letterUpdate.mockResolvedValue({ data: { id: "letter-1" } });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("dedupes repeated provider event ids", async () => {
    recordWebhookEvent.mockResolvedValueOnce({ inserted: false });

    const result = await processInboundEmailWebhook(stagingEnv(), {
      providerEventId: "mailersend:evt-dup",
      providerMessageId: "msg-1",
      eventType: "activity.delivered",
      mappedStatus: "delivered",
    });

    expect(result.duplicate).toBe(true);
    expect(applyWebhookStatus).not.toHaveBeenCalled();
  });

  it("suppresses recipient on hard bounce without deleting letter content", async () => {
    await processInboundEmailWebhook(stagingEnv(), {
      providerEventId: "mailersend:evt-bounce",
      providerMessageId: "msg-bounce",
      eventType: "activity.hard_bounced",
      mappedStatus: "bounced",
      recipientEmail: "friend@example.com",
    });

    expect(upsertRecipientSuppression).toHaveBeenCalledWith(
      stagingEnv(),
      expect.objectContaining({
        recipientEmail: "friend@example.com",
        reason: "hard_bounce",
      }),
    );
    expect(fetchLetterById).toHaveBeenCalled();
    expect(letterUpdate).toHaveBeenCalled();
  });

  it("suppresses recipient on spam complaint", async () => {
    expect(suppressionReasonForEvent("activity.spam_complaint")).toBe(
      "spam_complaint",
    );

    await processInboundEmailWebhook(stagingEnv(), {
      providerEventId: "mailersend:evt-spam",
      providerMessageId: "msg-spam",
      eventType: "activity.spam_complaint",
      mappedStatus: "complained",
      recipientEmail: "friend@example.com",
    });

    expect(upsertRecipientSuppression).toHaveBeenCalledWith(
      stagingEnv(),
      expect.objectContaining({ reason: "spam_complaint" }),
    );
  });

  it("maps soft bounce to RETRY_REQUIRED letter state", async () => {
    const letterStatus = mapEmailStatusToLetterStatus(
      "failed",
      "activity.soft_bounced",
    );
    expect(letterStatus).toBe("RETRY_REQUIRED");
  });
});

describe("8B-10 S4 letter sync non-regression", () => {
  beforeEach(() => {
    fetchLetterById.mockReset();
    letterUpdate.mockReset();
  });

  it("does not regress DELIVERED to SENT", async () => {
    fetchLetterById.mockResolvedValue({
      id: "letter-1",
      status: "DELIVERED",
    });

    const result = await syncLetterStatusFromOutboundWebhook(
      stagingEnv(),
      "letter-1",
      "SENT",
      "activity.sent",
    );

    expect(result.updated).toBe(false);
    expect(letterUpdate).not.toHaveBeenCalled();
  });
});

describe("8B-10 S4 Resend webhook regression", () => {
  it("still maps Resend events unchanged", () => {
    expect(mapResendEventType("email.sent")).toBe("sent");
    expect(mapResendEventType("email.delivered")).toBe("delivered");
    expect(mapResendEventType("email.bounced")).toBe("bounced");
  });

  it("rejects Resend webhook without valid signature", async () => {
    const response = await handleResendWebhook(
      new Request("https://example.com/v1/webhooks/resend", {
        method: "POST",
        headers: {
          "svix-id": "msg_bad",
          "svix-timestamp": Math.floor(Date.now() / 1000).toString(),
          "svix-signature": "v1,badsig",
        },
        body: "{}",
      }),
      stagingEnv(),
    );
    expect(response.status).toBe(401);
  });
});

describe("8B-10 S4 MailerSend handler rejects invalid signature", () => {
  it("returns 401 when Signature header is wrong", async () => {
    const body = JSON.stringify({
      type: "activity.sent",
      data: { id: "evt1", message_id: "msg1" },
    });
    const response = await handleMailerSendWebhook(
      new Request("https://example.com/v1/webhooks/mailersend", {
        method: "POST",
        headers: { Signature: "deadbeef", "Content-Type": "application/json" },
        body,
      }),
      stagingEnv(),
    );
    expect(response.status).toBe(401);
  });
});

describe("8B-10 S4 MailerSend payload parsing", () => {
  it("extracts provider message id from activity payload", () => {
    const payload = parseMailerSendWebhookPayload(
      JSON.stringify({
        type: "activity.delivered",
        data: {
          id: "6892766a5b66e2daf3dc9155",
          message_id: "6892766ae78995a317577aa1",
          email: "friend@example.com",
        },
      }),
    );
    expect(payload.data?.message_id).toBe("6892766ae78995a317577aa1");
  });
});
