import { describe, expect, it } from "vitest";
import {
  generateSecureToken,
  hashToken,
  isExpired,
  MANAGEMENT_TOKEN_TTL_MS,
  maskEmail,
  expiresAtFromNow,
} from "../src/crypto/management-token";
import { hasVerifiedDeliveryEmail } from "../src/db/letters";
import type { LetterRow } from "../src/db/letters";
import {
  buildDeliveryEmailVerifyHtml,
  buildDeliveryEmailVerifySubject,
  buildManagementLinkHtml,
  buildManagementLinkSubject,
} from "../src/email/templates/management";
import { buildManagementUiActivateUrl } from "../src/lib/management-link";
import { MANAGEMENT_REQUEST_OK } from "../src/lib/management-response";
import {
  handleDeliveryEmailChangeRequest,
  handleManagementActivatePost,
  handleManagementRequest,
  handleManagementSessionView,
  SESSION_HEADER,
} from "../src/routes/management";
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

function letterRow(partial: Partial<LetterRow> = {}): LetterRow {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    label: "test",
    purchaser_email: "buyer@example.com",
    recipient_email: "delivered@resend.dev",
    delivery_at: new Date(Date.now() + 3600_000).toISOString(),
    delivery_timezone: "UTC",
    status: "SEALED",
    delivery_email_verified_at: new Date().toISOString(),
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
    entitlement_ref: null,
    last_error_category: null,
    provider_message_id: null,
    sent_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...partial,
  };
}

describe("management token crypto", () => {
  it("generates URL-safe tokens", () => {
    const token = generateSecureToken();
    expect(token.length).toBeGreaterThan(30);
    expect(token).not.toMatch(/[+/=]/);
  });

  it("hashes tokens deterministically with pepper", async () => {
    const h1 = await hashToken("pepper", "token-value");
    const h2 = await hashToken("pepper", "token-value");
    const h3 = await hashToken("pepper", "other");
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("detects expiration", () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const future = expiresAtFromNow(MANAGEMENT_TOKEN_TTL_MS);
    expect(isExpired(past)).toBe(true);
    expect(isExpired(future)).toBe(false);
  });

  it("masks emails without exposing full local part", () => {
    expect(maskEmail("recipient@example.com")).toBe("r***@example.com");
  });
});

describe("verified delivery email guard", () => {
  it("requires both email and verified_at", () => {
    expect(hasVerifiedDeliveryEmail(letterRow())).toBe(true);
    expect(
      hasVerifiedDeliveryEmail(
        letterRow({ recipient_email: null, delivery_email_verified_at: null }),
      ),
    ).toBe(false);
    expect(
      hasVerifiedDeliveryEmail(
        letterRow({ delivery_email_verified_at: null }),
      ),
    ).toBe(false);
  });
});

describe("management email templates", () => {
  it("never includes letter body placeholders", () => {
    const html = buildManagementLinkHtml("https://example.com/activate?token=x");
    expect(html).not.toContain("DUMMY:");
    expect(buildManagementLinkSubject()).not.toContain("letter content");
    const verifyHtml = buildDeliveryEmailVerifyHtml(
      "https://example.com/confirm?token=x",
    );
    expect(verifyHtml).toContain("No letter content");
    expect(buildDeliveryEmailVerifySubject()).not.toContain("DUMMY:");
  });
});

describe("management request generic responses", () => {
  it("returns same generic message for missing fields", async () => {
    const response = await handleManagementRequest(
      new Request("https://example.com/v1/staging/management/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
      stagingEnv(),
    );
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toEqual(MANAGEMENT_REQUEST_OK);
  });

  it("returns generic message for invalid letter id without DB", async () => {
    const response = await handleManagementRequest(
      new Request("https://example.com/v1/staging/management/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          letter_id: "00000000-0000-4000-8000-000000000099",
          purchaser_email: "buyer@example.com",
        }),
      }),
      stagingEnv(),
    );
    expect(response.status).toBe(200);
    const json = (await response.json()) as { message?: string };
    expect(json.message).toBe(MANAGEMENT_REQUEST_OK.message);
  });

  it("returns generic message for wrong purchaser email", async () => {
    const response = await handleManagementRequest(
      new Request("https://example.com/v1/staging/management/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          letter_id: "00000000-0000-4000-8000-000000000001",
          purchaser_email: "wrong@example.com",
        }),
      }),
      stagingEnv(),
    );
    expect(response.status).toBe(200);
    const json = (await response.json()) as { message?: string };
    expect(json.message).toBe(MANAGEMENT_REQUEST_OK.message);
  });
});

describe("management magic link prefetch regression", () => {
  it("email href targets UI management_token, not worker GET activate", () => {
    const uiUrl = buildManagementUiActivateUrl(
      {
        VAULT_ENV: "staging",
        LETTER_VAULT_UI_BASE_URL:
          "https://letter-vault-phase7-preview.becoming366-website.pages.dev",
      },
      "sample-token",
    );
    const html = buildManagementLinkHtml(uiUrl);
    expect(html).toContain(uiUrl);
    expect(html).not.toContain("/v1/staging/management/activate");
  });
});

describe("management activate and session", () => {
  it("rejects missing token", async () => {
    const response = await handleManagementActivatePost(
      new Request("https://example.com/v1/staging/management/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
      stagingEnv(),
    );
    expect(response.status).toBe(401);
  });

  it("rejects invalid token without DB match", async () => {
    const response = await handleManagementActivatePost(
      new Request("https://example.com/v1/staging/management/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: generateSecureToken() }),
      }),
      stagingEnv(),
    );
    expect(response.status).toBe(401);
  });

  it("session view requires session header", async () => {
    const response = await handleManagementSessionView(
      new Request("https://example.com/v1/staging/management/session"),
      stagingEnv(),
    );
    expect(response.status).toBe(401);
  });

  it("session view rejects invalid session", async () => {
    const response = await handleManagementSessionView(
      new Request("https://example.com/v1/staging/management/session", {
        headers: { [SESSION_HEADER]: generateSecureToken() },
      }),
      stagingEnv(),
    );
    expect(response.status).toBe(401);
  });
});

describe("delivery email change request", () => {
  it("requires management session", async () => {
    const response = await handleDeliveryEmailChangeRequest(
      new Request(
        "https://example.com/v1/staging/management/delivery-email/request",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ new_delivery_email: "new@example.com" }),
        },
      ),
      stagingEnv(),
    );
    expect(response.status).toBe(401);
  });
});

describe("worker router phase6", () => {
  it("routes POST /v1/staging/management/request", async () => {
    const worker = (await import("../src/index")).default;
    const response = await worker.fetch(
      new Request("https://example.com/v1/staging/management/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          letter_id: "00000000-0000-4000-8000-000000000001",
          purchaser_email: "buyer@example.com",
        }),
      }),
      stagingEnv(),
    );
    expect(response.status).toBe(200);
  });

  it("routes GET /v1/staging/management/session", async () => {
    const worker = (await import("../src/index")).default;
    const response = await worker.fetch(
      new Request("https://example.com/v1/staging/management/session"),
      stagingEnv(),
    );
    expect(response.status).toBe(401);
  });
});

describe("phase7 customer UI", () => {
  it("vault API has no admin letter-body endpoint", async () => {
    const worker = (await import("../src/index")).default;
    const response = await worker.fetch(
      new Request("https://example.com/v1/admin/letters/decrypt"),
      stagingEnv(),
    );
    expect(response.status).toBe(404);
  });
});
