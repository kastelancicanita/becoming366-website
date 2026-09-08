import { describe, expect, it } from "vitest";
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
