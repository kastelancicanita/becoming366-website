import { encryptPayload } from "../crypto/envelope";
import { fetchLatestSchedulerRun, fetchLetterSummary, insertSealedLetter, simulateStaleLease } from "../db/letters";
import { runDeliveryScheduler, processSingleLetter } from "../delivery/scheduler";
import type { Env } from "../env";
import { accessDeniedResponse, jsonResponse } from "../lib/access-response";
import { assertDummyPurchaserEmail } from "../lib/dummy-guard";
import { stagingOnlyResponse } from "../lib/staging-guard";

function requireStagingAdmin(request: Request, env: Env): boolean {
  const token = env.LETTER_VAULT_STAGING_ADMIN_TOKEN;
  if (!token) return false;
  return request.headers.get("X-Letter-Vault-Staging-Admin") === token;
}

function requireMasterKey(env: Env): string | Response {
  const key = env.LETTER_VAULT_MASTER_KEY_V1;
  if (!key) {
    return jsonResponse({ error: "master_key_not_configured" }, 503);
  }
  return key;
}

/** Staging: seal dummy encrypted letter with near-future delivery_at (UTC). */
export async function handleSealScheduledLetter(
  request: Request,
  env: Env,
): Promise<Response> {
  const blocked = stagingOnlyResponse(env);
  if (blocked) return blocked;
  if (!requireStagingAdmin(request, env)) return accessDeniedResponse();

  const masterKey = requireMasterKey(env);
  if (masterKey instanceof Response) return masterKey;

  let body: {
    label?: string;
    purchaser_email?: string;
    recipient_email?: string;
    dummy_text?: string;
    delivery_in_minutes?: number;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const purchaserEmail = body.purchaser_email?.trim().toLowerCase() ?? "";
  const purchaserError = assertDummyPurchaserEmail(purchaserEmail);
  if (purchaserError) {
    return jsonResponse({ error: "validation_failed", message: purchaserError }, 400);
  }

  const deliveryEmail = body.recipient_email?.trim().toLowerCase() ?? null;
  if (deliveryEmail) {
    const deliveryError = assertDummyPurchaserEmail(deliveryEmail);
    if (deliveryError) {
      return jsonResponse({ error: "validation_failed", message: deliveryError }, 400);
    }
  }

  const dummyText = body.dummy_text?.trim() ?? "";
  if (!dummyText.startsWith("DUMMY:")) {
    return jsonResponse(
      { error: "validation_failed", message: "dummy_text must start with DUMMY:" },
      400,
    );
  }

  const minutes = body.delivery_in_minutes ?? 3;
  if (minutes < 0 || minutes > 60) {
    return jsonResponse(
      { error: "validation_failed", message: "delivery_in_minutes must be 0-60" },
      400,
    );
  }

  const deliveryAt = new Date(
    Date.now() + Math.max(minutes, 0) * 60 * 1000,
  ).toISOString();

  try {
    const envelope = await encryptPayload(masterKey, dummyText);
    const letter = await insertSealedLetter(env, {
      label: (body.label ?? "phase5-dummy").slice(0, 64),
      purchaser_email: purchaserEmail,
      recipient_email: deliveryEmail,
      delivery_email_verified: Boolean(deliveryEmail),
      delivery_at: deliveryAt,
      envelope,
    });

    return jsonResponse({
      status: "ok",
      phase: "phase6",
      letter_id: letter.id,
      delivery_at: letter.delivery_at,
      delivery_timezone: "UTC",
      letter_status: letter.status,
      has_delivery_email: Boolean(deliveryEmail),
      plaintext_in_response: false,
      plaintext_in_db: false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "seal_failed";
    if (message.includes("letter_vault_letters")) {
      return jsonResponse(
        { error: "letters_table_missing", message: "Run migration 005_phase5_delivery.sql" },
        503,
      );
    }
    return jsonResponse({ error: "seal_failed", message }, 500);
  }
}

export async function handleSchedulerRun(
  request: Request,
  env: Env,
): Promise<Response> {
  const blocked = stagingOnlyResponse(env);
  if (blocked) return blocked;
  if (!requireStagingAdmin(request, env)) return accessDeniedResponse();

  try {
    const result = await runDeliveryScheduler(env, "manual_staging");
    return jsonResponse({
      status: "ok",
      phase: "phase5",
      scheduler_status: result.status,
      run_id: result.run_id,
      letters_due_count: result.letters_due_count,
      letters_claimed: result.letters_claimed,
      letters_sent: result.letters_sent,
      letters_failed: result.letters_failed,
      stale_recovered: result.stale_recovered,
      plaintext_in_response: false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "scheduler_failed";
    return jsonResponse({ error: "scheduler_failed", message }, 500);
  }
}

export async function handleSchedulerStatus(
  request: Request,
  env: Env,
): Promise<Response> {
  const blocked = stagingOnlyResponse(env);
  if (blocked) return blocked;
  if (!requireStagingAdmin(request, env)) return accessDeniedResponse();

  try {
    const latest = await fetchLatestSchedulerRun(env);
    return jsonResponse({
      status: "ok",
      phase: "phase5",
      latest_run: latest,
      plaintext_in_response: false,
    });
  } catch {
    return jsonResponse({ error: "status_failed" }, 500);
  }
}

export async function handleLetterStatus(
  request: Request,
  env: Env,
  id: string,
): Promise<Response> {
  const blocked = stagingOnlyResponse(env);
  if (blocked) return blocked;
  if (!requireStagingAdmin(request, env)) return accessDeniedResponse();

  try {
    const summary = await fetchLetterSummary(env, id);
    if (!summary) return accessDeniedResponse();

    return jsonResponse({
      status: "ok",
      phase: "phase5",
      letter: summary,
      plaintext_in_response: false,
    });
  } catch {
    return jsonResponse({ error: "status_failed" }, 500);
  }
}

export async function handleSimulateStaleLease(
  request: Request,
  env: Env,
  id: string,
): Promise<Response> {
  const blocked = stagingOnlyResponse(env);
  if (blocked) return blocked;
  if (!requireStagingAdmin(request, env)) return accessDeniedResponse();

  const ok = await simulateStaleLease(env, id);
  return jsonResponse({ status: ok ? "ok" : "failed", phase: "phase5", letter_id: id });
}

/** Force-process one letter (staging tests). */
export async function handleProcessLetter(
  request: Request,
  env: Env,
  id: string,
): Promise<Response> {
  const blocked = stagingOnlyResponse(env);
  if (blocked) return blocked;
  if (!requireStagingAdmin(request, env)) return accessDeniedResponse();

  try {
    const result = await processSingleLetter(env, id);
    return jsonResponse({
      status: "ok",
      phase: "phase5",
      letter_id: id,
      ...result,
      plaintext_in_response: false,
    });
  } catch {
    return jsonResponse({ error: "process_failed" }, 500);
  }
}
