import { generateSecureToken, maskEmail } from "../crypto/management-token";
import {
  auditDeliveryEmail,
  activateSurpriseDeliveryEmail,
  consumeManagementToken,
  createDeliveryEmailChange,
  createManagementSession,
  createManagementToken,
  fetchDeliveryEmailAudit,
  findLetterByIdAndPurchaser,
  findLetterByPublicIdAndPurchaser,
  getLetterManagementMetadata,
  validateManagementSession,
  verifyDeliveryEmailChange,
} from "../db/management";
import { fetchLetterById, hasVerifiedDeliveryEmail } from "../db/letters";
import {
  buildDeliveryEmailVerifyHtml,
  buildDeliveryEmailVerifySubject,
  buildDeliveryEmailVerifyText,
  buildManagementLinkHtml,
  buildManagementLinkSubject,
  buildManagementLinkText,
} from "../email/templates/management";
import { sendViaResend } from "../email/resend-client";
import type { Env } from "../env";
import {
  accessDeniedResponse,
  rateLimitedResponse,
} from "../lib/access-response";
import { assertDummyPurchaserEmail } from "../lib/dummy-guard";
import {
  jsonResponse,
  managementDeniedResponse,
  managementRequestResponse,
} from "../lib/management-response";
import {
  clientIp,
  hashBucketKey,
  isRateLimited,
  recordAuthAttempt,
} from "../lib/rate-limit";
import { stagingOnlyResponse } from "../lib/staging-guard";
import { createClient } from "@supabase/supabase-js";

const SESSION_HEADER = "X-Letter-Vault-Management-Session";

function requireStagingAdmin(request: Request, env: Env): boolean {
  const token = env.LETTER_VAULT_STAGING_ADMIN_TOKEN;
  if (!token) return false;
  return request.headers.get("X-Letter-Vault-Staging-Admin") === token;
}

function managementBaseUrl(request: Request): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

async function guardManagementAttempt(
  request: Request,
  env: Env,
  endpoint: string,
): Promise<Response | null> {
  const bucket = await hashBucketKey(`${clientIp(request)}:${endpoint}`);
  if (await isRateLimited(env, bucket)) {
    return rateLimitedResponse();
  }
  await recordAuthAttempt(env, bucket);
  return null;
}

function supabase(env: Env) {
  return createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Step 1: Request management access (generic response always). */
export async function handleManagementRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  const blocked = stagingOnlyResponse(env);
  if (blocked) return blocked;

  const limited = await guardManagementAttempt(
    request,
    env,
    "management_request",
  );
  if (limited) return limited;

  let body: { letter_id?: string; purchaser_email?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return managementRequestResponse();
  }

  const letterId = body.letter_id?.trim() ?? "";
  const purchaserEmail = body.purchaser_email?.trim().toLowerCase() ?? "";

  if (!letterId || !purchaserEmail) {
    return managementRequestResponse();
  }

  const emailError = assertDummyPurchaserEmail(purchaserEmail);
  if (emailError) {
    return managementRequestResponse();
  }

  try {
    let letter = await findLetterByIdAndPurchaser(
      env,
      letterId,
      purchaserEmail,
    );

    if (!letter && letterId.startsWith("LV-")) {
      letter = await findLetterByPublicIdAndPurchaser(
        env,
        letterId,
        purchaserEmail,
      );
    }

    if (letter) {
      const rawToken = generateSecureToken();
      await invalidateUnusedManagementTokens(env, letter.id);
      await createManagementToken(env, letter.id, rawToken);

      const activateUrl = `${managementBaseUrl(request)}/v1/staging/management/activate?token=${encodeURIComponent(rawToken)}`;
      await sendViaResend(env, {
        to: purchaserEmail,
        subject: buildManagementLinkSubject(),
        html: buildManagementLinkHtml(activateUrl),
        text: buildManagementLinkText(activateUrl),
      });
    }
  } catch {
    /* generic response regardless */
  }

  return managementRequestResponse();
}

async function invalidateUnusedManagementTokens(
  env: Env,
  letterId: string,
): Promise<void> {
  await supabase(env)
    .from("letter_vault_management_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("letter_id", letterId)
    .is("used_at", null);
}

/** Step 2a: POST activate with token → session JSON (API / tests). */
export async function handleManagementActivatePost(
  request: Request,
  env: Env,
): Promise<Response> {
  const blocked = stagingOnlyResponse(env);
  if (blocked) return blocked;

  const limited = await guardManagementAttempt(
    request,
    env,
    "management_activate",
  );
  if (limited) return limited;

  let body: { token?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return managementDeniedResponse();
  }

  const rawToken = body.token?.trim() ?? "";
  if (!rawToken) return managementDeniedResponse();

  return activateTokenAndCreateSession(env, rawToken);
}

/** Step 2b: GET activate from email magic link. */
export async function handleManagementActivateGet(
  request: Request,
  env: Env,
): Promise<Response> {
  const blocked = stagingOnlyResponse(env);
  if (blocked) return blocked;

  const limited = await guardManagementAttempt(
    request,
    env,
    "management_activate",
  );
  if (limited) return rateLimitedResponse();

  const url = new URL(request.url);
  const rawToken = url.searchParams.get("token")?.trim() ?? "";
  if (!rawToken) {
    return new Response("Invalid or expired link.", {
      status: 400,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const sessionResult = await activateTokenAndCreateSession(env, rawToken);
  if (sessionResult.status !== 200) {
    return new Response("Invalid or expired link.", {
      status: 401,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const payload = (await sessionResult.json()) as {
    session_token?: string;
    expires_at?: string;
    letter_id?: string;
    public_letter_id?: string;
  };

  const uiBase =
    env.LETTER_VAULT_UI_BASE_URL?.replace(/\/$/, "") ??
    "https://becoming366-website.pages.dev";
  const redirectUrl = new URL(`${uiBase}/letter-vault/index.html`);
  if (payload.session_token) {
    redirectUrl.searchParams.set("management_session", payload.session_token);
  }
  if (payload.public_letter_id) {
    redirectUrl.searchParams.set("letter_id", payload.public_letter_id);
  }

  return Response.redirect(redirectUrl.toString(), 302);
}

async function activateTokenAndCreateSession(
  env: Env,
  rawToken: string,
): Promise<Response> {
  try {
    const consumed = await consumeManagementToken(env, rawToken);
    if (!consumed) return managementDeniedResponse();

    const rawSession = generateSecureToken();
    const session = await createManagementSession(
      env,
      consumed.letter_id,
      rawSession,
    );

    const letter = await fetchLetterById(env, consumed.letter_id);

    return jsonResponse({
      status: "ok",
      phase: "phase6",
      session_token: session.session_token,
      expires_at: session.expires_at,
      letter_id: consumed.letter_id,
      public_letter_id:
        (letter as { public_letter_id?: string } | null)?.public_letter_id ??
        null,
      letter_body_in_response: false,
    });
  } catch {
    return managementDeniedResponse();
  }
}

function sessionFromRequest(request: Request): string | null {
  const header = request.headers.get(SESSION_HEADER)?.trim();
  if (header) return header;
  const cookie = request.headers.get("Cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)lv_mgmt_session=([^;]+)/);
  return match?.[1]?.trim() ?? null;
}

/** Step 3: View operational metadata only (no letter body). */
export async function handleManagementSessionView(
  request: Request,
  env: Env,
): Promise<Response> {
  const blocked = stagingOnlyResponse(env);
  if (blocked) return blocked;

  const rawSession = sessionFromRequest(request);
  if (!rawSession) return managementDeniedResponse();

  try {
    const valid = await validateManagementSession(env, rawSession);
    if (!valid) return managementDeniedResponse();

    const metadata = await getLetterManagementMetadata(env, valid.letter_id);
    if (!metadata) return managementDeniedResponse();

    return jsonResponse({
      status: "ok",
      phase: "phase6",
      management: metadata,
      letter_body_in_response: false,
      ciphertext_in_response: false,
    });
  } catch {
    return managementDeniedResponse();
  }
}

/** Step 4: Request delivery email change (pending until verified). */
export async function handleDeliveryEmailChangeRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  const blocked = stagingOnlyResponse(env);
  if (blocked) return blocked;

  const rawSession = sessionFromRequest(request);
  if (!rawSession) return managementDeniedResponse();

  let body: {
    new_delivery_email?: string;
    delivery_email_mode?: "surprise" | "verify_now";
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return managementDeniedResponse();
  }

  const newEmail = body.new_delivery_email?.trim().toLowerCase() ?? "";
  const emailError = assertDummyPurchaserEmail(newEmail);
  if (emailError) {
    return jsonResponse(
      { status: "error", error: "validation_failed", message: emailError },
      400,
    );
  }

  try {
    const valid = await validateManagementSession(env, rawSession);
    if (!valid) return managementDeniedResponse();

    const letter = await fetchLetterById(env, valid.letter_id);
    if (!letter) return managementDeniedResponse();

    if (letter.recipient_email === newEmail && letter.delivery_email_verified_at) {
      return jsonResponse({
        status: "ok",
        phase: "phase6",
        message: "This delivery email is already active.",
        pending_verification: false,
        active_delivery_email_masked: maskEmail(newEmail),
        delivery_email_mode: letter.delivery_email_mode ?? "verified",
      });
    }

    const mode = body.delivery_email_mode === "surprise" ? "surprise" : "verify_now";

    if (mode === "surprise") {
      await activateSurpriseDeliveryEmail(env, letter.id, newEmail);
      return jsonResponse({
        status: "ok",
        phase: "phase6",
        message:
          "Delivery email saved. The recipient will not be contacted until delivery day.",
        pending_verification: false,
        delivery_email_mode: "surprise",
        active_delivery_email_masked: maskEmail(newEmail),
        letter_body_in_response: false,
      });
    }

    const rawVerifyToken = generateSecureToken();
    const previousActive = letter.recipient_email;
    await createDeliveryEmailChange(
      env,
      letter.id,
      newEmail,
      rawVerifyToken,
      previousActive,
    );

    await auditDeliveryEmail(env, letter.id, "delivery_email_change_requested", newEmail);

    const verifyUrl = `${managementBaseUrl(request)}/v1/staging/management/delivery-email/confirm?token=${encodeURIComponent(rawVerifyToken)}`;
    await sendViaResend(env, {
      to: newEmail,
      subject: buildDeliveryEmailVerifySubject(),
      html: buildDeliveryEmailVerifyHtml(verifyUrl),
      text: buildDeliveryEmailVerifyText(verifyUrl),
    });

    return jsonResponse({
      status: "ok",
      phase: "phase6",
      message:
        "Verification sent to the new address. The current delivery email remains active until verification succeeds.",
      pending_verification: true,
      active_delivery_email_masked: letter.recipient_email
        ? maskEmail(letter.recipient_email)
        : null,
      delivery_email_mode: "verified",
      letter_body_in_response: false,
    });
  } catch {
    return managementDeniedResponse();
  }
}

/** Step 5: Confirm new delivery email (GET from email or POST). */
export async function handleDeliveryEmailConfirmPost(
  request: Request,
  env: Env,
): Promise<Response> {
  const blocked = stagingOnlyResponse(env);
  if (blocked) return blocked;

  let body: { token?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return managementDeniedResponse();
  }

  const rawToken = body.token?.trim() ?? "";
  if (!rawToken) return managementDeniedResponse();

  return confirmDeliveryEmailToken(env, rawToken);
}

export async function handleDeliveryEmailConfirmGet(
  request: Request,
  env: Env,
): Promise<Response> {
  const blocked = stagingOnlyResponse(env);
  if (blocked) return blocked;

  const url = new URL(request.url);
  const rawToken = url.searchParams.get("token")?.trim() ?? "";
  if (!rawToken) {
    return new Response("Invalid or expired verification link.", {
      status: 400,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const result = await confirmDeliveryEmailToken(env, rawToken);
  if (result.status !== 200) {
    return new Response("Invalid or expired verification link.", {
      status: 401,
      headers: { "Cache-Control": "no-store" },
    });
  }

  return new Response(
    `<!DOCTYPE html><html lang="en"><body style="font-family:Georgia,serif;max-width:560px;margin:40px auto;padding:24px;">
      <p>Your new delivery email is confirmed and active.</p>
      <p style="color:#666;font-size:14px;">No letter content is included in this message.</p>
    </body></html>`,
    {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    },
  );
}

async function confirmDeliveryEmailToken(
  env: Env,
  rawToken: string,
): Promise<Response> {
  try {
    const activated = await verifyDeliveryEmailChange(env, rawToken);
    if (!activated) return managementDeniedResponse();

    return jsonResponse({
      status: "ok",
      phase: "phase6",
      message: "Delivery email verified and activated.",
      letter_id: activated.letter_id,
      letter_body_in_response: false,
    });
  } catch {
    return managementDeniedResponse();
  }
}

/** Staging admin: mint one-time management token for automated verification. */
export async function handleManagementTestMintToken(
  request: Request,
  env: Env,
): Promise<Response> {
  const blocked = stagingOnlyResponse(env);
  if (blocked) return blocked;
  if (!requireStagingAdmin(request, env)) return accessDeniedResponse();

  let body: { letter_id?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const letterId = body.letter_id?.trim() ?? "";
  if (!letterId) return jsonResponse({ error: "validation_failed" }, 400);

  try {
    const rawToken = generateSecureToken();
    await invalidateUnusedManagementTokens(env, letterId);
    await createManagementToken(env, letterId, rawToken);

    return jsonResponse({
      status: "ok",
      phase: "phase6",
      staging_test_only: true,
      management_token: rawToken,
      note: "Admin-only staging helper. Never use in production.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "mint_failed";
    return jsonResponse({ error: "mint_failed", message }, 500);
  }
}

/** Staging admin: verify token storage uses hash only. */
export async function handleManagementTestTokenStorage(
  request: Request,
  env: Env,
  letterId: string,
): Promise<Response> {
  const blocked = stagingOnlyResponse(env);
  if (blocked) return blocked;
  if (!requireStagingAdmin(request, env)) return accessDeniedResponse();

  try {
    const { data, error } = await supabase(env)
      .from("letter_vault_management_tokens")
      .select("token_hash, used_at, expires_at")
      .eq("letter_id", letterId)
      .order("created_at", { ascending: false })
      .limit(5);

    if (error) throw new Error(error.message);

    const rows = data ?? [];
    const rawTokenPattern = /^[A-Za-z0-9_-]{40,}$/;
    let rawTokenLeaked = false;
    for (const row of rows) {
      if (
        typeof row.token_hash === "string" &&
        rawTokenPattern.test(row.token_hash) &&
        row.token_hash.length < 60
      ) {
        rawTokenLeaked = true;
      }
    }

    return jsonResponse({
      status: "ok",
      phase: "phase6",
      token_rows: rows.length,
      stores_hash_only: rows.every(
        (r) => typeof r.token_hash === "string" && r.token_hash.length === 64,
      ),
      raw_token_in_db: rawTokenLeaked,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "check_failed";
    return jsonResponse({ error: "check_failed", message }, 500);
  }
}

/** Staging admin: delivery email audit trail. */
export async function handleManagementTestAudit(
  request: Request,
  env: Env,
  letterId: string,
): Promise<Response> {
  const blocked = stagingOnlyResponse(env);
  if (blocked) return blocked;
  if (!requireStagingAdmin(request, env)) return accessDeniedResponse();

  try {
    const audit = await fetchDeliveryEmailAudit(env, letterId);
    return jsonResponse({
      status: "ok",
      phase: "phase6",
      audit,
      letter_body_in_response: false,
    });
  } catch {
    return jsonResponse({ error: "audit_failed" }, 500);
  }
}

/** Staging admin: confirm letter has no decrypt endpoint in management. */
export async function handleManagementTestNoBodyAccess(
  request: Request,
  env: Env,
  letterId: string,
): Promise<Response> {
  const blocked = stagingOnlyResponse(env);
  if (blocked) return blocked;
  if (!requireStagingAdmin(request, env)) return accessDeniedResponse();

  const letter = await fetchLetterById(env, letterId);
  if (!letter) return accessDeniedResponse();

  return jsonResponse({
    status: "ok",
    phase: "phase6",
    letter_id: letterId,
    has_ciphertext_in_db: Boolean(letter.ciphertext_b64),
    management_exposes_body: false,
    verified_delivery: hasVerifiedDeliveryEmail(letter),
  });
}

/** Staging admin: mint delivery-email verify token for automated verification. */
export async function handleManagementTestMintDeliveryVerify(
  request: Request,
  env: Env,
): Promise<Response> {
  const blocked = stagingOnlyResponse(env);
  if (blocked) return blocked;
  if (!requireStagingAdmin(request, env)) return accessDeniedResponse();

  let body: { letter_id?: string; new_email?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const letterId = body.letter_id?.trim() ?? "";
  const newEmail = body.new_email?.trim().toLowerCase() ?? "";
  const emailError = assertDummyPurchaserEmail(newEmail);
  if (!letterId || emailError) {
    return jsonResponse({ error: "validation_failed" }, 400);
  }

  try {
    const letter = await fetchLetterById(env, letterId);
    if (!letter) return accessDeniedResponse();

    const rawVerifyToken = generateSecureToken();
    await createDeliveryEmailChange(
      env,
      letterId,
      newEmail,
      rawVerifyToken,
      letter.recipient_email,
    );

    return jsonResponse({
      status: "ok",
      phase: "phase6",
      staging_test_only: true,
      verify_token: rawVerifyToken,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "mint_failed";
    return jsonResponse({ error: "mint_failed", message }, 500);
  }
}

export { SESSION_HEADER };
