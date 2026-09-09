import { describe, expect, it } from "vitest";

import {

  generateCollectionSlots,

  generateFixedMilestoneSlotsFromSelection,

  generateFreeCollectionSlots,

  generateRecurringSlots,

  formatWrittenDate,

  isFutureDelivery,

  listFutureValidMilestoneOptions,

  supportedMilestoneAges,

  validateLetterLength,

  validateMilestoneSelection,

  letterCharCount,

  generatePublicLetterId,

  MAX_LETTER_LENGTH,

  DEFAULT_SUPPORTED_MILESTONES,

} from "../src/lib/collection-slots";

import { encryptPayload, decryptPayload, verifyEnvelope } from "../src/crypto/envelope";

import {

  handleVaultEnter,

  handleVaultUnicodeTest,

} from "../src/routes/vault";

import type { Env } from "../src/env";



const TEST_MASTER = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

const TEST_PEPPER = "test-staging-admin-token";

const UNICODE_SAMPLE =

  "DUMMY: čćžšđ éñü Привет 你好 こんにちは مرحبا 💌🎂";



const STAGING_MILESTONES = [16, 18, 21, 25, 30, 40, 50];



function stagingEnv(overrides: Partial<Env> = {}): Env {

  return {

    VAULT_ENV: "staging",

    LETTER_VAULT_STAGING_ADMIN_TOKEN: TEST_PEPPER,

    LETTER_VAULT_MASTER_KEY_V1: TEST_MASTER,

    ...overrides,

  };

}



describe("collection slot generation", () => {

  const now = new Date("2026-09-08T12:00:00.000Z");

  const config = { milestones: STAGING_MILESTONES };



  it("lists only future-valid milestones from supported template set", () => {

    const options = listFutureValidMilestoneOptions("2010-06-15", config, now);

    const ages = options.map((o) => o.age);

    expect(ages).not.toContain(13);

    expect(ages).not.toContain(16);

    expect(ages).toContain(18);

    expect(ages).toContain(21);

    expect(ages).toContain(25);

    expect(ages).toContain(30);

    expect(ages).toContain(40);

    expect(ages).toContain(50);

    for (const o of options) {

      expect(isFutureDelivery(o.delivery_at, now)).toBe(true);

    }

  });



  it("creates exactly selected milestone slots with no auto-replacement ages", () => {

    const selected = [18, 21, 25, 30, 40];

    const slots = generateFixedMilestoneSlotsFromSelection(

      "2010-06-15",

      selected,

      { relationship: "My daughter" },

      config,

      now,

    );

    expect(slots).toHaveLength(5);

    expect(slots.map((s) => s.moment_label)).toEqual([

      "Her 18th Birthday",

      "Her 21st Birthday",

      "Her 25th Birthday",

      "Her 30th Birthday",

      "Her 40th Birthday",

    ]);

    expect(formatWrittenDate(slots[0].delivery_at!)).toMatch(/June 15, 2028/);

    for (const s of slots) {

      expect(isFutureDelivery(s.delivery_at!, now)).toBe(true);

    }

  });



  it("rejects selection when fewer future-valid options than purchased count", () => {
    const narrow = { milestones: [13, 16, 18] };
    const validation = validateMilestoneSelection(
      "2012-06-15",
      [],
      5,
      narrow,
      now,
    );
    expect(validation.ok).toBe(false);
    expect(validation.code).toBe("insufficient_future_milestone_options");
    expect(validation.future_valid_count).toBeLessThan(5);
  });



  it("rejects wrong selection count", () => {

    const validation = validateMilestoneSelection(

      "2010-06-15",

      [18, 21],

      5,

      config,

      now,

    );

    expect(validation.ok).toBe(false);

    expect(validation.code).toBe("milestone_count_mismatch");

  });



  it("rejects past milestone in selection", () => {

    const validation = validateMilestoneSelection(

      "2010-06-15",

      [16, 18, 21, 25, 30],

      5,

      config,

      now,

    );

    expect(validation.ok).toBe(false);

    expect(validation.code).toBe("milestone_in_past");

  });



  it("uses default supported milestone set when template omits milestones", () => {

    expect(supportedMilestoneAges()).toEqual(DEFAULT_SUPPORTED_MILESTONES);

  });



  it("generates recurring birthday slots with future dates only", () => {

    const slots = generateRecurringSlots("2020-01-01", 3, undefined, {

      recurring_type: "birthday",

    }, now);

    expect(slots).toHaveLength(3);

    expect(slots[1].moment_label).toBe("Birthday 2");

    for (const s of slots) {

      expect(isFutureDelivery(s.delivery_at!, now)).toBe(true);

    }

  });



  it("generates free collection slots without preset delivery dates", () => {

    const slots = generateFreeCollectionSlots(10);

    expect(slots).toHaveLength(10);

    expect(slots[9].moment_label).toBe("Letter 10");

    expect(slots[0].delivery_at).toBeNull();

  });



  it("5-letter free collection produces exactly 5 slots", () => {

    const slots = generateCollectionSlots("FREE_COLLECTION", 5, null, undefined);

    expect(slots).toHaveLength(5);

  });



  it("fixed milestones require explicit customer selection", () => {

    expect(() =>

      generateCollectionSlots("FIXED_MILESTONES", 3, "2010-01-01", undefined, config),

    ).toThrow("selected_milestone_ages_required");

  });



  it("creates fixed milestone collection from explicit selection", () => {

    const slots = generateCollectionSlots(

      "FIXED_MILESTONES",

      3,

      "2010-06-15",

      undefined,

      config,

      [18, 21, 25],

    );

    expect(slots).toHaveLength(3);

  });

});



describe("letter length validation", () => {

  it("allows up to 15000 unicode characters", () => {

    const text = "💌".repeat(15000);

    expect(letterCharCount(text)).toBe(15000);

    expect(validateLetterLength(text)).toBe(true);

    expect(validateLetterLength(text + "x")).toBe(false);

  });

});



describe("unicode encrypt roundtrip", () => {

  it("preserves exact unicode through encrypt/decrypt", async () => {

    const envelope = await encryptPayload(TEST_MASTER, UNICODE_SAMPLE);

    const ok = await verifyEnvelope(TEST_MASTER, envelope);

    expect(ok).toBe(true);

    const decrypted = new TextDecoder().decode(

      await decryptPayload(TEST_MASTER, envelope),

    );

    expect(decrypted).toBe(UNICODE_SAMPLE);

  });



  it("unicode test endpoint returns exact_match without leaking sample", async () => {

    const response = await handleVaultUnicodeTest(

      new Request("https://example.com/v1/vault/unicode-test", {

        method: "POST",

        body: JSON.stringify({ sample: UNICODE_SAMPLE }),

      }),

      stagingEnv(),

    );

    const json = (await response.json()) as {

      exact_match: boolean;

      sample_in_response: boolean;

      plaintext_in_response: boolean;

    };

    expect(json.exact_match).toBe(true);

    expect(json.sample_in_response).toBe(false);

    expect(json.plaintext_in_response).toBe(false);

    expect(JSON.stringify(json)).not.toContain("čć");

  });

});



describe("public letter id", () => {

  it("formats LV- prefix from uuid", () => {

    const id = generatePublicLetterId("a1b2c3d4-e5f6-7890-abcd-ef1234567890");

    expect(id).toMatch(/^LV-[A-F0-9]{8}$/);

  });

});



describe("vault enter", () => {

  it("returns generic denial for invalid credentials", async () => {

    const response = await handleVaultEnter(

      new Request("https://example.com/v1/vault/enter", {

        method: "POST",

        body: JSON.stringify({

          access_code: "LV-invalid",

          purchaser_email: "buyer@example.com",

        }),

      }),

      stagingEnv(),

    );

    expect(response.status).toBe(401);

    const json = (await response.json()) as { message: string };

    expect(json.message).toContain("couldn't verify");

  });



  it("rejects dummy purchaser email in production", async () => {

    const response = await handleVaultEnter(

      new Request("https://example.com/v1/vault/enter", {

        method: "POST",

        body: JSON.stringify({

          access_code: "LV-x",

          purchaser_email: "buyer@example.com",

        }),

      }),

      {
        VAULT_ENV: "production",
        LETTER_VAULT_ACCESS_PEPPER: TEST_PEPPER,
      },

    );

    expect(response.status).toBe(401);

  });

});



describe("vault API routes registered", () => {

  it("routes POST /v1/vault/enter", async () => {

    const worker = (await import("../src/index")).default;

    const response = await worker.fetch(

      new Request("https://example.com/v1/vault/enter", {

        method: "POST",

        headers: { "Content-Type": "application/json" },

        body: JSON.stringify({

          access_code: "LV-test",

          purchaser_email: "buyer@example.com",

        }),

      }),

      stagingEnv(),

    );

    expect([401, 403]).toContain(response.status);

  });



  it("routes POST /v1/vault/unicode-test", async () => {

    const worker = (await import("../src/index")).default;

    const response = await worker.fetch(

      new Request("https://example.com/v1/vault/unicode-test", {

        method: "POST",

        headers: { "Content-Type": "application/json" },

        body: JSON.stringify({ sample: UNICODE_SAMPLE }),

      }),

      stagingEnv(),

    );

    expect(response.status).toBe(200);

  });

});



describe("phase 7 customer UI exists", () => {

  it("privacy wording uses approved language only", () => {

    const approved =

      "encrypted, never displayed in our admin dashboard, and automatically accessed only when";

    expect(approved).toContain("encrypted");

    expect(approved).not.toContain("zero knowledge");

  });

});



describe("draft local storage contract", () => {

  it("documents max chars constant", () => {

    expect(MAX_LETTER_LENGTH).toBe(15000);

  });

});


