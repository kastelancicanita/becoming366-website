export function buildManagementLinkSubject(): string {
  return "Manage your Letter Vault letter";
}

export function buildManagementLinkHtml(magicLinkUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en"><body style="font-family: Georgia, serif; max-width: 560px; margin: 0 auto; padding: 24px;">
  <p>You requested access to manage your Letter Vault letter.</p>
  <p>This link expires in 20 minutes and works once.</p>
  <p><a href="${magicLinkUrl}">Open letter management</a></p>
  <p style="font-size: 14px; color: #666;">If you did not request this, ignore this email.</p>
  <p style="font-size: 12px; color: #888;">The Letter Vault · Becoming366</p>
</body></html>`;
}

export function buildManagementLinkText(magicLinkUrl: string): string {
  return [
    "You requested access to manage your Letter Vault letter.",
    "",
    "This link expires in 20 minutes and works once.",
    "",
    magicLinkUrl,
    "",
    "If you did not request this, ignore this email.",
    "",
    "The Letter Vault · Becoming366",
  ].join("\n");
}

export function buildDeliveryEmailVerifySubject(): string {
  return "Confirm your new Letter Vault delivery email";
}

export function buildDeliveryEmailVerifyHtml(verifyUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en"><body style="font-family: Georgia, serif; max-width: 560px; margin: 0 auto; padding: 24px;">
  <p>Confirm this email address for future letter delivery.</p>
  <p>This verification link expires in 30 minutes.</p>
  <p><a href="${verifyUrl}">Confirm delivery email</a></p>
  <p style="font-size: 14px; color: #666;">No letter content is included in this message.</p>
  <p style="font-size: 12px; color: #888;">The Letter Vault · Becoming366</p>
</body></html>`;
}

export function buildDeliveryEmailVerifyText(verifyUrl: string): string {
  return [
    "Confirm this email address for future letter delivery.",
    "",
    "This verification link expires in 30 minutes.",
    "",
    verifyUrl,
    "",
    "No letter content is included in this message.",
    "",
    "The Letter Vault · Becoming366",
  ].join("\n");
}
