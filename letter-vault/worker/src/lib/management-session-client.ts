/** Client-side management session reuse rules (mirrored in letter-vault/js/manage.js). */

export const MGMT_SESSION_STORE_KEY = "lv_mgmt_session_v1";

export type StoredMgmtSession = {
  session: string | null;
  letterId: string | null;
};

export function canReuseManagementSession(
  stored: StoredMgmtSession,
  requestedLetterId: string,
): boolean {
  if (!stored.session) return false;
  if (!stored.letterId) return true;
  return stored.letterId.toUpperCase() === requestedLetterId.toUpperCase();
}

export function serializeMgmtSession(
  session: string,
  letterId: string | null,
): string {
  return JSON.stringify({ session, letterId });
}

export function parseMgmtSession(raw: string): StoredMgmtSession | null {
  try {
    const data = JSON.parse(raw) as { session?: unknown; letterId?: unknown };
    if (typeof data.session !== "string" || !data.session) return null;
    return {
      session: data.session,
      letterId:
        typeof data.letterId === "string" && data.letterId ? data.letterId : null,
    };
  } catch {
    return null;
  }
}
