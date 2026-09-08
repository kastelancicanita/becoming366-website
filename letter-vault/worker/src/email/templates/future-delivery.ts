/**
 * Future delivery email — the ONLY place letter body may appear (in outbound payload).
 * Never persist plaintext from this template.
 */

export interface FutureDeliveryTemplateInput {
  letterBodyPlaintext: string;
  deliveryDateFormatted: string;
}

export function buildFutureDeliverySubject(): string {
  return "You asked us to send you this today";
}

export function buildFutureDeliveryHtml(
  input: FutureDeliveryTemplateInput,
): string {
  const escaped = input.letterBodyPlaintext
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>You asked us to send you this today</title></head>
<body style="font-family: Georgia, 'Times New Roman', serif; color: #1a1a1a; line-height: 1.6; max-width: 560px; margin: 0 auto; padding: 24px;">
  <p style="font-size: 18px;">You asked us to send you this today.</p>
  <p>Years ago, you wrote a letter. You asked us to keep it safe until today. We did.</p>
  <p style="font-size: 14px; color: #666;">Scheduled for: ${input.deliveryDateFormatted}</p>
  <hr style="border: none; border-top: 1px solid #ddd; margin: 24px 0;">
  <div style="font-size: 16px; white-space: pre-wrap;">${escaped}</div>
  <hr style="border: none; border-top: 1px solid #ddd; margin: 24px 0;">
  <p style="font-size: 12px; color: #888;">The Letter Vault · Becoming366</p>
</body>
</html>`;
}

export function buildFutureDeliveryText(
  input: FutureDeliveryTemplateInput,
): string {
  return [
    "You asked us to send you this today.",
    "",
    "Years ago, you wrote a letter. You asked us to keep it safe until today. We did.",
    "",
    `Scheduled for: ${input.deliveryDateFormatted}`,
    "",
    "---",
    "",
    input.letterBodyPlaintext,
    "",
    "---",
    "",
    "The Letter Vault · Becoming366",
  ].join("\n");
}
