import { describe, expect, it } from "vitest";
import { buildManagementUiActivateUrl } from "../src/lib/management-link";
import {
  canDeliverToRecipient,
  hasVerifiedDeliveryEmail,
} from "../src/db/letters";
import {
  previewRecurringSlots,
  validateMilestoneSelection,
  generateCollectionSlots,
} from "../src/lib/collection-slots";

describe("delivery email modes", () => {
  it("surprise mode allows delivery without recipient verification", () => {
    expect(
      canDeliverToRecipient({
        recipient_email: "child@example.com",
        delivery_email_verified_at: null,
        delivery_email_mode: "surprise",
      }),
    ).toBe(true);
  });

  it("verified mode requires verification timestamp", () => {
    expect(
      canDeliverToRecipient({
        recipient_email: "child@example.com",
        delivery_email_verified_at: null,
        delivery_email_mode: "verified",
      }),
    ).toBe(false);
    expect(
      canDeliverToRecipient({
        recipient_email: "child@example.com",
        delivery_email_verified_at: "2026-01-01T00:00:00.000Z",
        delivery_email_mode: "verified",
      }),
    ).toBe(true);
  });

  it("hasVerifiedDeliveryEmail delegates to canDeliverToRecipient", () => {
    expect(
      hasVerifiedDeliveryEmail({
        recipient_email: "a@example.com",
        delivery_email_verified_at: null,
        delivery_email_mode: "surprise",
      }),
    ).toBe(true);
  });
});

describe("recurring initialization", () => {
  const now = new Date("2026-09-08T12:00:00.000Z");

  it("requires base date for recurring slot generation", () => {
    expect(() =>
      generateCollectionSlots("RECURRING", 5, null, undefined),
    ).toThrow("base_date_required");
  });

  it("preview recurring dates from customer-provided base date", () => {
    const previews = previewRecurringSlots(
      "2015-03-20",
      5,
      { recurring_type: "anniversary" },
      now,
    );
    expect(previews).toHaveLength(5);
    expect(previews[0].delivery_written).toMatch(/March 20, 2027/);
    expect(previews[4].delivery_written).toMatch(/March 20, 2031/);
  });
});

describe("management request letter lookup", () => {
  it("treats LV- public ids as non-uuid (avoids invalid uuid query)", () => {
    const looksLikeLetterUuid = (value: string) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      );
    expect(looksLikeLetterUuid("LV-A2696ADB")).toBe(false);
    expect(looksLikeLetterUuid("a2696adb-ffaf-42c5-a2e5-8d1748d75fad")).toBe(true);
  });
});

describe("management magic link URL", () => {
  it("points to preview UI with management_token (not worker GET activate)", () => {
    const url = buildManagementUiActivateUrl(
      {
        VAULT_ENV: "staging",
        LETTER_VAULT_UI_BASE_URL:
          "https://letter-vault-phase7-preview.becoming366-website.pages.dev",
      },
      "test-token-value",
    );
    expect(url).toContain("letter-vault/index.html");
    expect(url).toContain("management_token=test-token-value");
    expect(url).not.toContain("/v1/staging/management/activate");
  });
});

describe("fixed milestones preserved", () => {
  const now = new Date("2026-09-08T12:00:00.000Z");

  it("still requires explicit customer milestone selection", () => {
    expect(() =>
      generateCollectionSlots(
        "FIXED_MILESTONES",
        5,
        "2010-06-15",
        undefined,
        { milestones: [16, 18, 21, 25, 30, 40, 50] },
      ),
    ).toThrow("selected_milestone_ages_required");
  });

  it("rejects unsupported milestone ages not in template", () => {
    const validation = validateMilestoneSelection(
      "2010-06-15",
      [18, 21, 25, 30, 55],
      5,
      { milestones: [16, 18, 21, 25, 30, 40, 50] },
      now,
    );
    expect(validation.ok).toBe(false);
    expect(validation.code).toBe("unsupported_milestone");
  });
});
