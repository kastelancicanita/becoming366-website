/** Canonical declaration version — bump when customer-facing copy changes. */
export const SURPRISE_DECLARATION_VERSION = "2026-09-v1" as const;

/**
 * Purchaser declaration semantic lock (S3).
 * Personal one-to-one message — not marketing, bulk, or commercial outreach.
 * Must NOT imply recipient permission, opt-in, or prior consent.
 */
export const SURPRISE_PERSONAL_DECLARATION_TEXT =
  "I am sending this private letter to one person I personally know. This is a personal message, not marketing, advertising, bulk email, or unsolicited commercial outreach." as const;

export function isSurprisePersonalDeclarationAccepted(
  accepted: boolean | undefined,
): boolean {
  return accepted === true;
}
