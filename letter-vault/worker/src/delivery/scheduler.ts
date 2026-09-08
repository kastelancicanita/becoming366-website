import { decryptPayload, verifyEnvelope } from "../crypto/envelope";
import {
  atomicClaimLetter,
  countDueLetters,
  fetchDueLetterCandidates,
  finishDeliveryAttempt,
  finishSchedulerRun,
  hasVerifiedDeliveryEmail,
  letterToEnvelope,
  recoverStaleProcessingLetters,
  startDeliveryAttempt,
  startSchedulerRun,
  updateLetterAfterDelivery,
  type LetterRow,
} from "../db/letters";
import { markAwaitingDeliveryEmail } from "../db/management";
import { insertOutboundQueued, markOutboundSendResult, markOutboundSending } from "../db/email-store";
import { formatDeliveryDate } from "../email/templates/seal-confirmation";
import {
  buildFutureDeliveryHtml,
  buildFutureDeliverySubject,
  buildFutureDeliveryText,
} from "../email/templates/future-delivery";
import { sendViaResend } from "../email/resend-client";
import type { Env } from "../env";

export interface SchedulerResult {
  run_id: string;
  letters_due_count: number;
  letters_claimed: number;
  letters_sent: number;
  letters_failed: number;
  stale_recovered: number;
  status: "completed" | "failed";
}

function workerInstanceId(): string {
  return `worker-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function processClaimedLetter(
  env: Env,
  letter: LetterRow,
  masterKey: string,
): Promise<"sent" | "failed"> {
  const attemptNumber = letter.attempt_count + 1;
  const attempt = await startDeliveryAttempt(env, letter.id, attemptNumber);

  try {
    const envelope = letterToEnvelope(letter);
    const valid = await verifyEnvelope(masterKey, envelope);
    if (!valid) {
      await finishDeliveryAttempt(env, attempt.id, {
        result_status: "failed",
        error_category: "decrypt_verify",
        error_code: "content_hash_mismatch",
      });
      await updateLetterAfterDelivery(env, letter.id, {
        status: letter.attempt_count + 1 >= letter.max_attempts ? "FAILED" : "RETRY_REQUIRED",
        attempt_count: attemptNumber,
        last_error_category: "decrypt_verify",
        clear_lease: true,
      });
      return "failed";
    }

    let plaintextBytes: Uint8Array;
    try {
      plaintextBytes = await decryptPayload(masterKey, envelope);
    } catch {
      await finishDeliveryAttempt(env, attempt.id, {
        result_status: "failed",
        error_category: "decrypt",
        error_code: "decrypt_failed",
      });
      await updateLetterAfterDelivery(env, letter.id, {
        status: letter.attempt_count + 1 >= letter.max_attempts ? "FAILED" : "RETRY_REQUIRED",
        attempt_count: attemptNumber,
        last_error_category: "decrypt",
        clear_lease: true,
      });
      return "failed";
    }

    const letterBody = new TextDecoder().decode(plaintextBytes);
    plaintextBytes.fill(0);

    const deliveryFormatted = formatDeliveryDate(
      letter.delivery_at.slice(0, 10),
    );
    const html = buildFutureDeliveryHtml({
      letterBodyPlaintext: letterBody,
      deliveryDateFormatted: deliveryFormatted,
    });
    const text = buildFutureDeliveryText({
      letterBodyPlaintext: letterBody,
      deliveryDateFormatted: deliveryFormatted,
    });

    const idempotencyKey = `DUMMY-DELIVERY-${letter.id}`;
    const { row: outbound, duplicate } = await insertOutboundQueued(env, {
      idempotency_key: idempotencyKey,
      recipient_email: letter.recipient_email!,
      delivery_date: letter.delivery_at.slice(0, 10),
      letter_ref: letter.id,
      email_type: "future_delivery",
    });

    if (duplicate && outbound?.provider_message_id) {
      await finishDeliveryAttempt(env, attempt.id, {
        result_status: "sent",
        provider_message_id: outbound.provider_message_id,
      });
      await updateLetterAfterDelivery(env, letter.id, {
        status: "SENT",
        attempt_count: attemptNumber,
        provider_message_id: outbound.provider_message_id,
        sent_at: new Date().toISOString(),
        clear_lease: true,
      });
      return "sent";
    }

    if (outbound) await markOutboundSending(env, outbound.id);

    const sendResult = await sendViaResend(env, {
      to: letter.recipient_email!,
      subject: buildFutureDeliverySubject(),
      html,
      text,
    });

    if (outbound) {
      await markOutboundSendResult(env, outbound.id, {
        ok: sendResult.ok,
        providerMessageId: sendResult.providerMessageId,
        errorSummary: sendResult.errorSummary,
      });
    }

    if (!sendResult.ok) {
      await finishDeliveryAttempt(env, attempt.id, {
        result_status: "failed",
        error_category: "resend",
        error_code: sendResult.errorSummary ?? "send_failed",
      });
      await updateLetterAfterDelivery(env, letter.id, {
        status: attemptNumber >= letter.max_attempts ? "FAILED" : "RETRY_REQUIRED",
        attempt_count: attemptNumber,
        last_error_category: "resend",
        clear_lease: true,
      });
      return "failed";
    }

    await finishDeliveryAttempt(env, attempt.id, {
      result_status: "sent",
      provider_message_id: sendResult.providerMessageId,
    });
    await updateLetterAfterDelivery(env, letter.id, {
      status: "SENT",
      attempt_count: attemptNumber,
      provider_message_id: sendResult.providerMessageId,
      sent_at: new Date().toISOString(),
      clear_lease: true,
    });
    return "sent";
  } catch {
    await finishDeliveryAttempt(env, attempt.id, {
      result_status: "failed",
      error_category: "internal",
      error_code: "unexpected",
    });
    await updateLetterAfterDelivery(env, letter.id, {
      status: attemptNumber >= letter.max_attempts ? "FAILED" : "RETRY_REQUIRED",
      attempt_count: attemptNumber,
      last_error_category: "internal",
      clear_lease: true,
    });
    return "failed";
  }
}

export async function runDeliveryScheduler(
  env: Env,
  triggerSource: "cron" | "manual_staging",
): Promise<SchedulerResult> {
  const nowIso = new Date().toISOString();
  const run = await startSchedulerRun(env, triggerSource);
  const workerId = workerInstanceId();

  let lettersDue = 0;
  let lettersClaimed = 0;
  let lettersSent = 0;
  let lettersFailed = 0;
  let staleRecovered = 0;

  try {
    staleRecovered = await recoverStaleProcessingLetters(env, nowIso);
    lettersDue = await countDueLetters(env, nowIso);

    const masterKey = env.LETTER_VAULT_MASTER_KEY_V1;
    if (!masterKey) {
      throw new Error("master_key_not_configured");
    }

    const candidates = await fetchDueLetterCandidates(env, nowIso, 20);

    for (const candidate of candidates) {
      if (!hasVerifiedDeliveryEmail(candidate)) {
        await markAwaitingDeliveryEmail(env, candidate.id);
        continue;
      }

      const claimed = await atomicClaimLetter(
        env,
        candidate.id,
        workerId,
        nowIso,
      );
      if (!claimed) continue;

      lettersClaimed++;
      const outcome = await processClaimedLetter(env, claimed, masterKey);
      if (outcome === "sent") lettersSent++;
      else lettersFailed++;
    }

    await finishSchedulerRun(env, run.id, {
      letters_due_count: lettersDue,
      letters_claimed: lettersClaimed,
      letters_sent: lettersSent,
      letters_failed: lettersFailed,
      stale_recovered: staleRecovered,
      status: "completed",
    });

    return {
      run_id: run.id,
      letters_due_count: lettersDue,
      letters_claimed: lettersClaimed,
      letters_sent: lettersSent,
      letters_failed: lettersFailed,
      stale_recovered: staleRecovered,
      status: "completed",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "scheduler_failed";
    await finishSchedulerRun(env, run.id, {
      letters_due_count: lettersDue,
      letters_claimed: lettersClaimed,
      letters_sent: lettersSent,
      letters_failed: lettersFailed,
      stale_recovered: staleRecovered,
      status: "failed",
      error_summary: message,
    });
    return {
      run_id: run.id,
      letters_due_count: lettersDue,
      letters_claimed: lettersClaimed,
      letters_sent: lettersSent,
      letters_failed: lettersFailed,
      stale_recovered: staleRecovered,
      status: "failed",
    };
  }
}

/** Process a single letter by ID (staging tests / forced delivery). */
export async function processSingleLetter(
  env: Env,
  letterId: string,
): Promise<{ claimed: boolean; outcome: "sent" | "failed" | "not_due" | "already_sent" | "awaiting_delivery_email" }> {
  const { fetchLetterById } = await import("../db/letters");
  const letter = await fetchLetterById(env, letterId);
  if (!letter) return { claimed: false, outcome: "failed" };

  if (letter.status === "SENT" || letter.status === "DELIVERED") {
    return { claimed: false, outcome: "already_sent" };
  }

  const nowIso = new Date().toISOString();
  if (new Date(letter.delivery_at).getTime() > Date.now()) {
    return { claimed: false, outcome: "not_due" };
  }

  const masterKey = env.LETTER_VAULT_MASTER_KEY_V1;
  if (!masterKey) return { claimed: false, outcome: "failed" };

  if (!hasVerifiedDeliveryEmail(letter)) {
    await markAwaitingDeliveryEmail(env, letterId);
    return { claimed: false, outcome: "awaiting_delivery_email" };
  }

  const claimed = await atomicClaimLetter(env, letterId, workerInstanceId(), nowIso);
  if (!claimed) return { claimed: false, outcome: "failed" };

  const outcome = await processClaimedLetter(env, claimed, masterKey);
  return { claimed: true, outcome };
}
