import { encryptPayload } from "../crypto/envelope";
import { findLetterByPublicIdAndPurchaser } from "../db/management";
import { fetchLatestSchedulerRun, fetchLetterSummary, insertSealedLetter, simulateStaleLease } from "../db/letters";
import { runDeliveryScheduler, processSingleLetter } from "../delivery/scheduler";
import type { Env } from "../env";
import { accessDeniedResponse, jsonResponse } from "../lib/access-response";
import { assertDummyPurchaserEmail } from "../lib/dummy-guard";
import {
  checkSurpriseDeliverySchema,
  forceSurpriseDeliveryForLetter,
} from "../lib/surprise-schema";
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

/** Staging admin: set Surprise delivery email after migrations 009+010 (S6 QA). */
export async function handleStagingForceSurpriseDelivery(
  request: Request,
  env: Env,
): Promise<Response> {
  const blocked = stagingOnlyResponse(env);
  if (blocked) return blocked;
  if (!requireStagingAdmin(request, env)) return accessDeniedResponse();

  let body: {
    public_letter_id?: string;
    purchaser_email?: string;
    delivery_email?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const publicLetterId = body.public_letter_id?.trim() ?? "";
  const purchaserEmail = body.purchaser_email?.trim().toLowerCase() ?? "";
  const deliveryEmail = body.delivery_email?.trim().toLowerCase() ?? "";

  if (!publicLetterId || !purchaserEmail || !deliveryEmail) {
    return jsonResponse({ error: "validation_failed" }, 400);
  }

  const purchaserError = assertDummyPurchaserEmail(purchaserEmail);
  if (purchaserError) {
    return jsonResponse({ error: "validation_failed", message: purchaserError }, 400);
  }

  try {
    const schema = await checkSurpriseDeliverySchema(env);
    if (!schema.ready) {
      return jsonResponse(
        {
          status: "error",
          error: "surprise_schema_not_ready",
          surprise_delivery_schema: schema,
        },
        503,
      );
    }

    const letter = await findLetterByPublicIdAndPurchaser(
      env,
      publicLetterId,
      purchaserEmail,
    );
    if (!letter || letter.status !== "SEALED") {
      return jsonResponse({ error: "letter_not_found" }, 404);
    }

    await forceSurpriseDeliveryForLetter(env, letter.id, deliveryEmail);

    return jsonResponse({
      status: "ok",
      phase: "s6",
      public_letter_id: publicLetterId.toUpperCase(),
      letter_id: letter.id,
      delivery_email_masked: deliveryEmail.replace(/(.{2}).*(@.*)/, "$1***$2"),
      delivery_email_mode: "surprise",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "force_surprise_failed";
    return jsonResponse({ error: "force_surprise_failed", message }, 500);
  }
}

/** Staging admin: move letter delivery_at to the past (scheduler / MailerSend S6). */
export async function handleStagingBackdateDelivery(
  request: Request,
  env: Env,
): Promise<Response> {
  const blocked = stagingOnlyResponse(env);
  if (blocked) return blocked;
  if (!requireStagingAdmin(request, env)) return accessDeniedResponse();

  let body: {
    public_letter_id?: string;
    purchaser_email?: string;
    minutes_ago?: number;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const publicLetterId = body.public_letter_id?.trim() ?? "";
  const purchaserEmail = body.purchaser_email?.trim().toLowerCase() ?? "";
  const minutesAgo = body.minutes_ago ?? 5;

  if (!publicLetterId || !purchaserEmail) {
    return jsonResponse({ error: "validation_failed" }, 400);
  }
  if (minutesAgo < 1 || minutesAgo > 60 * 24 * 365) {
    return jsonResponse({ error: "validation_failed", message: "minutes_ago out of range" }, 400);
  }

  try {
    const letter = await findLetterByPublicIdAndPurchaser(
      env,
      publicLetterId,
      purchaserEmail,
    );
    if (!letter) {
      return jsonResponse({ error: "letter_not_found" }, 404);
    }

    const deliveryAt = new Date(Date.now() - minutesAgo * 60 * 1000).toISOString();
    const { createServiceSupabaseClient } = await import("../db/service-client");
    const sb = createServiceSupabaseClient(env);
    const { error } = await sb
      .from("letter_vault_letters")
      .update({ delivery_at: deliveryAt, updated_at: new Date().toISOString() })
      .eq("id", letter.id);

    if (error) throw new Error(error.message);

    if (letter.slot_id) {
      await sb
        .from("letter_vault_slots")
        .update({ delivery_at: deliveryAt })
        .eq("id", letter.slot_id);
    }

    return jsonResponse({
      status: "ok",
      phase: "s6",
      letter_id: letter.id,
      public_letter_id: publicLetterId.toUpperCase(),
      delivery_at: deliveryAt,
      recipient_email_masked: letter.recipient_email
        ? letter.recipient_email.replace(/(.{2}).*(@.*)/, "$1***$2")
        : null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "backdate_failed";
    return jsonResponse({ error: "backdate_failed", message }, 500);
  }
}

/** Staging admin: letter summary by public ID (S6 verification). */
export async function handleStagingLetterByPublicId(
  request: Request,
  env: Env,
): Promise<Response> {
  const blocked = stagingOnlyResponse(env);
  if (blocked) return blocked;
  if (!requireStagingAdmin(request, env)) return accessDeniedResponse();

  const url = new URL(request.url);
  const publicLetterId = url.searchParams.get("public_letter_id")?.trim() ?? "";
  const purchaserEmail = url.searchParams.get("purchaser_email")?.trim().toLowerCase() ?? "";

  if (!publicLetterId || !purchaserEmail) {
    return jsonResponse({ error: "validation_failed" }, 400);
  }

  try {
    const letter = await findLetterByPublicIdAndPurchaser(
      env,
      publicLetterId,
      purchaserEmail,
    );
    if (!letter) {
      return jsonResponse({ error: "letter_not_found" }, 404);
    }

    const summary = await fetchLetterSummary(env, letter.id);
    const { createServiceSupabaseClient } = await import("../db/service-client");
    const sb = createServiceSupabaseClient(env);
    const { data: attempts } = await sb
      .from("letter_vault_delivery_attempts")
      .select("id, attempt_number, provider_message_id, result_status, started_at, finished_at")
      .eq("letter_id", letter.id)
      .order("started_at", { ascending: false })
      .limit(3);

    const { data: outbound } = await sb
      .from("letter_vault_email_outbound")
      .select("id, email_type, provider, provider_message_id, status, recipient_email, created_at, updated_at")
      .eq("letter_ref", letter.id)
      .order("created_at", { ascending: false })
      .limit(5);

    return jsonResponse({
      status: "ok",
      phase: "s6",
      letter: summary,
      delivery_attempts: attempts ?? [],
      outbound_emails: outbound ?? [],
      plaintext_in_response: false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "lookup_failed";
    return jsonResponse({ error: "lookup_failed", message }, 500);
  }
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
