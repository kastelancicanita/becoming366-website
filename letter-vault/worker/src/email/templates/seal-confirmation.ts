/**
 * Seal confirmation email — operational content only.
 * NEVER include letter body, preview, excerpt, subject, or private content.
 */

export interface SealConfirmationTemplateInput {
  deliveryDateIso: string;
}

export function formatDeliveryDate(isoDate: string): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function buildSealConfirmationSubject(): string {
  return "Your letter is sealed";
}

export function buildSealConfirmationHtml(
  input: SealConfirmationTemplateInput,
): string {
  const deliveryFormatted = formatDeliveryDate(input.deliveryDateIso);

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Your letter is sealed</title></head>
<body style="font-family: Georgia, 'Times New Roman', serif; color: #1a1a1a; line-height: 1.6; max-width: 560px; margin: 0 auto; padding: 24px;">
  <p style="font-size: 18px;">Your letter is sealed.</p>
  <p>Then forget about it. We'll remember.</p>
  <p><strong>Scheduled delivery:</strong> ${deliveryFormatted}</p>
  <hr style="border: none; border-top: 1px solid #ddd; margin: 24px 0;">
  <p style="font-size: 14px; color: #444;">
    <strong>Please add</strong> <a href="mailto:letters@vault.becoming366.com">letters@vault.becoming366.com</a>
    to your contacts so future Vault messages reach your inbox.
  </p>
  <p style="font-size: 14px; color: #444;">
    If this message landed in Spam or Junk, mark it as <strong>Not Spam</strong>.
  </p>
  <p style="font-size: 14px; color: #444;">
    Keep your Vault access information safe. You can update your delivery email later.
  </p>
  <p style="font-size: 12px; color: #888; margin-top: 32px;">
    The Letter Vault · Becoming366
  </p>
</body>
</html>`;
}

export function buildSealConfirmationText(
  input: SealConfirmationTemplateInput,
): string {
  const deliveryFormatted = formatDeliveryDate(input.deliveryDateIso);

  return [
    "Your letter is sealed.",
    "",
    "Then forget about it. We'll remember.",
    "",
    `Scheduled delivery: ${deliveryFormatted}`,
    "",
    "Please add letters@vault.becoming366.com to your contacts.",
    "If this message is in Spam/Junk, mark it as Not Spam.",
    "Keep your Vault access information safe. You can update your delivery email later.",
    "",
    "The Letter Vault · Becoming366",
  ].join("\n");
}

/** Guard: template must never contain letter-content placeholders. */
export function templateContainsPrivateLetterContent(html: string): boolean {
  const forbidden = [
    "{{letter_body",
    "{{letter_subject",
    "{{letter_preview",
    "{{excerpt",
    "PRIVATE LETTER",
  ];
  const lower = html.toLowerCase();
  return forbidden.some((f) => lower.includes(f.toLowerCase()));
}
