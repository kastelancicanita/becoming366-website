/**
 * Production-safe idempotency keys for Letter Vault outbound email.
 * One stable key per logical send — survives retries without duplicate provider delivery.
 */

const FUTURE_LETTER_DELIVERY_PREFIX = "LV-DELIVERY-" as const;

/** Future-letter body delivery (Resend verified / MailerSend Surprise). */
export function futureLetterDeliveryIdempotencyKey(letterId: string): string {
  const id = letterId.trim();
  if (!id) {
    throw new Error("letter_id_required_for_delivery_idempotency");
  }
  return `${FUTURE_LETTER_DELIVERY_PREFIX}${id}`;
}
