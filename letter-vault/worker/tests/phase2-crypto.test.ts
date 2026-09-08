import { describe, expect, it } from "vitest";
import {
  decryptPayload,
  encryptPayload,
  importMasterKey,
  sha256Hex,
  verifyEnvelope,
} from "../src/crypto/envelope";
import { assertDummyText, stagingOnlyResponse } from "../src/lib/staging-guard";
import {
  handlePocRoundtrip,
  handlePocSeal,
  handlePocVerify,
} from "../src/routes/poc";
import type { Env } from "../src/env";

/** 32-byte test master key (not production). */
const TEST_MASTER_KEY_B64 = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

function stagingEnv(overrides: Partial<Env> = {}): Env {
  return {
    VAULT_ENV: "staging",
    LETTER_VAULT_MASTER_KEY_V1: TEST_MASTER_KEY_B64,
    ...overrides,
  };
}

describe("envelope encryption", () => {
  it("encrypts and decrypts dummy text", async () => {
    const plaintext = "DUMMY: hello letter vault phase 2";
    const envelope = await encryptPayload(TEST_MASTER_KEY_B64, plaintext);
    const decrypted = await decryptPayload(TEST_MASTER_KEY_B64, envelope);
    expect(new TextDecoder().decode(decrypted)).toBe(plaintext);
  });

  it("verifyEnvelope confirms content hash", async () => {
    const envelope = await encryptPayload(
      TEST_MASTER_KEY_B64,
      "DUMMY: hash check",
    );
    expect(await verifyEnvelope(TEST_MASTER_KEY_B64, envelope)).toBe(true);
  });

  it("rejects invalid master key length", async () => {
    await expect(importMasterKey("AAAA")).rejects.toThrow(
      "master_key_invalid_length",
    );
  });

  it("produces different ciphertext for same plaintext", async () => {
    const text = "DUMMY: nonce uniqueness";
    const a = await encryptPayload(TEST_MASTER_KEY_B64, text);
    const b = await encryptPayload(TEST_MASTER_KEY_B64, text);
    expect(a.ciphertext_b64).not.toBe(b.ciphertext_b64);
    expect(a.wrapped_dek_b64).not.toBe(b.wrapped_dek_b64);
  });

  it("sha256Hex is stable", async () => {
    const bytes = new TextEncoder().encode("DUMMY: stable");
    const hash = await sha256Hex(bytes);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await sha256Hex(bytes)).toBe(hash);
  });
});

describe("staging guard", () => {
  it("blocks non-staging environments", () => {
    const response = stagingOnlyResponse({ VAULT_ENV: "production" });
    expect(response?.status).toBe(403);
  });

  it("allows staging", () => {
    expect(stagingOnlyResponse({ VAULT_ENV: "staging" })).toBeNull();
  });

  it("requires DUMMY: prefix", () => {
    expect(assertDummyText("real letter content")).toMatch(/DUMMY:/);
    expect(assertDummyText("DUMMY: ok")).toBeNull();
  });
});

describe("poc routes", () => {
  it("roundtrip returns decrypt_ok without plaintext", async () => {
    const response = await handlePocRoundtrip(
      new Request("https://example.com/v1/staging/poc/roundtrip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dummy_text: "DUMMY: route roundtrip" }),
      }),
      stagingEnv(),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.decrypt_ok).toBe(true);
    expect(body.plaintext_in_response).toBe(false);
    expect(JSON.stringify(body)).not.toContain("route roundtrip");
  });

  it("returns 403 outside staging", async () => {
    const response = await handlePocRoundtrip(
      new Request("https://example.com/v1/staging/poc/roundtrip", {
        method: "POST",
        body: JSON.stringify({ dummy_text: "DUMMY: blocked" }),
      }),
      { VAULT_ENV: "development", LETTER_VAULT_MASTER_KEY_V1: TEST_MASTER_KEY_B64 },
    );
    expect(response.status).toBe(403);
  });

  it("returns 503 when master key missing", async () => {
    const response = await handlePocRoundtrip(
      new Request("https://example.com/v1/staging/poc/roundtrip", {
        method: "POST",
        body: JSON.stringify({ dummy_text: "DUMMY: no key" }),
      }),
      { VAULT_ENV: "staging" },
    );
    expect(response.status).toBe(503);
  });

  it("seal fails gracefully without DB config", async () => {
    const response = await handlePocSeal(
      new Request("https://example.com/v1/staging/poc/seal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: "test",
          dummy_text: "DUMMY: seal without db",
        }),
      }),
      stagingEnv(),
    );
    expect(response.status).toBeGreaterThanOrEqual(500);
  });

  it("verify returns 404 for missing id without DB", async () => {
    const response = await handlePocVerify(
      stagingEnv(),
      "00000000-0000-4000-8000-000000000001",
    );
    expect([404, 500]).toContain(response.status);
  });
});

describe("worker router phase2", () => {
  it("routes POST /v1/staging/poc/roundtrip", async () => {
    const worker = (await import("../src/index")).default;
    const response = await worker.fetch(
      new Request("https://example.com/v1/staging/poc/roundtrip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dummy_text: "DUMMY: router" }),
      }),
      stagingEnv(),
    );
    expect(response.status).toBe(200);
  });
});
