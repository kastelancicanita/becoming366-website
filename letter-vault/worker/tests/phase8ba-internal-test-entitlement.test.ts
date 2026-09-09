import { describe, expect, it, vi, afterEach } from "vitest";
import type { Env } from "../src/env";
import {
  assertInternalTestEntitlementPolicy,
  buildInternalTestOrderRef,
  isInternalTestEntitlement,
} from "../src/lib/internal-test-entitlement";
import { assertProductionEntitlement } from "../src/lib/production-data-guard";

const productionEnv = (overrides: Partial<Env> = {}): Env => ({
  VAULT_ENV: "production",
  LETTER_VAULT_ACCESS_PEPPER: "test-pepper-32-chars-minimum!!",
  LETTER_VAULT_PRODUCTION_ADMIN_TOKEN: "admin-token-test",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
  ...overrides,
});

describe("8B-A internal test entitlement policy", () => {
  it("builds INTERNAL_TEST order refs", () => {
    const ref = buildInternalTestOrderRef();
    expect(ref.startsWith("INTERNAL_TEST-")).toBe(true);
  });

  it("allows properly tagged internal test rows in production vault", () => {
    const ref = buildInternalTestOrderRef();
    expect(
      assertProductionEntitlement({
        source: "internal_test",
        external_order_ref: ref,
      }),
    ).toBeNull();
    expect(
      isInternalTestEntitlement({
        source: "internal_test",
        external_order_ref: ref,
      }),
    ).toBe(true);
  });

  it("still blocks DUMMY and staging entitlements in production", () => {
    expect(
      assertProductionEntitlement({
        source: "manual_staging",
        external_order_ref: "DUMMY-123",
      }),
    ).toBeTruthy();
    expect(
      assertProductionEntitlement({
        source: "etsy_manual",
        external_order_ref: "DUMMY-123",
      }),
    ).toBeTruthy();
  });

  it("blocks INTERNAL_TEST ref without internal_test source", () => {
    expect(
      assertInternalTestEntitlementPolicy({
        source: "etsy_manual",
        external_order_ref: "INTERNAL_TEST-not-allowed",
      }),
    ).toBe("test_entitlement_not_allowed_in_production");
  });
});

describe("8B-A issue internal test route", () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("returns 403 outside production", async () => {
    const { handleProductionIssueInternalTestEntitlement } = await import(
      "../src/routes/production-entitlements"
    );
    const res = await handleProductionIssueInternalTestEntitlement(
      new Request(
        "https://example.com/v1/production/ops/issue-internal-test-entitlement",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ purchaser_email: "friend@gmail.com" }),
        },
      ),
      { VAULT_ENV: "staging" },
    );
    expect(res.status).toBe(403);
  });

  it("issues single-letter internal test with access code once", async () => {
    vi.doMock("../src/db/vault", () => ({
      insertEntitlementExtended: vi.fn().mockResolvedValue({
        id: "ent-internal-1",
        purchaser_email: "friend@gmail.com",
        status: "active",
        letters_allowed: 1,
        letters_used: 0,
        product_type: "SINGLE",
        collection_mechanism: "SINGLE",
        display_title: "INTERNAL_TEST — Friend E2E (single letter)",
      }),
    }));

    const { handleProductionIssueInternalTestEntitlement } = await import(
      "../src/routes/production-entitlements"
    );
    const res = await handleProductionIssueInternalTestEntitlement(
      new Request(
        "https://example.com/v1/production/ops/issue-internal-test-entitlement",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Letter-Vault-Staging-Admin": "admin-token-test",
          },
          body: JSON.stringify({ purchaser_email: "friend@gmail.com" }),
        },
      ),
      productionEnv(),
    );
    const body = (await res.json()) as {
      status: string;
      kind: string;
      access_code: string;
      external_order_ref: string;
      etsy_sale: boolean;
      email_sent: boolean;
    };

    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.kind).toBe("internal_test");
    expect(body.access_code).toMatch(/^LV-/);
    expect(body.external_order_ref.startsWith("INTERNAL_TEST-")).toBe(true);
    expect(body.etsy_sale).toBe(false);
    expect(body.email_sent).toBe(false);
  });
});

describe("8B-A revoke internal test route", () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("refuses to revoke non-internal entitlements", async () => {
    vi.doMock("../src/db/internal-test-cleanup", () => ({
      fetchInternalTestEntitlement: vi.fn().mockResolvedValue({
        id: "ent-1",
        source: "etsy_manual",
        external_order_ref: "ETSY-1234567890",
        purchaser_email: "buyer@gmail.com",
        status: "active",
      }),
      fetchInternalTestEntitlementByRef: vi.fn(),
      assertRevocableInternalTest: vi.fn().mockImplementation((row) => {
        if (row.source !== "internal_test") {
          throw new Error("not_internal_test_entitlement");
        }
      }),
      deleteInternalTestEntitlement: vi.fn(),
    }));

    const { handleProductionRevokeInternalTestEntitlement } = await import(
      "../src/routes/production-entitlements"
    );
    const res = await handleProductionRevokeInternalTestEntitlement(
      new Request(
        "https://example.com/v1/production/ops/revoke-internal-test-entitlement",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Letter-Vault-Staging-Admin": "admin-token-test",
          },
          body: JSON.stringify({ entitlement_id: "ent-1" }),
        },
      ),
      productionEnv(),
    );
    expect(res.status).toBe(403);
  });
});
