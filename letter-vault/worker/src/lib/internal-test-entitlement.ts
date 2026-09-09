/** Admin-only friend E2E entitlements — not Etsy sales. */

export const INTERNAL_TEST_SOURCE = "internal_test";
export const INTERNAL_TEST_REF_PREFIX = "INTERNAL_TEST-";
export const INTERNAL_TEST_DISPLAY_TITLE =
  "INTERNAL_TEST — Friend E2E (single letter)";

export function buildInternalTestOrderRef(): string {
  return `${INTERNAL_TEST_REF_PREFIX}${crypto.randomUUID()}`;
}

export function isInternalTestOrderRef(ref: string): boolean {
  return ref.trim().startsWith(INTERNAL_TEST_REF_PREFIX);
}

export function isInternalTestEntitlement(row: {
  source?: string | null;
  external_order_ref?: string | null;
}): boolean {
  const source = row.source?.trim().toLowerCase() ?? "";
  return (
    source === INTERNAL_TEST_SOURCE &&
    isInternalTestOrderRef(row.external_order_ref ?? "")
  );
}

/** Vault enter guard — allow only properly tagged internal test rows. */
export function assertInternalTestEntitlementPolicy(row: {
  source?: string | null;
  external_order_ref?: string | null;
}): string | null {
  const source = row.source?.trim().toLowerCase() ?? "";
  const ref = row.external_order_ref?.trim() ?? "";

  if (source === INTERNAL_TEST_SOURCE) {
    return isInternalTestOrderRef(ref)
      ? null
      : "test_entitlement_not_allowed_in_production";
  }

  if (isInternalTestOrderRef(ref)) {
    return "test_entitlement_not_allowed_in_production";
  }

  return null;
}
