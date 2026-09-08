/** Email delivery status ranks — higher = more terminal / advanced. */

export type EmailStatus =
  | "queued"
  | "sending"
  | "sent"
  | "delivered"
  | "bounced"
  | "failed"
  | "complained"
  | "blocked";

export const EMAIL_STATUS_RANK: Record<EmailStatus, number> = {
  queued: 10,
  sending: 20,
  sent: 30,
  delivered: 40,
  bounced: 100,
  failed: 100,
  complained: 100,
  blocked: 100,
};

/** Resend event type → internal status mapping. */
export const RESEND_EVENT_STATUS: Record<string, EmailStatus> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.delivery_delayed": "sending",
  "email.failed": "failed",
};

export function mapResendEventType(eventType: string): EmailStatus | null {
  return RESEND_EVENT_STATUS[eventType] ?? null;
}

/**
 * Prevent out-of-order webhook regression (e.g. delivered → sent).
 * Terminal failure states (rank 100) may advance from sent but not from delivered.
 */
export function shouldAdvanceEmailStatus(
  currentStatus: EmailStatus,
  nextStatus: EmailStatus,
): boolean {
  const currentRank = EMAIL_STATUS_RANK[currentStatus] ?? 0;
  const nextRank = EMAIL_STATUS_RANK[nextStatus] ?? 0;

  if (nextRank > currentRank) return true;
  if (nextRank === currentRank) return true;

  return false;
}

export function rankForStatus(status: EmailStatus): number {
  return EMAIL_STATUS_RANK[status];
}
