import { hashAccessCode, normalizePurchaserEmail } from "../crypto/access-code";
import { encryptPayload } from "../crypto/envelope";
import {
  countSlotsForEntitlement,
  createVaultSession,
  fetchCollectionByEntitlement,
  fetchEntitlementProduct,
  fetchSlotById,
  fetchSlotsForEntitlement,
  findEntitlementByCredentialsExtended,
  insertCollection,
  insertSlots,
  sealSlotAtomic,
  updateSlotDraftMetadata,
  validateVaultSession,
} from "../db/vault";
import { insertOutboundQueued, markOutboundSendResult, markOutboundSending } from "../db/email-store";
import {
  buildSealConfirmationHtml,
  buildSealConfirmationSubject,
  buildSealConfirmationText,
} from "../email/templates/seal-confirmation";
import { sendViaResend } from "../email/resend-client";
import type { Env } from "../env";
import {
  generateCollectionSlots,
  listFutureValidMilestoneOptions,
  previewRecurringSlots,
  supportedMilestoneAges,
  validateLetterLength,
  validateMilestoneSelection,
  type RecipientContext,
  type TemplateConfig,
} from "../lib/collection-slots";
import { assertDummyPurchaserEmail } from "../lib/dummy-guard";
import {
  customerApiEnvironmentGuard,
  validateCustomerPurchaserEmail,
} from "../lib/production-data-guard";
import {
  applyDeliveryEmailUpdate,
  customerDeliveryEmailCapabilities,
} from "../lib/delivery-email-update";
import {
  clientIp,
  hashBucketKey,
  isRateLimited,
  recordAuthAttempt,
} from "../lib/rate-limit";
import { stagingOnlyResponse } from "../lib/staging-guard";
import { jsonResponse } from "../lib/management-response";
import {
  fetchLetterByPublicIdForEntitlement,
} from "../db/letters";

export const VAULT_SESSION_HEADER = "X-Letter-Vault-Session";

const VAULT_DENIED = {
  status: "error",
  message:
    "We couldn't verify those details. Check your access code and purchase email and try again.",
} as const;

function pepper(env: Env): string {
  const p = env.LETTER_VAULT_STAGING_ADMIN_TOKEN;
  if (!p) throw new Error("vault_pepper_not_configured");
  return p;
}

async function guardVaultAttempt(
  request: Request,
  env: Env,
  endpoint: string,
): Promise<Response | null> {
  const bucket = await hashBucketKey(`${clientIp(request)}:${endpoint}`);
  if (await isRateLimited(env, bucket)) {
    return jsonResponse({ status: "error", message: "Too many attempts. Try again later." }, 429);
  }
  await recordAuthAttempt(env, bucket);
  return null;
}

function sessionFromRequest(request: Request): string | null {
  return request.headers.get(VAULT_SESSION_HEADER)?.trim() ?? null;
}

async function requireVaultSession(
  request: Request,
  env: Env,
): Promise<{ entitlement_id: string } | Response> {
  const raw = sessionFromRequest(request);
  if (!raw) return jsonResponse(VAULT_DENIED, 401);
  const valid = await validateVaultSession(env, raw);
  if (!valid) return jsonResponse(VAULT_DENIED, 401);
  return valid;
}

function entitlementActive(row: { status: string; letters_used: number; letters_allowed: number }): boolean {
  return row.status === "active" && row.letters_used <= row.letters_allowed;
}

/** POST /v1/vault/enter — verify access code; does NOT consume. */
export async function handleVaultEnter(request: Request, env: Env): Promise<Response> {
  const blocked = customerApiEnvironmentGuard(env);
  if (blocked) return blocked;

  const limited = await guardVaultAttempt(request, env, "vault_enter");
  if (limited) return limited;

  let body: { access_code?: string; purchaser_email?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse(VAULT_DENIED, 401);
  }

  const accessCode = body.access_code?.trim() ?? "";
  const emailRaw = body.purchaser_email?.trim() ?? "";
  if (!accessCode || !emailRaw) return jsonResponse(VAULT_DENIED, 401);

  const emailError = assertDummyPurchaserEmail(emailRaw);
  if (emailError) return jsonResponse(VAULT_DENIED, 401);

  try {
    const hash = await hashAccessCode(pepper(env), accessCode);
    const email = normalizePurchaserEmail(emailRaw);
    const row = await findEntitlementByCredentialsExtended(env, email, hash);

    if (!row || !entitlementActive(row)) {
      return jsonResponse(VAULT_DENIED, 401);
    }

    const session = await createVaultSession(env, row.id);
    const slots = await fetchSlotsForEntitlement(env, row.id);
    const collection = await fetchCollectionByEntitlement(env, row.id);

    const needsInit =
      row.product_type === "COLLECTION" &&
      row.collection_mechanism !== "SINGLE" &&
      !collection;

    const needsSingleSlot =
      row.product_type === "SINGLE" && slots.length === 0;

    return jsonResponse({
      status: "ok",
      phase: "phase7",
      vault_session_token: session.session_token,
      session_expires_at: session.expires_at,
      entitlement_id: row.id,
      product_type: row.product_type,
      collection_mechanism: row.collection_mechanism,
      display_title: row.display_title,
      letters_allowed: row.letters_allowed,
      letters_used: row.letters_used,
      letters_remaining: row.letters_allowed - row.letters_used,
      needs_collection_init: needsInit,
      needs_single_slot: needsSingleSlot,
      collection_initialized: Boolean(collection?.initialized_at),
      slots: slots.map(publicSlotView),
      ...customerDeliveryEmailCapabilities(env),
      letter_body_in_response: false,
      raw_access_code_in_response: false,
    });
  } catch {
    return jsonResponse(VAULT_DENIED, 401);
  }
}

function publicSlotView(slot: {
  id: string;
  slot_index: number;
  moment_label: string | null;
  delivery_at: string | null;
  slot_status: string;
  recipient_context: Record<string, unknown> | null;
  public_letter_id?: string | null;
  delivery_email_masked?: string | null;
  has_delivery_email?: boolean;
  delivery_email_mode?: string | null;
  delivery_email_pending_verification?: boolean;
}) {
  return {
    slot_id: slot.id,
    slot_index: slot.slot_index,
    moment_label: slot.moment_label,
    delivery_at: slot.delivery_at,
    slot_status: slot.slot_status,
    recipient_context: slot.recipient_context,
    public_letter_id: slot.public_letter_id ?? null,
    delivery_email_masked: slot.delivery_email_masked ?? null,
    has_delivery_email: slot.has_delivery_email ?? false,
    delivery_email_mode: slot.delivery_email_mode ?? null,
    delivery_email_pending_verification:
      slot.delivery_email_pending_verification ?? false,
    letter_body_in_response: false,
  };
}

/** GET /v1/vault/state */
export async function handleVaultState(request: Request, env: Env): Promise<Response> {
  const blocked = customerApiEnvironmentGuard(env);
  if (blocked) return blocked;

  const session = await requireVaultSession(request, env);
  if (session instanceof Response) return session;

  try {
    const row = await fetchEntitlementProduct(env, session.entitlement_id);
    if (!row || !entitlementActive(row)) return jsonResponse(VAULT_DENIED, 401);

    const slots = await fetchSlotsForEntitlement(env, row.id);
    const collection = await fetchCollectionByEntitlement(env, row.id);

    return jsonResponse({
      status: "ok",
      phase: "phase7",
      product_type: row.product_type,
      collection_mechanism: row.collection_mechanism,
      display_title: row.display_title,
      letters_allowed: row.letters_allowed,
      letters_used: row.letters_used,
      letters_remaining: row.letters_allowed - row.letters_used,
      collection: collection
        ? {
            id: collection.id,
            display_title: collection.display_title,
            collection_mechanism: collection.collection_mechanism,
            slot_count: collection.slot_count,
            initialized_at: collection.initialized_at,
          }
        : null,
      slots: slots.map(publicSlotView),
      ...customerDeliveryEmailCapabilities(env),
      letter_body_in_response: false,
    });
  } catch {
    return jsonResponse(VAULT_DENIED, 401);
  }
}

/** POST /v1/vault/collection/milestone-options — future-valid milestones for DOB */
export async function handleVaultCollectionMilestoneOptions(
  request: Request,
  env: Env,
): Promise<Response> {
  const blocked = customerApiEnvironmentGuard(env);
  if (blocked) return blocked;

  const session = await requireVaultSession(request, env);
  if (session instanceof Response) return session;

  let body: { base_date?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse({ status: "error", message: "Invalid request." }, 400);
  }

  const baseDate = body.base_date?.slice(0, 10);
  if (!baseDate) {
    return jsonResponse({ status: "error", message: "Date of birth is required." }, 400);
  }

  try {
    const row = await fetchEntitlementProduct(env, session.entitlement_id);
    if (!row || row.collection_mechanism !== "FIXED_MILESTONES") {
      return jsonResponse(VAULT_DENIED, 401);
    }

    const config = (row.template_config as TemplateConfig) ?? undefined;
    const futureValid = listFutureValidMilestoneOptions(baseDate, config);
    const required = row.letters_allowed;

    return jsonResponse({
      status: "ok",
      phase: "phase7",
      supported_milestone_ages: supportedMilestoneAges(config),
      future_valid_options: futureValid,
      letters_required: required,
      sufficient: futureValid.length >= required,
      future_valid_count: futureValid.length,
    });
  } catch {
    return jsonResponse({ status: "error", message: "Could not load milestone options." }, 500);
  }
}

/** POST /v1/vault/collection/recurring-preview — preview dates from customer base date */
export async function handleVaultCollectionRecurringPreview(
  request: Request,
  env: Env,
): Promise<Response> {
  const blocked = customerApiEnvironmentGuard(env);
  if (blocked) return blocked;

  const session = await requireVaultSession(request, env);
  if (session instanceof Response) return session;

  let body: { base_date?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse({ status: "error", message: "Invalid request." }, 400);
  }

  const baseDate = body.base_date?.slice(0, 10);
  if (!baseDate) {
    return jsonResponse({
      status: "error",
      message: "Please enter your anniversary or birthday date.",
    }, 400);
  }

  try {
    const row = await fetchEntitlementProduct(env, session.entitlement_id);
    if (!row || row.collection_mechanism !== "RECURRING") {
      return jsonResponse(VAULT_DENIED, 401);
    }

    const config = (row.template_config as TemplateConfig) ?? undefined;
    const previews = previewRecurringSlots(
      baseDate,
      row.letters_allowed,
      config,
    );

    return jsonResponse({
      status: "ok",
      phase: "phase7",
      preview_slots: previews,
      letters_count: row.letters_allowed,
    });
  } catch {
    return jsonResponse({ status: "error", message: "Could not preview dates." }, 500);
  }
}

/** POST /v1/vault/collection/init */
export async function handleVaultCollectionInit(
  request: Request,
  env: Env,
): Promise<Response> {
  const blocked = customerApiEnvironmentGuard(env);
  if (blocked) return blocked;

  const session = await requireVaultSession(request, env);
  if (session instanceof Response) return session;

  let body: {
    base_date?: string;
    shared_recipient_context?: RecipientContext;
    selected_milestone_ages?: number[];
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse({ status: "error", message: "Invalid request." }, 400);
  }

  try {
    const row = await fetchEntitlementProduct(env, session.entitlement_id);
    if (!row || row.product_type !== "COLLECTION" || !row.collection_mechanism) {
      return jsonResponse(VAULT_DENIED, 401);
    }

    const existing = await fetchCollectionByEntitlement(env, row.id);
    if (existing) {
      const slots = await fetchSlotsForEntitlement(env, row.id);
      return jsonResponse({
        status: "ok",
        phase: "phase7",
        already_initialized: true,
        collection_id: existing.id,
        slots: slots.map(publicSlotView),
      });
    }

    const existingSlotCount = await countSlotsForEntitlement(env, row.id);
    if (existingSlotCount > 0) {
      return jsonResponse({ status: "error", message: "Slots already exist." }, 409);
    }

    const mechanism = row.collection_mechanism as
      | "FIXED_MILESTONES"
      | "RECURRING"
      | "FREE_COLLECTION";

    const templateConfig = (row.template_config as TemplateConfig) ?? undefined;

    if (mechanism === "RECURRING") {
      const baseDate = body.base_date?.slice(0, 10);
      if (!baseDate) {
        return jsonResponse({
          status: "error",
          message: "Please enter your anniversary or birthday date.",
        }, 400);
      }
    }

    if (mechanism === "FIXED_MILESTONES") {
      const baseDate = body.base_date?.slice(0, 10);
      if (!baseDate) {
        return jsonResponse({ status: "error", message: "Date of birth is required." }, 400);
      }
      const selected = body.selected_milestone_ages ?? [];
      const validation = validateMilestoneSelection(
        baseDate,
        selected,
        row.letters_allowed,
        templateConfig,
      );
      if (!validation.ok) {
        return jsonResponse(
          {
            status: "error",
            code: validation.code,
            message: validation.message,
            future_valid_count: validation.future_valid_count,
            required_count: validation.required_count ?? row.letters_allowed,
          },
          400,
        );
      }
    }

    const slotDrafts = generateCollectionSlots(
      mechanism,
      row.letters_allowed,
      body.base_date ?? null,
      body.shared_recipient_context,
      templateConfig,
      mechanism === "FIXED_MILESTONES" ? body.selected_milestone_ages : undefined,
    );

    const collection = await insertCollection(env, {
      entitlement_id: row.id,
      display_title: row.display_title ?? "Your Letter Collection",
      collection_mechanism: mechanism,
      shared_recipient_context: (body.shared_recipient_context ?? null) as Record<
        string,
        unknown
      > | null,
      base_date: body.base_date?.slice(0, 10) ?? null,
      slot_count: row.letters_allowed,
    });

    const slots = await insertSlots(
      env,
      slotDrafts.map((s) => ({
        entitlement_id: row.id,
        collection_id: collection.id,
        slot_index: s.slot_index,
        moment_label: s.moment_label,
        delivery_at: s.delivery_at,
        recipient_context: (s.recipient_context ??
          body.shared_recipient_context ??
          null) as Record<string, unknown> | null,
      })),
    );

    return jsonResponse({
      status: "ok",
      phase: "phase7",
      collection_id: collection.id,
      slots: slots.map(publicSlotView),
      letter_body_in_response: false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "init_failed";
    const status = message.includes("milestone") || message.includes("required") ? 400 : 500;
    return jsonResponse({ status: "error", message }, status);
  }
}

/** POST /v1/vault/single/prepare — create single slot if needed */
export async function handleVaultSinglePrepare(
  request: Request,
  env: Env,
): Promise<Response> {
  const blocked = customerApiEnvironmentGuard(env);
  if (blocked) return blocked;

  const session = await requireVaultSession(request, env);
  if (session instanceof Response) return session;

  try {
    const row = await fetchEntitlementProduct(env, session.entitlement_id);
    if (!row || row.product_type !== "SINGLE") {
      return jsonResponse(VAULT_DENIED, 401);
    }

    let slots = await fetchSlotsForEntitlement(env, row.id);
    if (slots.length === 0) {
      slots = await insertSlots(env, [
        {
          entitlement_id: row.id,
          slot_index: 1,
          moment_label: "Your letter",
          delivery_at: new Date(Date.now() + 365 * 86400000).toISOString(),
        },
      ]);
    }

    return jsonResponse({
      status: "ok",
      phase: "phase7",
      slot: publicSlotView(slots[0]),
    });
  } catch {
    return jsonResponse({ status: "error", message: "Could not prepare letter." }, 500);
  }
}

/** PATCH /v1/vault/slots/:id — update UNWRITTEN slot metadata */
export async function handleVaultSlotUpdate(
  request: Request,
  env: Env,
  slotId: string,
): Promise<Response> {
  const blocked = customerApiEnvironmentGuard(env);
  if (blocked) return blocked;

  const session = await requireVaultSession(request, env);
  if (session instanceof Response) return session;

  let body: {
    moment_label?: string;
    delivery_at?: string;
    recipient_context?: RecipientContext;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse({ status: "error", message: "Invalid request." }, 400);
  }

  try {
    const slot = await fetchSlotById(env, slotId, session.entitlement_id);
    if (!slot || slot.slot_status !== "UNWRITTEN") {
      return jsonResponse({ status: "error", message: "Slot not available." }, 404);
    }

    await updateSlotDraftMetadata(env, slotId, {
      moment_label: body.moment_label,
      delivery_at: body.delivery_at,
      recipient_context: body.recipient_context as Record<string, unknown> | undefined,
    });

    return jsonResponse({ status: "ok", phase: "phase7" });
  } catch {
    return jsonResponse({ status: "error", message: "Update failed." }, 500);
  }
}

/** POST /v1/vault/slots/:id/seal */
export async function handleVaultSlotSeal(
  request: Request,
  env: Env,
  slotId: string,
): Promise<Response> {
  const blocked = customerApiEnvironmentGuard(env);
  if (blocked) return blocked;

  const session = await requireVaultSession(request, env);
  if (session instanceof Response) return session;

  let body: {
    letter_text?: string;
    delivery_at?: string;
    recipient_context?: RecipientContext;
    moment_label?: string;
    recipient_email?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse({ status: "error", message: "Invalid request." }, 400);
  }

  const letterText = body.letter_text ?? "";
  if (!validateLetterLength(letterText)) {
    return jsonResponse(
      { status: "error", message: "Letter exceeds 15,000 characters." },
      400,
    );
  }

  const masterKey = env.LETTER_VAULT_MASTER_KEY_V1;
  if (!masterKey) {
    return jsonResponse({ status: "error", message: "Vault unavailable." }, 503);
  }

  try {
    const row = await fetchEntitlementProduct(env, session.entitlement_id);
    if (!row || !entitlementActive(row)) return jsonResponse(VAULT_DENIED, 401);

    const slot = await fetchSlotById(env, slotId, session.entitlement_id);
    if (!slot || slot.slot_status !== "UNWRITTEN") {
      return jsonResponse(
        { status: "error", message: "This letter is already sealed or unavailable." },
        409,
      );
    }

    const deliveryAt = body.delivery_at ?? slot.delivery_at;
    if (!deliveryAt || new Date(deliveryAt).getTime() <= Date.now()) {
      return jsonResponse(
        { status: "error", message: "Delivery date must be in the future." },
        400,
      );
    }

    const deliveryEmail = body.recipient_email?.trim().toLowerCase() ?? null;
    if (deliveryEmail) {
      const emailErr = assertDummyPurchaserEmail(deliveryEmail);
      if (emailErr) {
        return jsonResponse({ status: "error", message: emailErr }, 400);
      }
    }

    const envelope = await encryptPayload(masterKey, letterText);

    const sealed = await sealSlotAtomic(env, {
      slot_id: slotId,
      entitlement_id: row.id,
      purchaser_email: row.purchaser_email,
      label: `vault-${slot.slot_index}`,
      delivery_at: deliveryAt,
      delivery_timezone: slot.delivery_timezone ?? "UTC",
      recipient_context: (body.recipient_context ??
        slot.recipient_context) as Record<string, unknown> | null,
      moment_label: body.moment_label ?? slot.moment_label,
      envelope,
      recipient_email: deliveryEmail,
    });

    const idempotencyKey = `SEAL-CONFIRM-${sealed.letter_id}`;
    const { row: outbound, duplicate } = await insertOutboundQueued(env, {
      idempotency_key: idempotencyKey,
      recipient_email: row.purchaser_email,
      delivery_date: deliveryAt.slice(0, 10),
      letter_ref: sealed.letter_id,
      entitlement_ref: row.id,
      email_type: "seal_confirmation",
    });

    if (!duplicate && outbound) {
      await markOutboundSending(env, outbound.id);
      const html = buildSealConfirmationHtml({ deliveryDateIso: deliveryAt.slice(0, 10) });
      const text = buildSealConfirmationText({ deliveryDateIso: deliveryAt.slice(0, 10) });
      const sendResult = await sendViaResend(env, {
        to: row.purchaser_email,
        subject: buildSealConfirmationSubject(),
        html: html.replace(
          "Your letter is sealed.",
          `Your letter is sealed.<br><br><strong>Your Letter ID:</strong> ${sealed.public_letter_id}`,
        ),
        text: `${text}\n\nYour Letter ID: ${sealed.public_letter_id}`,
      });
      await markOutboundSendResult(env, outbound.id, {
        ok: sendResult.ok,
        providerMessageId: sendResult.providerMessageId,
        errorSummary: sendResult.errorSummary,
      });
    }

    return jsonResponse({
      status: "ok",
      phase: "phase7",
      public_letter_id: sealed.public_letter_id,
      letter_id: sealed.letter_id,
      delivery_at: deliveryAt,
      letters_used: sealed.letters_used,
      letters_remaining: sealed.letters_allowed - sealed.letters_used,
      delivery_email_added: Boolean(deliveryEmail),
      letter_body_in_response: false,
      plaintext_in_response: false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "seal_failed";
    if (message.includes("allocation_exhausted") || message.includes("slot_already_sealed")) {
      return jsonResponse(
        { status: "error", message: "No letter slots remaining or slot already sealed." },
        409,
      );
    }
    return jsonResponse(
      { status: "error", message: "We couldn't seal your letter. Please try again." },
      500,
    );
  }
}

/** POST /v1/vault/delivery-email — add/change delivery email during active Vault session. */
export async function handleVaultDeliveryEmailRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  const blocked = customerApiEnvironmentGuard(env);
  if (blocked) return blocked;

  const session = await requireVaultSession(request, env);
  if (session instanceof Response) return session;

  let body: {
    public_letter_id?: string;
    delivery_email?: string;
    delivery_email_mode?: "surprise" | "verify_now";
    surprise_personal_declaration_accepted?: boolean;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse({ status: "error", message: "Invalid request." }, 400);
  }

  const publicLetterId = body.public_letter_id?.trim() ?? "";
  const email = body.delivery_email?.trim().toLowerCase() ?? "";
  const emailError = validateCustomerPurchaserEmail(env, email);
  if (!publicLetterId || emailError) {
    return jsonResponse(
      { status: "error", message: emailError || "Invalid request." },
      400,
    );
  }

  try {
    const letter = await fetchLetterByPublicIdForEntitlement(
      env,
      publicLetterId,
      session.entitlement_id,
    );
    if (!letter) {
      return jsonResponse({ status: "error", message: "Invalid request." }, 404);
    }

    const mode =
      body.delivery_email_mode === "surprise" ? "surprise" : "verify_now";
    return applyDeliveryEmailUpdate(env, request, letter, email, mode, {
      surprisePersonalDeclarationAccepted:
        body.surprise_personal_declaration_accepted,
    });
  } catch {
    return jsonResponse(
      { status: "error", message: "We couldn't save that address. Please try again." },
      500,
    );
  }
}

/** POST /v1/vault/unicode-test — staging roundtrip (no auth; staging guard only) */
export async function handleVaultUnicodeTest(request: Request, env: Env): Promise<Response> {
  const blocked = stagingOnlyResponse(env);
  if (blocked) return blocked;

  const masterKey = env.LETTER_VAULT_MASTER_KEY_V1;
  if (!masterKey) return jsonResponse({ error: "no_key" }, 503);

  let body: { sample?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const sample = body.sample ?? "";
  const envelope = await encryptPayload(masterKey, sample);
  const { decryptPayload, verifyEnvelope } = await import("../crypto/envelope");
  const ok = await verifyEnvelope(masterKey, envelope);
  const decrypted = new TextDecoder().decode(await decryptPayload(masterKey, envelope));
  const exactMatch = decrypted === sample;

  return jsonResponse({
    status: "ok",
    verify_ok: ok,
    exact_match: exactMatch,
    input_length: [...sample].length,
    output_length: [...decrypted].length,
    plaintext_in_response: false,
    sample_in_response: false,
  });
}
