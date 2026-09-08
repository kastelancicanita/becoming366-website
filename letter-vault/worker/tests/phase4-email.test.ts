import { describe, expect, it } from "vitest";
import {
  EMAIL_STATUS_RANK,
  mapResendEventType,
  shouldAdvanceEmailStatus,
} from "../src/email/status";
import {
  buildSealConfirmationHtml,
  buildSealConfirmationSubject,
  buildSealConfirmationText,
  templateContainsPrivateLetterContent,
} from "../src/email/templates/seal-confirmation";
import {
  extractSvixHeaders,
  verifySvixWebhook,
} from "../src/email/webhook-verify";
import { VAULT_SENDER } from "../src/email/resend-client";
import {
  handleSendSealConfirmation,
  handleEmailIdempotencyCheck,
} from "../src/routes/email";
import { handleResendWebhook, handleStagingWebhookSimulate } from "../src/routes/webhooks";
import type { Env } from "../src/env";

const TEST_ADMIN = "test-staging-admin-token";
const TEST_WEBHOOK_SECRET = "whsec_" + btoa("letter-vault-test-webhook-secret!");

function stagingEnv(overrides: Partial<Env> = {}): Env {
  return {
    VAULT_ENV: "staging",
    LETTER_VAULT_STAGING_ADMIN_TOKEN: TEST_ADMIN,
    RESEND_API_KEY: "re_test_not_real",
    RESEND_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
    ...overrides,
  };
}

async function signSvixPayload(
  secret: string,
  rawBody: string,
  id = "msg_test_001",
  timestamp = Math.floor(Date.now() / 1000).toString(),
): Promise<{ id: string; timestamp: string; signature: string }> {
  const raw = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  const binary = atob(raw);
  const keyBytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) keyBytes[i] = binary.charCodeAt(i);

  const signedContent = `${id}.${timestamp}.${rawBody}`;
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signedContent),
  );
  let sigBinary = "";
  for (const b of new Uint8Array(sig)) sigBinary += String.fromCharCode(b);
  const signature = `v1,${btoa(sigBinary)}`;
  return { id, timestamp, signature };
}

describe("email status transitions", () => {
  it("maps Resend event types", () => {
    expect(mapResendEventType("email.sent")).toBe("sent");
    expect(mapResendEventType("email.delivered")).toBe("delivered");
    expect(mapResendEventType("email.bounced")).toBe("bounced");
  });

  it("advances sent → delivered", () => {
    expect(shouldAdvanceEmailStatus("sent", "delivered")).toBe(true);
  });

  it("does not regress delivered → sent", () => {
    expect(shouldAdvanceEmailStatus("delivered", "sent")).toBe(false);
  });

  it("allows failure from sent", () => {
    expect(shouldAdvanceEmailStatus("sent", "bounced")).toBe(true);
  });

  it("ranks delivered below terminal failures", () => {
    expect(EMAIL_STATUS_RANK.delivered).toBeLessThan(EMAIL_STATUS_RANK.bounced);
  });
});

describe("seal confirmation template", () => {
  it("uses locked emotional copy", () => {
    const html = buildSealConfirmationHtml({ deliveryDateIso: "2027-06-15" });
    expect(html).toContain("Your letter is sealed.");
    expect(html).toContain("Then forget about it. We'll remember.");
  });

  it("includes operational instructions only", () => {
    const text = buildSealConfirmationText({ deliveryDateIso: "2027-06-15" });
    expect(text).toContain("letters@vault.becoming366.com");
    expect(text).toContain("Not Spam");
    expect(text).toContain("Scheduled delivery:");
  });

  it("does not include private letter content placeholders", () => {
    const html = buildSealConfirmationHtml({ deliveryDateIso: "2027-06-15" });
    expect(templateContainsPrivateLetterContent(html)).toBe(false);
  });

  it("has fixed subject without letter content", () => {
    expect(buildSealConfirmationSubject()).toBe("Your letter is sealed");
  });
});

describe("sender identity", () => {
  it("uses isolated vault subdomain", () => {
    expect(VAULT_SENDER).toContain("letters@vault.becoming366.com");
    expect(VAULT_SENDER).toContain("The Letter Vault");
  });
});

describe("svix webhook verification", () => {
  it("accepts valid signature", async () => {
    const body = JSON.stringify({ type: "email.sent", data: { email_id: "abc" } });
    const signed = await signSvixPayload(TEST_WEBHOOK_SECRET, body);
    const valid = await verifySvixWebhook(TEST_WEBHOOK_SECRET, body, signed);
    expect(valid).toBe(true);
  });

  it("rejects invalid signature", async () => {
    const body = '{"type":"email.sent"}';
    const valid = await verifySvixWebhook(TEST_WEBHOOK_SECRET, body, {
      id: "msg_x",
      timestamp: Math.floor(Date.now() / 1000).toString(),
      signature: "v1,invalidsignaturevalue000000000000000000000=",
    });
    expect(valid).toBe(false);
  });

  it("rejects tampered body", async () => {
    const body = '{"type":"email.sent"}';
    const signed = await signSvixPayload(TEST_WEBHOOK_SECRET, body);
    const valid = await verifySvixWebhook(
      TEST_WEBHOOK_SECRET,
      '{"type":"email.bounced"}',
      signed,
    );
    expect(valid).toBe(false);
  });

  it("extracts svix headers from request", () => {
    const req = new Request("https://example.com", {
      headers: {
        "svix-id": "msg_1",
        "svix-timestamp": "123",
        "svix-signature": "v1,x",
      },
    });
    expect(extractSvixHeaders(req).id).toBe("msg_1");
  });
});

describe("email routes", () => {
  it("send-confirmation rejects without admin header", async () => {
    const response = await handleSendSealConfirmation(
      new Request("https://example.com/v1/staging/email/send-confirmation", {
        method: "POST",
        body: JSON.stringify({
          idempotency_key: "DUMMY-EMAIL-001",
          recipient_email: "dummy-buyer@example.com",
          delivery_date: "2027-06-15",
        }),
      }),
      stagingEnv(),
    );
    expect(response.status).toBe(401);
  });

  it("send-confirmation rejects real email domains", async () => {
    const response = await handleSendSealConfirmation(
      new Request("https://example.com/v1/staging/email/send-confirmation", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Letter-Vault-Staging-Admin": TEST_ADMIN,
        },
        body: JSON.stringify({
          idempotency_key: "DUMMY-EMAIL-002",
          recipient_email: "real@gmail.com",
          delivery_date: "2027-06-15",
        }),
      }),
      stagingEnv(),
    );
    expect(response.status).toBe(400);
  });

  it("webhook rejects invalid signature", async () => {
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

  it("webhook accepts valid signature before DB processing", async () => {
    const body = JSON.stringify({
      type: "email.sent",
      data: { email_id: "unknown-id" },
    });
    const signed = await signSvixPayload(TEST_WEBHOOK_SECRET, body, "msg_valid_001");
    const response = await handleResendWebhook(
      new Request("https://example.com/v1/webhooks/resend", {
        method: "POST",
        headers: {
          "svix-id": signed.id,
          "svix-timestamp": signed.timestamp,
          "svix-signature": signed.signature,
          "Content-Type": "application/json",
        },
        body,
      }),
      stagingEnv(),
    );
    expect([200, 500]).toContain(response.status);
    expect(response.status).not.toBe(401);
  });

  it("staging webhook simulate requires admin", async () => {
    const response = await handleStagingWebhookSimulate(
      new Request("https://example.com/v1/staging/webhooks/simulate", {
        method: "POST",
        body: JSON.stringify({
          provider_event_id: "DUMMY-EVT-1",
          provider_message_id: "msg-1",
          event_type: "email.delivered",
        }),
      }),
      stagingEnv(),
    );
    expect(response.status).toBe(403);
  });
});

describe("worker router phase4", () => {
  it("routes POST /v1/webhooks/resend", async () => {
    const worker = (await import("../src/index")).default;
    const response = await worker.fetch(
      new Request("https://example.com/v1/webhooks/resend", { method: "POST", body: "{}" }),
      stagingEnv(),
    );
    expect(response.status).toBe(401);
  });
});

describe("secrets not in responses", () => {
  it("idempotency check response has no api keys", async () => {
    const response = await handleEmailIdempotencyCheck(
      new Request(
        "https://example.com/v1/staging/email/idempotency-check?idempotency_key=DUMMY-X",
        {
          headers: { "X-Letter-Vault-Staging-Admin": TEST_ADMIN },
        },
      ),
      stagingEnv(),
    );
    const text = await response.text();
    expect(text).not.toContain("re_");
    expect(text).not.toContain("whsec_");
    expect(response.status).toBe(500);
  });
});
