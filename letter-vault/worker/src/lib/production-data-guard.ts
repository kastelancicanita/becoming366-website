import type { Env } from "../env";
import { getVaultEnvironment } from "../env";
import {
  assertDummyPurchaserEmail,
  isDummyEmailDomain,
  isTestOrderRef,
} from "./dummy-guard";
import { assertInternalTestEntitlementPolicy } from "./internal-test-entitlement";
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
  if (isDummyEmailDomain(normalized)) {
    return "Production requires a real purchaser email address.";
  }
  return null;
}

export function assertProductionEntitlement(row: {
  source?: string | null;
  external_order_ref?: string | null;
}): string | null {
  const internalPolicy = assertInternalTestEntitlementPolicy(row);
  if (internalPolicy !== null) {
    return internalPolicy;
  }
  if (row.source?.trim().toLowerCase() === "internal_test") {
    return null;
  }

  const source = row.source?.trim().toLowerCase() ?? "";
  const ref = row.external_order_ref?.trim() ?? "";

  if (source === "manual_staging" || isTestOrderRef(ref)) {
    return "test_entitlement_not_allowed_in_production";
  }

  if (
    ref.toUpperCase().startsWith("DUMMY-") ||
    ref.toUpperCase().startsWith("TEST-")
  ) {
    return "test_entitlement_not_allowed_in_production";
  }

  return null;
}

export function productionOnlyResponse(env: Env): Response | null {
  if (getVaultEnvironment(env) === "production") return null;
  return jsonResponse({ error: "production_only" }, 403);
}
