import { describe, expect, it } from "vitest";
import {
  generateAccessCode,
  hashAccessCode,
  normalizePurchaserEmail,
} from "../src/crypto/access-code";
import { ACCESS_DENIED_BODY } from "../src/lib/access-response";
import {
  assertDummyOrderRef,
  assertDummyPurchaserEmail,
} from "../src/lib/dummy-guard";
import {
  handleEntitlementConsume,
  handleEntitlementIssue,
  handleEntitlementVerify,
} from "../src/routes/entitlements";
import type { Env } from "../src/env";

const TEST_PEPPER = "test-staging-admin-pepper-not-real";
const TEST_EMAIL = "dummy-buyer@example.com";

function stagingEnv(overrides: Partial<Env> = {}): Env {
  return {
    VAULT_ENV: "staging",
    LETTER_VAULT_STAGING_ADMIN_TOKEN: TEST_PEPPER,
    LETTER_VAULT_MASTER_KEY_V1: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    ...overrides,
  };
}

function adminRequest(url: string, body: unknown, env: Env): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Letter-Vault-Staging-Admin": env.LETTER_VAULT_STAGING_ADMIN_TOKEN!,
    },
    body: JSON.stringify(body),
  });
}

describe("access code crypto", () => {
  it("generates codes with LV- prefix and high length", () => {
    const code = generateAccessCode();
    expect(code.startsWith("LV-")).toBe(true);
    expect(code.length).toBeGreaterThan(20);
  });

  it("produces stable HMAC hash", async () => {
    const hashA = await hashAccessCode(TEST_PEPPER, "LV-testcode");
    const hashB = await hashAccessCode(TEST_PEPPER, "LV-testcode");
    expect(hashA).toBe(hashB);
    expect(hashA).toMatch(/^[0-9a-f]{64}$/);
  });

  it("different codes produce different hashes", async () => {
    const a = await hashAccessCode(TEST_PEPPER, "LV-aaa");
    const b = await hashAccessCode(TEST_PEPPER, "LV-bbb");
    expect(a).not.toBe(b);
  });

  it("normalizes purchaser email", () => {
    expect(normalizePurchaserEmail("  Dummy-Buyer@Example.COM ")).toBe(
      "dummy-buyer@example.com",
    );
  });
});

describe("dummy guards", () => {
  it("accepts dummy example.com emails", () => {
    expect(assertDummyPurchaserEmail("dummy-buyer@example.com")).toBeNull();
  });

  it("rejects real-looking domains", () => {
    expect(assertDummyPurchaserEmail("buyer@gmail.com")).not.toBeNull();
  });

  it("requires DUMMY- order refs", () => {
    expect(assertDummyOrderRef("DUMMY-ORDER-001")).toBeNull();
    expect(assertDummyOrderRef("ETSY-123")).not.toBeNull();
  });
});

describe("generic access responses", () => {
  it("uses same body for access denied", () => {
    expect(ACCESS_DENIED_BODY.message).toBe("Unable to verify access.");
    expect(ACCESS_DENIED_BODY.error).toBe("access_denied");
  });
});

describe("entitlement routes", () => {
  it("issue rejects without admin header", async () => {
    const response = await handleEntitlementIssue(
      new Request("https://example.com/v1/staging/entitlements/issue", {
        method: "POST",
        body: JSON.stringify({
          purchaser_email: TEST_EMAIL,
          external_order_ref: "DUMMY-ORDER-001",
        }),
      }),
      stagingEnv(),
    );
    expect(response.status).toBe(401);
    const body = (await response.json()) as Record<string, string>;
    expect(body.error).toBe("access_denied");
  });

  it("verify returns generic denial without DB", async () => {
    const response = await handleEntitlementVerify(
      new Request("https://example.com/v1/staging/entitlements/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          access_code: "LV-notreal",
          purchaser_email: TEST_EMAIL,
        }),
      }),
      stagingEnv(),
    );
    expect(response.status).toBe(401);
    const body = (await response.json()) as Record<string, string>;
    expect(body.error).toBe("access_denied");
  });

  it("consume returns generic denial without DB", async () => {
    const response = await handleEntitlementConsume(
      new Request("https://example.com/v1/staging/entitlements/consume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          access_code: "LV-notreal",
          purchaser_email: TEST_EMAIL,
        }),
      }),
      stagingEnv(),
    );
    expect(response.status).toBe(401);
  });

  it("verify rejects non-staging environment", async () => {
    const response = await handleEntitlementVerify(
      new Request("https://example.com/v1/staging/entitlements/verify", {
        method: "POST",
        body: JSON.stringify({
          access_code: "LV-x",
          purchaser_email: TEST_EMAIL,
        }),
      }),
      { VAULT_ENV: "production", LETTER_VAULT_STAGING_ADMIN_TOKEN: TEST_PEPPER },
    );
    expect(response.status).toBe(403);
  });

  it("issue fails gracefully without DB", async () => {
    const response = await handleEntitlementIssue(
      adminRequest(
        "https://example.com/v1/staging/entitlements/issue",
        {
          purchaser_email: TEST_EMAIL,
          external_order_ref: "DUMMY-ORDER-001",
        },
        stagingEnv(),
      ),
      stagingEnv(),
    );
    expect(response.status).toBeGreaterThanOrEqual(500);
  });

  it("issue allows collection letters_allowed up to 10 (Phase 7)", async () => {
    const response = await handleEntitlementIssue(
      adminRequest(
        "https://example.com/v1/staging/entitlements/issue",
        {
          purchaser_email: TEST_EMAIL,
          external_order_ref: "DUMMY-ORDER-BUNDLE",
          letters_allowed: 5,
          product_type: "COLLECTION",
          collection_mechanism: "FIXED_MILESTONES",
          display_title: "5 Milestone Letters",
        },
        stagingEnv(),
      ),
      stagingEnv(),
    );
    expect([200, 500, 503]).toContain(response.status);
  });
});

describe("worker router phase3", () => {
  it("routes POST /v1/staging/entitlements/verify", async () => {
    const worker = (await import("../src/index")).default;
    const response = await worker.fetch(
      new Request("https://example.com/v1/staging/entitlements/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          access_code: "LV-test",
          purchaser_email: TEST_EMAIL,
        }),
      }),
      stagingEnv(),
    );
    expect([401, 429]).toContain(response.status);
  });
});

describe("hash-only storage contract", () => {
  it("hash output is not reversible to raw code in API layer", async () => {
    const code = "LV-secret-code-for-test";
    const hash = await hashAccessCode(TEST_PEPPER, code);
    expect(hash).not.toContain("secret");
    expect(hash).not.toBe(code);
  });
});
