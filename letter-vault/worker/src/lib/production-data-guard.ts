import type { Env } from "../env";
import { getVaultEnvironment } from "../env";
import { assertDummyPurchaserEmail } from "./dummy-guard";
import { jsonResponse } from "./management-response";

export function customerApiEnvironmentGuard(env: Env): Response | null {
  const envName = getVaultEnvironment(env);
  if (
    envName === "development" ||
    envName === "staging" ||
    envName === "production"
  ) {
    return null;
  }
  return jsonResponse(
    { status: "error", message: "Service unavailable." },
    503,
  );
}

export function validateCustomerPurchaserEmail(
  env: Env,
  email: string,
): string | null {
  if (getVaultEnvironment(env) === "staging") {
    return assertDummyPurchaserEmail(email);
  }
  if (getVaultEnvironment(env) === "production") {
    return assertProductionPurchaserEmail(email);
  }
  return "environment_not_supported";
}

/** Delivery/recipient address — not purchaser login email. */
export function validateCustomerDeliveryEmail(
  env: Env,
  email: string,
): string | null {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return "Invalid email address.";
  }
  if (getVaultEnvironment(env) === "staging") {
    return null;
  }
  if (getVaultEnvironment(env) === "production") {
    return assertProductionPurchaserEmail(email);
  }
  return "environment_not_supported";
}

export function assertProductionPurchaserEmail(email: string): string | null {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return "Invalid email address.";
  }
  return null;
}
