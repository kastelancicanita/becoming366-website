import {
  generateAccessCode,
  hashAccessCode,
  normalizePurchaserEmail,
} from "../crypto/access-code";
import {
  consumeEntitlement,
  fetchEntitlementById,
  findEntitlementByCredentials,
  type EntitlementStatus,
} from "../db/entitlements";
import {
  findEntitlementByCredentialsExtended,
  insertEntitlementExtended,
} from "../db/vault";
import type { Env } from "../env";
import {
  accessDeniedResponse,
  jsonResponse,
  rateLimitedResponse,
} from "../lib/access-response";
import {
  assertDummyOrderRef,
  assertDummyPurchaserEmail,
} from "../lib/dummy-guard";
import {
  clientIp,
  hashBucketKey,
  isRateLimited,
  recordAuthAttempt,
} from "../lib/rate-limit";
import { stagingOnlyResponse } from "../lib/staging-guard";

function requirePepper(env: Env): string | Response {
  const pepper = env.LETTER_VAULT_STAGING_ADMIN_TOKEN;
  if (!pepper) {
    return jsonResponse(
      {
        error: "staging_admin_not_configured",
        message: "LETTER_VAULT_STAGING_ADMIN_TOKEN secret is not set.",
      },
      503,
    );
  }
  return pepper;
}

function requireStagingAdmin(request: Request, env: Env): boolean {
  const token = env.LETTER_VAULT_STAGING_ADMIN_TOKEN;
  if (!token) return false;
  const header = request.headers.get("X-Letter-Vault-Staging-Admin");
  return header === token;
}

interface CredentialsBody {
  access_code?: string;
  purchaser_email?: string;
}

async function parseCredentials(
  request: Request,
): Promise<CredentialsBody | Response> {
  try {
    return (await request.json()) as CredentialsBody;
  } catch {
    return accessDeniedResponse();
  }
}

function validateCredentials(
  body: CredentialsBody,
): { accessCode: string; email: string } | Response {
  const accessCode = body.access_code?.trim() ?? "";
  const emailRaw = body.purchaser_email?.trim() ?? "";

  if (!accessCode || !emailRaw) {
    return accessDeniedResponse();
  }

  const emailError = assertDummyPurchaserEmail(emailRaw);
  if (emailError) {
    return accessDeniedResponse();
  }

  return {
    accessCode,
    email: normalizePurchaserEmail(emailRaw),
  };
}

async function guardAuthAttempt(
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

function entitlementAuthorizable(
  status: EntitlementStatus,
  lettersUsed: number,
  lettersAllowed: number,
): boolean {
  return status === "active" && lettersUsed < lettersAllowed;
}

/** Staging-only: issue dummy entitlement. Raw access code returned once. */
export async function handleEntitlementIssue(
  request: Request,
  env: Env,
): Promise<Response> {
  const blocked = stagingOnlyResponse(env);
  if (blocked) return blocked;

  if (!requireStagingAdmin(request, env)) {
    return accessDeniedResponse();
  }

  const pepper = requirePepper(env);
  if (pepper instanceof Response) return pepper;

  let body: {
    purchaser_email?: string;
    external_order_ref?: string;
    source?: string;
    status?: EntitlementStatus;
    letters_allowed?: number;
    product_type?: string;
    collection_mechanism?: string;
    display_title?: string;
    template_key?: string;
    template_config?: Record<string, unknown>;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const emailError = assertDummyPurchaserEmail(body.purchaser_email ?? "");
  if (emailError) {
    return jsonResponse({ error: "validation_failed", message: emailError }, 400);
  }

  const orderError = assertDummyOrderRef(body.external_order_ref ?? "");
  if (orderError) {
    return jsonResponse({ error: "validation_failed", message: orderError }, 400);
  }

  const status = body.status ?? "active";
  if (!["active", "revoked", "refunded"].includes(status)) {
    return jsonResponse({ error: "validation_failed", message: "invalid status" }, 400);
  }

  const lettersAllowed = body.letters_allowed ?? 1;
  if (lettersAllowed < 1 || lettersAllowed > 10) {
    return jsonResponse(
      {
        error: "validation_failed",
        message: "letters_allowed must be between 1 and 10 (staging)",
      },
      400,
    );
  }

  const productType = body.product_type ?? (lettersAllowed > 1 ? "COLLECTION" : "SINGLE");
  if (!["SINGLE", "COLLECTION"].includes(productType)) {
    return jsonResponse({ error: "validation_failed", message: "invalid product_type" }, 400);
  }

  const mechanism =
    productType === "COLLECTION"
      ? body.collection_mechanism ?? "FREE_COLLECTION"
      : "SINGLE";

  const validMechanisms = ["SINGLE", "FIXED_MILESTONES", "RECURRING", "FREE_COLLECTION"];
  if (!validMechanisms.includes(mechanism)) {
    return jsonResponse({ error: "validation_failed", message: "invalid collection_mechanism" }, 400);
  }

  const accessCode = generateAccessCode();
  const accessCodeHash = await hashAccessCode(pepper, accessCode);
  const purchaserEmail = normalizePurchaserEmail(body.purchaser_email!);

  try {
    const row = await insertEntitlementExtended(env, {
      source: body.source ?? "manual_staging",
      external_order_ref: body.external_order_ref!.trim(),
      access_code_hash: accessCodeHash,
      purchaser_email: purchaserEmail,
      status,
      letters_allowed: lettersAllowed,
      product_type: productType,
      collection_mechanism: mechanism,
      display_title: body.display_title ?? null,
      template_key: body.template_key ?? null,
      template_config: body.template_config ?? null,
    });

    return jsonResponse({
      status: "ok",
      phase: "phase7",
      entitlement_id: row.id,
      purchaser_email: row.purchaser_email,
      external_order_ref: body.external_order_ref!.trim(),
      letters_allowed: row.letters_allowed,
      product_type: row.product_type,
      collection_mechanism: row.collection_mechanism,
      display_title: row.display_title,
      entitlement_status: row.status,
      access_code: accessCode,
      access_code_shown_once: true,
      raw_code_in_db: false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "issue_failed";
    if (message.includes("letter_vault_entitlements")) {
      return jsonResponse(
        {
          error: "entitlements_table_missing",
          message: "Run migration 003_phase3_entitlements.sql in Supabase.",
        },
        503,
      );
    }
    return jsonResponse({ error: "issue_failed", message }, 500);
  }
}

/** Verify access code + email. Does NOT consume entitlement. */
export async function handleEntitlementVerify(
  request: Request,
  env: Env,
): Promise<Response> {
  const blocked = stagingOnlyResponse(env);
  if (blocked) return blocked;

  const pepper = requirePepper(env);
  if (pepper instanceof Response) return pepper;

  const rateBlock = await guardAuthAttempt(request, env, "verify");
  if (rateBlock) return rateBlock;

  const body = await parseCredentials(request);
  if (body instanceof Response) return body;

  const creds = validateCredentials(body);
  if (creds instanceof Response) return creds;

  try {
    const hash = await hashAccessCode(pepper, creds.accessCode);
    const row = await findEntitlementByCredentialsExtended(env, creds.email, hash);

    if (!row || !entitlementAuthorizable(row.status as EntitlementStatus, row.letters_used, row.letters_allowed)) {
      return accessDeniedResponse();
    }

    return jsonResponse({
      status: "ok",
      phase: "phase7",
      authorized: true,
      entitlement_id: row.id,
      product_type: row.product_type ?? "SINGLE",
      collection_mechanism: row.collection_mechanism,
      display_title: row.display_title,
      letters_remaining: row.letters_allowed - row.letters_used,
      letters_allowed: row.letters_allowed,
      letters_used: row.letters_used,
      entitlement_consumed: false,
      raw_access_code_in_response: false,
    });
  } catch {
    return accessDeniedResponse();
  }
}

/** Dummy Phase 3 consume — atomic letters_used increment. */
export async function handleEntitlementConsume(
  request: Request,
  env: Env,
): Promise<Response> {
  const blocked = stagingOnlyResponse(env);
  if (blocked) return blocked;

  const pepper = requirePepper(env);
  if (pepper instanceof Response) return pepper;

  const rateBlock = await guardAuthAttempt(request, env, "consume");
  if (rateBlock) return rateBlock;

  const body = await parseCredentials(request);
  if (body instanceof Response) return body;

  const creds = validateCredentials(body);
  if (creds instanceof Response) return creds;

  try {
    const hash = await hashAccessCode(pepper, creds.accessCode);
    const result = await consumeEntitlement(env, creds.email, hash);

    if (!result.consumed) {
      return accessDeniedResponse();
    }

    return jsonResponse({
      status: "ok",
      phase: "phase3",
      consumed: true,
      letters_used: result.letters_used,
      letters_remaining: (result.letters_allowed ?? 1) - (result.letters_used ?? 1),
      raw_access_code_in_response: false,
    });
  } catch {
    return accessDeniedResponse();
  }
}

/** Staging-only internal read — no access code fields. */
export async function handleEntitlementStatus(
  request: Request,
  env: Env,
  id: string,
): Promise<Response> {
  const blocked = stagingOnlyResponse(env);
  if (blocked) return blocked;

  if (!requireStagingAdmin(request, env)) {
    return accessDeniedResponse();
  }

  try {
    const row = await fetchEntitlementById(env, id);
    if (!row) {
      return accessDeniedResponse();
    }

    return jsonResponse({
      status: "ok",
      phase: "phase3",
      entitlement_id: row.id,
      purchaser_email: row.purchaser_email,
      entitlement_status: row.status,
      letters_allowed: row.letters_allowed,
      letters_used: row.letters_used,
      access_code_hash_in_response: false,
      raw_access_code_in_response: false,
    });
  } catch {
    return accessDeniedResponse();
  }
}
