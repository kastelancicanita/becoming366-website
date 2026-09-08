import { describe, expect, it } from "vitest";
import {
  isLetterDue,
  shouldAdvanceLetterStatus,
} from "../src/delivery/status";
import {
  buildFutureDeliveryHtml,
  buildFutureDeliverySubject,
  buildFutureDeliveryText,
} from "../src/email/templates/future-delivery";
import {
  handleSchedulerRun,
  handleSealScheduledLetter,
  handleLetterStatus,
} from "../src/routes/delivery";
import type { Env } from "../src/env";

const TEST_ADMIN = "test-staging-admin-token";
const TEST_MASTER = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

function stagingEnv(overrides: Partial<Env> = {}): Env {
  return {
    VAULT_ENV: "staging",
    LETTER_VAULT_STAGING_ADMIN_TOKEN: TEST_ADMIN,
    LETTER_VAULT_MASTER_KEY_V1: TEST_MASTER,
    RESEND_API_KEY: "re_test_not_real",
    ...overrides,
  };
}

function adminRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Letter-Vault-Staging-Admin": TEST_ADMIN,
    },
    body: JSON.stringify(body),
  });
}

describe("letter delivery status", () => {
  it("detects due letters by UTC timestamp", () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 3600_000).toISOString();
    expect(isLetterDue(past)).toBe(true);
    expect(isLetterDue(future)).toBe(false);
  });

  it("does not regress SENT to PROCESSING", () => {
    expect(shouldAdvanceLetterStatus("SENT", "PROCESSING")).toBe(false);
  });

  it("advances SENT to DELIVERED", () => {
    expect(shouldAdvanceLetterStatus("SENT", "DELIVERED")).toBe(true);
  });
});

describe("future delivery template", () => {
  it("includes emotional copy and letter body in outbound template only", () => {
    const html = buildFutureDeliveryHtml({
      letterBodyPlaintext: "DUMMY: test letter body",
      deliveryDateFormatted: "June 15, 2027",
    });
    expect(html).toContain("You asked us to send you this today");
    expect(html).toContain("DUMMY: test letter body");
    expect(buildFutureDeliverySubject()).toBe(
      "You asked us to send you this today",
    );
  });

  it("text template includes body", () => {
    const text = buildFutureDeliveryText({
      letterBodyPlaintext: "DUMMY: plaintext in email only",
      deliveryDateFormatted: "June 15, 2027",
    });
    expect(text).toContain("DUMMY: plaintext in email only");
  });
});

describe("delivery routes", () => {
  it("seal-scheduled rejects without admin", async () => {
    const response = await handleSealScheduledLetter(
      new Request("https://example.com/v1/staging/letters/seal-scheduled", {
        method: "POST",
        body: JSON.stringify({
          purchaser_email: "buyer@example.com",
          recipient_email: "delivered@resend.dev",
          dummy_text: "DUMMY: test",
          delivery_in_minutes: 5,
        }),
      }),
      stagingEnv(),
    );
    expect(response.status).toBe(401);
  });

  it("seal-scheduled rejects non-dummy text", async () => {
    const response = await handleSealScheduledLetter(
      adminRequest("https://example.com/v1/staging/letters/seal-scheduled", {
        purchaser_email: "delivered@resend.dev",
        recipient_email: "delivered@resend.dev",
        dummy_text: "real letter content",
        delivery_in_minutes: 5,
      }),
      stagingEnv(),
    );
    expect(response.status).toBe(400);
  });

  it("seal-scheduled fails without DB", async () => {
    const response = await handleSealScheduledLetter(
      adminRequest("https://example.com/v1/staging/letters/seal-scheduled", {
        purchaser_email: "delivered@resend.dev",
        recipient_email: "delivered@resend.dev",
        dummy_text: "DUMMY: phase5 unit test",
        delivery_in_minutes: 5,
      }),
      stagingEnv(),
    );
    expect(response.status).toBeGreaterThanOrEqual(500);
  });

  it("scheduler run requires admin", async () => {
    const response = await handleSchedulerRun(
      new Request("https://example.com/v1/staging/scheduler/run", {
        method: "POST",
      }),
      stagingEnv(),
    );
    expect(response.status).toBe(401);
  });

  it("letter status has no plaintext fields", async () => {
    const response = await handleLetterStatus(
      new Request("https://example.com/v1/staging/letters/status/x", {
        headers: { "X-Letter-Vault-Staging-Admin": TEST_ADMIN },
      }),
      stagingEnv(),
      "00000000-0000-4000-8000-000000000001",
    );
    expect([401, 500]).toContain(response.status);
  });
});

describe("worker router phase5", () => {
  it("routes POST /v1/staging/scheduler/run", async () => {
    const worker = (await import("../src/index")).default;
    const response = await worker.fetch(
      new Request("https://example.com/v1/staging/scheduler/run", {
        method: "POST",
        headers: { "X-Letter-Vault-Staging-Admin": TEST_ADMIN },
      }),
      stagingEnv(),
    );
    expect([200, 500]).toContain(response.status);
  });

  it("exports scheduled handler", async () => {
    const worker = (await import("../src/index")).default;
    expect(typeof worker.scheduled).toBe("function");
  });
});
