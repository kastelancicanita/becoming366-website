import { describe, expect, it } from "vitest";
import { getVaultEnvironment, hasSupabaseConfig } from "../src/env";
import type { Env } from "../src/env";

describe("env helpers", () => {
  it("defaults to development when VAULT_ENV is unset", () => {
    expect(getVaultEnvironment({ VAULT_ENV: "" })).toBe("development");
  });

  it("recognizes staging", () => {
    expect(getVaultEnvironment({ VAULT_ENV: "staging" })).toBe("staging");
  });

  it("detects missing Supabase config", () => {
    expect(hasSupabaseConfig({ VAULT_ENV: "development" })).toBe(false);
    expect(
      hasSupabaseConfig({
        VAULT_ENV: "staging",
        SUPABASE_URL: "https://example.supabase.co",
      }),
    ).toBe(false);
  });

  it("detects complete Supabase config", () => {
    const env: Env = {
      VAULT_ENV: "staging",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "test-key-not-real",
    };
    expect(hasSupabaseConfig(env)).toBe(true);
  });
});

describe("health route", () => {
  it("returns ok with database not_configured when secrets absent", async () => {
    const { handleHealth } = await import("../src/routes/health");
    const response = await handleHealth({ VAULT_ENV: "development" });
    expect(response.status).toBe(200);

    const body = (await response.json()) as Record<string, string>;
    expect(body.status).toBe("ok");
    expect(body.service).toBe("letter-vault-api");
    expect(body.environment).toBe("development");
    expect(body.database).toBe("not_configured");
    expect(body.schema_version).toBeUndefined();
  });
});

describe("worker router", () => {
  it("returns 404 for unknown paths", async () => {
    const worker = (await import("../src/index")).default;
    const response = await worker.fetch(
      new Request("https://example.com/v1/unknown"),
      { VAULT_ENV: "development" },
    );
    expect(response.status).toBe(404);
  });

  it("routes GET /v1/health", async () => {
    const worker = (await import("../src/index")).default;
    const response = await worker.fetch(
      new Request("https://example.com/v1/health"),
      { VAULT_ENV: "staging" },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, string>;
    expect(body.environment).toBe("staging");
  });
});
