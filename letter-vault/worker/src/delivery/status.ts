/** Letter delivery lifecycle states (Phase 5). */

export type LetterStatus =
  | "SEALED"
  | "PROCESSING"
  | "SENT"
  | "DELIVERED"
  | "BOUNCED"
  | "BLOCKED"
  | "FAILED"
  | "RETRY_REQUIRED"
  | "AWAITING_DELIVERY_EMAIL";

export const LETTER_STATUS_RANK: Record<LetterStatus, number> = {
  SEALED: 10,
  AWAITING_DELIVERY_EMAIL: 12,
  RETRY_REQUIRED: 15,
  PROCESSING: 20,
  SENT: 30,
  DELIVERED: 40,
  BOUNCED: 100,
  BLOCKED: 100,
  FAILED: 100,
};

export function shouldAdvanceLetterStatus(
  current: LetterStatus,
  next: LetterStatus,
): boolean {
  const cur = LETTER_STATUS_RANK[current] ?? 0;
  const nxt = LETTER_STATUS_RANK[next] ?? 0;
  return nxt >= cur;
}

/** Default lease duration while PROCESSING (seconds). */
export const PROCESSING_LEASE_SECONDS = 300;

/** Staging: letters due within this window can be claimed. */
export function isLetterDue(deliveryAtIso: string, now = new Date()): boolean {
  return new Date(deliveryAtIso).getTime() <= now.getTime();
}
