import { describe, expect, it, vi, afterEach } from "vitest";
import {
  evaluateRecipientBodyDelivery,
  isSurpriseMode,
  isSurpriseDeliveryEmailChoiceAllowed,
  mayUseResendForOperationalMail,
  surpriseRecipientDeliveryStatus,
} from "../src/lib/surprise-delivery-policy";
import { getDeliveryProvider } from "../src/email/delivery-provider";
import type { Env } from "../src/env";

function env(overrides: Partial<Env> = {}): Env {
  return { VAULT_ENV: "staging", ...overrides };
}

const surpriseLetter = {
  recipient_email: "child@example.com",
  delivery_email_verified_at: null as string | null,
  delivery_email_mode: "surprise" as const,
};

const verifiedLetter = {
  recipient_email: "child@example.com",
  delivery_email_verified_at: "2026-01-01T00:00:00.000Z",
  delivery_email_mode: "verified" as const,
};

describe("8B-10 surprise delivery policy", () => {
  it("detects surprise mode", () => {
    expect(isSurpriseMode({ delivery_email_mode: "surprise" })).toBe(true);
    expect(isSurpriseMode({ delivery_email_mode: "verified" })).toBe(false);
  });

  it("blocks production Surprise UI choice", () => {
    expect(isSurpriseDeliveryEmailChoiceAllowed(env({ VAULT_ENV: "production" }))).toBe(
      false,
    );
  });

  it("blocks production Surprise recipient body delivery (S1 — routing in S2)", () => {
    const decision = evaluateRecipientBodyDelivery(
      env({ VAULT_ENV: "production" }),
      surpriseLetter,
    );
    expect(decision).toEqual({
      allowed: false,
      reason: "surprise_resend_blocked_production",
    });
  });

  it("allows staging Surprise recipient body via Resend until S2", () => {
    const decision = evaluateRecipientBodyDelivery(env(), surpriseLetter);
    expect(decision).toEqual({ allowed: true, providerId: "resend" });
  });

  it("allows production verified recipient body via Resend", () => {
    const decision = evaluateRecipientBodyDelivery(
      env({ VAULT_ENV: "production" }),
      verifiedLetter,
    );
    expect(decision).toEqual({ allowed: true, providerId: "resend" });
  });

  it("blocks verified mode without verification timestamp", () => {
    const decision = evaluateRecipientBodyDelivery(env(), {
      recipient_email: "child@example.com",
      delivery_email_verified_at: null,
      delivery_email_mode: "verified",
    });
    expect(decision).toEqual({ allowed: false, reason: "recipient_not_ready" });
  });

  it("always allows Resend for operational mail", () => {
    expect(mayUseResendForOperationalMail(env({ VAULT_ENV: "production" }))).toBe(
      true,
    );
  });

  it("surpriseRecipientDeliveryStatus uses current API strings", () => {
    expect(
      surpriseRecipientDeliveryStatus(env({ VAULT_ENV: "production" }), "surprise"),
    ).toBe("blocked_pending_compliant_provider");
    expect(surpriseRecipientDeliveryStatus(env(), "surprise")).toBe("surprise_mode");
    expect(surpriseRecipientDeliveryStatus(env(), "verify_now")).toBe("verify_required");
  });
});

describe("8B-10 delivery provider abstraction", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("ResendDeliveryProvider sends via api.resend.com", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ id: "msg_test_123" }, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = getDeliveryProvider("resend");
    const result = await provider.sendFutureDelivery(
      env({ RESEND_API_KEY: "re_test_key" }),
      {
        to: "delivered@resend.dev",
        subject: "Test",
        html: "<p>DUMMY</p>",
        text: "DUMMY",
        letterId: "letter-uuid",
      },
    );

    expect(result.ok).toBe(true);
    expect(result.providerId).toBe("resend");
    expect(result.providerMessageId).toBe("msg_test_123");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("api.resend.com");
  });

  it("MailerSendDeliveryProvider sends via api.mailersend.com", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(null, {
        status: 202,
        headers: { "x-message-id": "ms_msg_456" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = getDeliveryProvider("mailersend");
    const result = await provider.sendFutureDelivery(
      env({
        MAILERSEND_API_TOKEN: "mlsn_test_token",
        MAILERSEND_SURPRISE_FROM_EMAIL: "letters@vault.becoming366.com",
      }),
      {
        to: "friend@example.com",
        subject: "A letter for you",
        html: "<p>Hello</p>",
        text: "Hello",
        letterId: "letter-uuid",
      },
    );

    expect(result.ok).toBe(true);
    expect(result.providerId).toBe("mailersend");
    expect(result.providerMessageId).toBe("ms_msg_456");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("api.mailersend.com");
  });
});

describe("8B-10 production Surprise must not hit delivery providers (S1)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("policy gate prevents provider send for production Surprise", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const decision = evaluateRecipientBodyDelivery(
      env({ VAULT_ENV: "production" }),
      surpriseLetter,
    );
    expect(decision.allowed).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
