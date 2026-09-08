import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  canReuseManagementSession,
  MGMT_SESSION_STORE_KEY,
  parseMgmtSession,
  serializeMgmtSession,
} from "../src/lib/management-session-client";
import type { Env } from "../src/env";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const LETTER_VAULT_ROOT = join(TEST_DIR, "..", "..");

const TEST_MASTER = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const letterId = "00000000-0000-4000-8000-000000000001";
const sessionToken = "mgmt-session-token";

function stagingEnv(overrides: Partial<Env> = {}): Env {
  return {
    VAULT_ENV: "staging",
    LETTER_VAULT_STAGING_ADMIN_TOKEN: "test-staging-admin-token",
    LETTER_VAULT_MASTER_KEY_V1: TEST_MASTER,
    RESEND_API_KEY: "re_test_not_real",
    ...overrides,
  };
}

vi.mock("../src/db/management", () => ({
  validateManagementToken: vi.fn(async () => ({
    id: "tok-row",
    letter_id: letterId,
  })),
  createManagementSession: vi.fn(async () => ({
    session_token: sessionToken,
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
  })),
  markManagementTokenUsed: vi.fn(async () => true),
  validateManagementSession: vi.fn(async (_env: Env, token: string) =>
    token === sessionToken ? { letter_id: letterId } : null,
  ),
  getLetterManagementMetadata: vi.fn(async () => ({
    scheduled_delivery_at: "2027-03-20T00:00:00.000Z",
    delivery_email_masked: null,
    has_delivery_email: false,
  })),
  activateSurpriseDeliveryEmail: vi.fn(async () => undefined),
  auditDeliveryEmail: vi.fn(async () => undefined),
  createDeliveryEmailChange: vi.fn(),
  createManagementToken: vi.fn(),
  findLetterByIdAndPurchaser: vi.fn(),
  findLetterByPublicIdAndPurchaser: vi.fn(),
  verifyDeliveryEmailChange: vi.fn(),
}));

vi.mock("../src/db/letters", () => ({
  fetchLetterById: vi.fn(async () => ({
    id: letterId,
    recipient_email: null,
    delivery_email_verified_at: null,
    delivery_email_mode: "verified",
  })),
  hasVerifiedDeliveryEmail: vi.fn(),
}));

vi.mock("../src/email/resend-client", () => ({
  sendViaResend: vi.fn(async () => ({ id: "email-id" })),
}));

describe("management session client reuse", () => {
  it("uses a stable sessionStorage key", () => {
    expect(MGMT_SESSION_STORE_KEY).toBe("lv_mgmt_session_v1");
  });

  it("reuses session for the same letter after back navigation", () => {
    expect(
      canReuseManagementSession(
        { session: "sess-abc", letterId: "LV-A2696ADB" },
        "LV-A2696ADB",
      ),
    ).toBe(true);
    expect(
      canReuseManagementSession(
        { session: "sess-abc", letterId: "lv-a2696adb" },
        "LV-A2696ADB",
      ),
    ).toBe(true);
  });

  it("reuses session when letter id was not stored yet", () => {
    expect(
      canReuseManagementSession(
        { session: "sess-abc", letterId: null },
        "LV-A2696ADB",
      ),
    ).toBe(true);
  });

  it("does not reuse session for a different letter", () => {
    expect(
      canReuseManagementSession(
        { session: "sess-abc", letterId: "LV-OTHER123" },
        "LV-A2696ADB",
      ),
    ).toBe(false);
  });

  it("does not reuse when session is missing", () => {
    expect(
      canReuseManagementSession(
        { session: null, letterId: "LV-A2696ADB" },
        "LV-A2696ADB",
      ),
    ).toBe(false);
  });

  it("round-trips sessionStorage payload", () => {
    const raw = serializeMgmtSession("sess-token", "LV-ABC12345");
    expect(parseMgmtSession(raw)).toEqual({
      session: "sess-token",
      letterId: "LV-ABC12345",
    });
  });
});

describe("progress indicator encoding regression", () => {
  it("uses CSS middle-dot separators instead of raw unicode in app.js", () => {
    const appJs = readFileSync(join(LETTER_VAULT_ROOT, "js", "app.js"), "utf8");
    expect(appJs).toContain("<span>Recipient</span><span>Date</span>");
    expect(appJs).not.toMatch(/Recipient\s[\u00b7\u2022·]\sDate/);
  });

  it("defines progress step separators in CSS", () => {
    const css = readFileSync(join(LETTER_VAULT_ROOT, "css", "vault.css"), "utf8");
    expect(css).toContain('content: "\\00b7"');
    expect(css).toContain(".progress-steps > span:not(:first-child)::before");
  });
});

describe("management session flow regression", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("activate → session → delivery-email succeeds with one session header", async () => {
    const {
      handleManagementActivatePost,
      handleManagementSessionView,
      handleDeliveryEmailChangeRequest,
      SESSION_HEADER,
    } = await import("../src/routes/management");

    const activateRes = await handleManagementActivatePost(
      new Request("https://example.com/v1/staging/management/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "magic-link-token" }),
      }),
      stagingEnv(),
    );
    expect(activateRes.status).toBe(200);
    const activateJson = (await activateRes.json()) as {
      status?: string;
      session_token?: string;
    };
    expect(activateJson.status).toBe("ok");
    expect(activateJson.session_token).toBe(sessionToken);

    const sessionRes = await handleManagementSessionView(
      new Request("https://example.com/v1/staging/management/session", {
        headers: { [SESSION_HEADER]: sessionToken },
      }),
      stagingEnv(),
    );
    expect(sessionRes.status).toBe(200);

    const deliveryRes = await handleDeliveryEmailChangeRequest(
      new Request(
        "https://example.com/v1/staging/management/delivery-email/request",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            [SESSION_HEADER]: sessionToken,
          },
          body: JSON.stringify({
            new_delivery_email: "child@example.com",
            delivery_email_mode: "surprise",
          }),
        },
      ),
      stagingEnv(),
    );
    expect(deliveryRes.status).toBe(200);
    const deliveryJson = (await deliveryRes.json()) as { status?: string };
    expect(deliveryJson.status).toBe("ok");
  });
});

describe("manage.js session reuse regression", () => {
  it("restores session from storage and opens management when session is valid", () => {
    const manageJs = readFileSync(
      join(LETTER_VAULT_ROOT, "js", "manage.js"),
      "utf8",
    );
    expect(manageJs).toContain("restoreMgmtSession()");
    expect(manageJs).toContain("canReuseMgmtSession(lid)");
    expect(manageJs).toContain("await LvManage.openManagementSession()");
    expect(manageJs).toContain('MGMT_STORE_KEY = "lv_mgmt_session_v1"');
  });
});
