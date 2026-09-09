import type { Env } from "./env";
import { handleCorsPreflight, withCors } from "./lib/cors";
import { runDeliveryScheduler } from "./delivery/scheduler";
import { handleHealth } from "./routes/health";
import {
  handleLetterStatus,
  handleProcessLetter,
  handleSchedulerRun,
  handleSchedulerStatus,
  handleSealScheduledLetter,
  handleSimulateStaleLease,
  handleStagingForceSurpriseDelivery,
  handleStagingBackdateDelivery,
  handleStagingLetterByPublicId,
} from "./routes/delivery";
import {
  handleEmailIdempotencyCheck,
  handleEmailOutboundStatus,
  handleSendSealConfirmation,
} from "./routes/email";
import {
  handleEntitlementConsume,
  handleEntitlementIssue,
  handleEntitlementStatus,
  handleEntitlementVerify,
} from "./routes/entitlements";
import {
  handlePocRoundtrip,
  handlePocSeal,
  handlePocVerify,
} from "./routes/poc";
import {
  handleDeliveryEmailChangeRequest,
  handleDeliveryEmailConfirmGet,
  handleDeliveryEmailConfirmPost,
  handleManagementActivateGet,
  handleManagementActivatePost,
  handleManagementRequest,
  handleManagementSessionView,
  handleManagementTestAudit,
  handleManagementTestMintToken,
  handleManagementTestMintDeliveryVerify,
  handleManagementTestNoBodyAccess,
  handleManagementTestTokenStorage,
} from "./routes/management";
import {
  handleVaultCollectionInit,
  handleVaultCollectionMilestoneOptions,
  handleVaultCollectionRecurringPreview,
  handleVaultDeliveryEmailRequest,
  handleVaultEnter,
  handleVaultSinglePrepare,
  handleVaultSlotSeal,
  handleVaultSlotUpdate,
  handleVaultState,
  handleVaultUnicodeTest,
} from "./routes/vault";
import {
  handleMailerSendWebhook,
  handleResendWebhook,
  handleStagingWebhookSimulate,
} from "./routes/webhooks";

function notFound(): Response {
  return Response.json(
    { error: "not_found", service: "letter-vault-api" },
    { status: 404, headers: { "Cache-Control": "no-store" } },
  );
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    const preflight = handleCorsPreflight(request);
    if (preflight) return preflight;

    const isVaultPath =
      pathname.startsWith("/v1/vault/") ||
      pathname.startsWith("/v1/staging/management/");

    async function respond(handler: Promise<Response>): Promise<Response> {
      const response = await handler;
      return isVaultPath ? withCors(response, request) : response;
    }

    if (request.method === "GET" && pathname === "/v1/health") {
      return handleHealth(env);
    }

    if (pathname === "/v1/webhooks/resend" && request.method === "POST") {
      return handleResendWebhook(request, env);
    }

    if (pathname === "/v1/webhooks/mailersend" && request.method === "POST") {
      return handleMailerSendWebhook(request, env);
    }

    if (pathname === "/v1/staging/poc/roundtrip" && request.method === "POST") {
      return handlePocRoundtrip(request, env);
    }
    if (pathname === "/v1/staging/poc/seal" && request.method === "POST") {
      return handlePocSeal(request, env);
    }
    const verifyMatch = pathname.match(
      /^\/v1\/staging\/poc\/verify\/([0-9a-f-]{36})$/,
    );
    if (verifyMatch && request.method === "GET") {
      return handlePocVerify(env, verifyMatch[1]);
    }

    if (pathname === "/v1/staging/entitlements/issue" && request.method === "POST") {
      return handleEntitlementIssue(request, env);
    }
    if (pathname === "/v1/staging/entitlements/verify" && request.method === "POST") {
      return handleEntitlementVerify(request, env);
    }
    if (pathname === "/v1/staging/entitlements/consume" && request.method === "POST") {
      return handleEntitlementConsume(request, env);
    }
    const entitlementStatusMatch = pathname.match(
      /^\/v1\/staging\/entitlements\/status\/([0-9a-f-]{36})$/,
    );
    if (entitlementStatusMatch && request.method === "GET") {
      return handleEntitlementStatus(request, env, entitlementStatusMatch[1]);
    }

    if (
      pathname === "/v1/staging/email/send-confirmation" &&
      request.method === "POST"
    ) {
      return handleSendSealConfirmation(request, env);
    }
    const emailStatusMatch = pathname.match(
      /^\/v1\/staging\/email\/status\/([0-9a-f-]{36})$/,
    );
    if (emailStatusMatch && request.method === "GET") {
      return handleEmailOutboundStatus(request, env, emailStatusMatch[1]);
    }
    if (
      pathname === "/v1/staging/email/idempotency-check" &&
      request.method === "GET"
    ) {
      return handleEmailIdempotencyCheck(request, env);
    }
    if (
      pathname === "/v1/staging/webhooks/simulate" &&
      request.method === "POST"
    ) {
      return handleStagingWebhookSimulate(request, env);
    }

    // Phase 5 — scheduled delivery (staging dummy data)
    if (
      pathname === "/v1/staging/letters/seal-scheduled" &&
      request.method === "POST"
    ) {
      return handleSealScheduledLetter(request, env);
    }
    if (
      pathname === "/v1/staging/scheduler/run" &&
      request.method === "POST"
    ) {
      return handleSchedulerRun(request, env);
    }
    if (
      pathname === "/v1/staging/scheduler/status" &&
      request.method === "GET"
    ) {
      return handleSchedulerStatus(request, env);
    }
    if (
      pathname === "/v1/staging/surprise/force-set-delivery" &&
      request.method === "POST"
    ) {
      return handleStagingForceSurpriseDelivery(request, env);
    }
    if (
      pathname === "/v1/staging/letters/backdate-delivery" &&
      request.method === "POST"
    ) {
      return handleStagingBackdateDelivery(request, env);
    }
    if (
      pathname === "/v1/staging/letters/by-public-id" &&
      request.method === "GET"
    ) {
      return handleStagingLetterByPublicId(request, env);
    }
    const letterStatusMatch = pathname.match(
      /^\/v1\/staging\/letters\/status\/([0-9a-f-]{36})$/,
    );
    if (letterStatusMatch && request.method === "GET") {
      return handleLetterStatus(request, env, letterStatusMatch[1]);
    }
    const processMatch = pathname.match(
      /^\/v1\/staging\/letters\/process\/([0-9a-f-]{36})$/,
    );
    if (processMatch && request.method === "POST") {
      return handleProcessLetter(request, env, processMatch[1]);
    }
    const staleMatch = pathname.match(
      /^\/v1\/staging\/letters\/simulate-stale\/([0-9a-f-]{36})$/,
    );
    if (staleMatch && request.method === "POST") {
      return handleSimulateStaleLease(request, env, staleMatch[1]);
    }

    // Phase 6 — management access + delivery email updates (staging dummy data)
    if (
      pathname === "/v1/staging/management/request" &&
      request.method === "POST"
    ) {
      return respond(handleManagementRequest(request, env));
    }
    if (
      pathname === "/v1/staging/management/activate" &&
      request.method === "POST"
    ) {
      return respond(handleManagementActivatePost(request, env));
    }
    if (
      pathname === "/v1/staging/management/activate" &&
      request.method === "GET"
    ) {
      return respond(handleManagementActivateGet(request, env));
    }
    if (
      pathname === "/v1/staging/management/session" &&
      request.method === "GET"
    ) {
      return respond(handleManagementSessionView(request, env));
    }
    if (
      pathname === "/v1/staging/management/delivery-email/request" &&
      request.method === "POST"
    ) {
      return respond(handleDeliveryEmailChangeRequest(request, env));
    }
    if (
      pathname === "/v1/staging/management/delivery-email/confirm" &&
      request.method === "POST"
    ) {
      return respond(handleDeliveryEmailConfirmPost(request, env));
    }
    if (
      pathname === "/v1/staging/management/delivery-email/confirm" &&
      request.method === "GET"
    ) {
      return respond(handleDeliveryEmailConfirmGet(request, env));
    }
    if (
      pathname === "/v1/staging/management/test/mint-token" &&
      request.method === "POST"
    ) {
      return handleManagementTestMintToken(request, env);
    }
    if (
      pathname === "/v1/staging/management/test/mint-delivery-verify" &&
      request.method === "POST"
    ) {
      return handleManagementTestMintDeliveryVerify(request, env);
    }
    const mgmtTokenStorageMatch = pathname.match(
      /^\/v1\/staging\/management\/test\/token-storage\/([0-9a-f-]{36})$/,
    );
    if (mgmtTokenStorageMatch && request.method === "GET") {
      return handleManagementTestTokenStorage(
        request,
        env,
        mgmtTokenStorageMatch[1],
      );
    }
    const mgmtAuditMatch = pathname.match(
      /^\/v1\/staging\/management\/test\/audit\/([0-9a-f-]{36})$/,
    );
    if (mgmtAuditMatch && request.method === "GET") {
      return handleManagementTestAudit(request, env, mgmtAuditMatch[1]);
    }
    const mgmtNoBodyMatch = pathname.match(
      /^\/v1\/staging\/management\/test\/no-body\/([0-9a-f-]{36})$/,
    );
    if (mgmtNoBodyMatch && request.method === "GET") {
      return handleManagementTestNoBodyAccess(
        request,
        env,
        mgmtNoBodyMatch[1],
      );
    }

    // Phase 7 — customer vault API (staging dummy data)
    if (pathname === "/v1/vault/enter" && request.method === "POST") {
      return respond(handleVaultEnter(request, env));
    }
    if (pathname === "/v1/vault/state" && request.method === "GET") {
      return respond(handleVaultState(request, env));
    }
    if (pathname === "/v1/vault/collection/init" && request.method === "POST") {
      return respond(handleVaultCollectionInit(request, env));
    }
    if (
      pathname === "/v1/vault/collection/milestone-options" &&
      request.method === "POST"
    ) {
      return respond(handleVaultCollectionMilestoneOptions(request, env));
    }
    if (
      pathname === "/v1/vault/collection/recurring-preview" &&
      request.method === "POST"
    ) {
      return respond(handleVaultCollectionRecurringPreview(request, env));
    }
    if (pathname === "/v1/vault/single/prepare" && request.method === "POST") {
      return respond(handleVaultSinglePrepare(request, env));
    }
    if (
      pathname === "/v1/vault/delivery-email" &&
      request.method === "POST"
    ) {
      return respond(handleVaultDeliveryEmailRequest(request, env));
    }
    if (pathname === "/v1/vault/unicode-test" && request.method === "POST") {
      return respond(handleVaultUnicodeTest(request, env));
    }
    const vaultSlotMatch = pathname.match(
      /^\/v1\/vault\/slots\/([0-9a-f-]{36})$/,
    );
    if (vaultSlotMatch && request.method === "PATCH") {
      return respond(handleVaultSlotUpdate(request, env, vaultSlotMatch[1]));
    }
    const vaultSealMatch = pathname.match(
      /^\/v1\/vault\/slots\/([0-9a-f-]{36})\/seal$/,
    );
    if (vaultSealMatch && request.method === "POST") {
      return respond(handleVaultSlotSeal(request, env, vaultSealMatch[1]));
    }

    return notFound();
  },

  async scheduled(
    _event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    if (env.VAULT_ENV?.toLowerCase() !== "staging") return;
    ctx.waitUntil(runDeliveryScheduler(env, "cron"));
  },
};

export default worker;
