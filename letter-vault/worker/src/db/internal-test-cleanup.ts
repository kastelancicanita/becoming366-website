import type { Env } from "../env";
import {
  INTERNAL_TEST_SOURCE,
  isInternalTestOrderRef,
} from "../lib/internal-test-entitlement";
import { createServiceSupabaseClient } from "./service-client";

function client(env: Env) {
  return createServiceSupabaseClient(env);
}

function throwIfError(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

function uniqueIds(ids: Array<string | null | undefined>): string[] {
  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}

export interface InternalTestEntitlementRow {
  id: string;
  source: string;
  external_order_ref: string;
  purchaser_email: string;
  status: string;
}

export async function fetchInternalTestEntitlement(
  env: Env,
  id: string,
): Promise<InternalTestEntitlementRow | null> {
  const { data, error } = await client(env)
    .from("letter_vault_entitlements")
    .select("id, source, external_order_ref, purchaser_email, status")
    .eq("id", id)
    .maybeSingle();

  throwIfError(error);
  return (data as InternalTestEntitlementRow | null) ?? null;
}

export async function fetchInternalTestEntitlementByRef(
  env: Env,
  externalOrderRef: string,
): Promise<InternalTestEntitlementRow | null> {
  const { data, error } = await client(env)
    .from("letter_vault_entitlements")
    .select("id, source, external_order_ref, purchaser_email, status")
    .eq("external_order_ref", externalOrderRef)
    .maybeSingle();

  throwIfError(error);
  return (data as InternalTestEntitlementRow | null) ?? null;
}

export function assertRevocableInternalTest(row: InternalTestEntitlementRow): void {
  if (row.source?.trim().toLowerCase() !== INTERNAL_TEST_SOURCE) {
    throw new Error("not_internal_test_entitlement");
  }
  if (!isInternalTestOrderRef(row.external_order_ref)) {
    throw new Error("not_internal_test_entitlement");
  }
}

async function deleteEmailArtifactsForEntitlement(
  db: ReturnType<typeof createServiceSupabaseClient>,
  entitlementId: string,
  letterIds: string[],
): Promise<void> {
  const outboundIds = new Set<string>();

  const { data: byEntitlement, error: byEntitlementErr } = await db
    .from("letter_vault_email_outbound")
    .select("id")
    .eq("entitlement_ref", entitlementId);
  throwIfError(byEntitlementErr);
  for (const row of byEntitlement ?? []) {
    outboundIds.add((row as { id: string }).id);
  }

  if (letterIds.length > 0) {
    const { data: byLetter, error: byLetterErr } = await db
      .from("letter_vault_email_outbound")
      .select("id")
      .in("letter_ref", letterIds);
    throwIfError(byLetterErr);
    for (const row of byLetter ?? []) {
      outboundIds.add((row as { id: string }).id);
    }
  }

  const outboundIdList = [...outboundIds];
  if (outboundIdList.length > 0) {
    throwIfError(
      (
        await db
          .from("letter_vault_email_webhook_events")
          .delete()
          .in("outbound_email_id", outboundIdList)
      ).error,
    );
    throwIfError(
      (await db.from("letter_vault_email_outbound").delete().in("id", outboundIdList)).error,
    );
  }
}

export async function deleteInternalTestEntitlement(
  env: Env,
  entitlementId: string,
): Promise<{ entitlement_id: string; letters_deleted: number }> {
  const db = client(env);

  const { data: letters, error: lettersErr } = await db
    .from("letter_vault_letters")
    .select("id")
    .eq("entitlement_ref", entitlementId);
  throwIfError(lettersErr);

  const { data: slots, error: slotsErr } = await db
    .from("letter_vault_letter_slots")
    .select("letter_id")
    .eq("entitlement_id", entitlementId);
  throwIfError(slotsErr);

  const letterIds = uniqueIds([
    ...(letters ?? []).map((row: { id: string }) => row.id),
    ...(slots ?? []).map((row: { letter_id: string | null }) => row.letter_id),
  ]);

  throwIfError(
    (
      await db
        .from("letter_vault_letter_slots")
        .update({ letter_id: null })
        .eq("entitlement_id", entitlementId)
    ).error,
  );

  if (letterIds.length > 0) {
    throwIfError(
      (
        await db
          .from("letter_vault_letters")
          .update({ slot_id: null })
          .in("id", letterIds)
      ).error,
    );
  }

  await deleteEmailArtifactsForEntitlement(db, entitlementId, letterIds);

  if (letterIds.length > 0) {
    throwIfError(
      (await db.from("letter_vault_delivery_attempts").delete().in("letter_id", letterIds))
        .error,
    );
    throwIfError(
      (await db.from("letter_vault_management_tokens").delete().in("letter_id", letterIds))
        .error,
    );
    throwIfError(
      (await db.from("letter_vault_management_sessions").delete().in("letter_id", letterIds))
        .error,
    );
    throwIfError(
      (
        await db
          .from("letter_vault_delivery_email_changes")
          .delete()
          .in("letter_id", letterIds)
      ).error,
    );
    throwIfError(
      (await db.from("letter_vault_delivery_email_audit").delete().in("letter_id", letterIds))
        .error,
    );
    throwIfError(
      (await db.from("letter_vault_letters").delete().in("id", letterIds)).error,
    );
  }

  throwIfError(
    (await db.from("letter_vault_letter_slots").delete().eq("entitlement_id", entitlementId))
      .error,
  );
  throwIfError(
    (await db.from("letter_vault_collections").delete().eq("entitlement_id", entitlementId)).error,
  );
  throwIfError(
    (await db.from("letter_vault_vault_sessions").delete().eq("entitlement_id", entitlementId))
      .error,
  );

  throwIfError(
    (await db.from("letter_vault_entitlements").delete().eq("id", entitlementId)).error,
  );

  return { entitlement_id: entitlementId, letters_deleted: letterIds.length };
}
