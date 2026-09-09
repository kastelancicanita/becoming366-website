import {
  generateAccessCode,
  hashAccessCode,
  normalizePurchaserEmail,
} from "../crypto/access-code";
import {
  assertRevocableInternalTest,
  deleteInternalTestEntitlement,
  fetchInternalTestEntitlement,
  fetchInternalTestEntitlementByRef,
} from "../db/internal-test-cleanup";
import { insertEntitlementExtended } from "../db/vault";
import type { Env } from "../env";
import { accessDeniedResponse, jsonResponse } from "../lib/access-response";
import { getAccessPepper } from "../lib/env-secrets";
import {
  INTERNAL_TEST_DISPLAY_TITLE,
  INTERNAL_TEST_SOURCE,
  buildInternalTestOrderRef,
} from "../lib/internal-test-entitlement";
import { requireProductionAdmin } from "../lib/env-secrets";
import {
  assertProductionPurchaserEmail,
  productionOnlyResponse,
} from "../lib/production-data-guard";

function mapInsertError(err: unknown): Response {
  const message = err instanceof Error ? err.message : "insert_failed";
  if (message.includes("duplicate") || message.includes("unique")) {
    return jsonResponse({ error: "duplicate_order_ref" }, 409);
  }
  return jsonResponse({ error: "insert_failed", message: "internal_error" }, 500);
}

/** POST /v1/production/ops/issue-internal-test-entitlement */
export async function handleProductionIssueInternalTestEntitlement(
  request: Request,
  env: Env,
): Promise<Response> {
  const blocked = productionOnlyResponse(env);
  if (blocked) return blocked;
  if (!requireProductionAdmin(request, env)) return accessDeniedResponse();

  let body: { purchaser_email?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const emailError = assertProductionPurchaserEmail(body.purchaser_email ?? "");
  if (emailError) {
    return jsonResponse(
      {
        error: "validation_failed",
        message: "Purchaser email must be a real address (not a test domain).",
      },
      400,
    );
  }

  const externalOrderRef = buildInternalTestOrderRef();
  const purchaserEmail = normalizePurchaserEmail(body.purchaser_email!);

  try {
    let pepper: string;
    try {
      pepper = getAccessPepper(env);
    } catch {
      return jsonResponse({ error: "access_pepper_not_configured" }, 503);
    }

    const accessCode = generateAccessCode();
    const accessCodeHash = await hashAccessCode(pepper, accessCode);

    const row = await insertEntitlementExtended(env, {
      source: INTERNAL_TEST_SOURCE,
      external_order_ref: externalOrderRef,
      access_code_hash: accessCodeHash,
      purchaser_email: purchaserEmail,
      status: "active",
      letters_allowed: 1,
      product_type: "SINGLE",
      collection_mechanism: "SINGLE",
      display_title: INTERNAL_TEST_DISPLAY_TITLE,
      template_key: null,
      template_config: null,
    });

    return jsonResponse({
      status: "ok",
      phase: "8B-A",
      kind: "internal_test",
      entitlement_id: row.id,
      external_order_ref: externalOrderRef,
      purchaser_email: row.purchaser_email,
      letters_allowed: 1,
      product_type: "SINGLE",
      display_title: INTERNAL_TEST_DISPLAY_TITLE,
      entitlement_status: row.status,
      access_code: accessCode,
      access_code_shown_once: true,
      raw_code_in_db: false,
      email_sent: false,
      etsy_sale: false,
      delivery_instructions:
        "Copy the access code now. Send it to your friend manually (not via Etsy). Enter at https://becoming366.com/letter-vault/",
      cleanup:
        "After E2E: node letter-vault/scripts/revoke-production-internal-test-entitlement.mjs --id <entitlement_id>",
    });
  } catch (err) {
    return mapInsertError(err);
  }
}

/** POST /v1/production/ops/revoke-internal-test-entitlement */
export async function handleProductionRevokeInternalTestEntitlement(
  request: Request,
  env: Env,
): Promise<Response> {
  const blocked = productionOnlyResponse(env);
  if (blocked) return blocked;
  if (!requireProductionAdmin(request, env)) return accessDeniedResponse();

  let body: { entitlement_id?: string; external_order_ref?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const entitlementId = body.entitlement_id?.trim() ?? "";
  const externalRef = body.external_order_ref?.trim() ?? "";
  if (!entitlementId && !externalRef) {
    return jsonResponse(
      {
        error: "validation_failed",
        message: "Provide entitlement_id or external_order_ref.",
      },
      400,
    );
  }

  try {
    const row = entitlementId
      ? await fetchInternalTestEntitlement(env, entitlementId)
      : await fetchInternalTestEntitlementByRef(env, externalRef);

    if (!row) {
      return jsonResponse({ error: "not_found" }, 404);
    }

    assertRevocableInternalTest(row);
    const result = await deleteInternalTestEntitlement(env, row.id);

    return jsonResponse({
      status: "ok",
      phase: "8B-A",
      kind: "internal_test_cleanup",
      entitlement_id: result.entitlement_id,
      external_order_ref: row.external_order_ref,
      letters_deleted: result.letters_deleted,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "revoke_failed";
    console.error("internal_test_revoke_failed", message);
    if (message === "not_internal_test_entitlement") {
      return jsonResponse(
        {
          error: "forbidden",
          message: "Only INTERNAL_TEST entitlements can be revoked via this route.",
        },
        403,
      );
    }
    return jsonResponse(
      {
        error: "revoke_failed",
        message: "internal_error",
        hint: "If this persists, retry with --skip-revoke to issue a fresh code.",
      },
      500,
    );
  }
}
