/** Phase 3 staging: restrict to dummy purchaser emails only. */

const ALLOWED_DUMMY_DOMAINS = [
  "example.com",
  "example.org",
  "test.local",
  "resend.dev", // Resend official test sink (delivered@, bounced@, etc.)
];

export function assertDummyPurchaserEmail(email: string): string | null {
  const normalized = email.trim().toLowerCase();
  if (!normalized.includes("@")) {
    return "purchaser_email must be a valid email address";
  }
  const domain = normalized.split("@")[1];
  if (!ALLOWED_DUMMY_DOMAINS.includes(domain)) {
    return "Phase 3 staging accepts dummy emails only (e.g. dummy-buyer@example.com)";
  }
  if (normalized.includes("anita") || normalized.includes("kastelancic")) {
    return "Real personal emails are not allowed in staging";
  }
  return null;
}

export function assertDummyOrderRef(ref: string): string | null {
  const trimmed = ref.trim();
  if (!trimmed.startsWith("DUMMY-")) {
    return "external_order_ref must start with DUMMY- (staging only)";
  }
  if (trimmed.length > 128) {
    return "external_order_ref exceeds 128 characters";
  }
  return null;
}

export function isDummyEmailDomain(email: string): boolean {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  return ALLOWED_DUMMY_DOMAINS.includes(domain);
}

export function isTestOrderRef(ref: string): boolean {
  const trimmed = ref.trim().toUpperCase();
  return (
    trimmed.startsWith("DUMMY-") ||
    trimmed.startsWith("TEST-") ||
    trimmed.startsWith("INTERNAL_TEST-")
  );
}
