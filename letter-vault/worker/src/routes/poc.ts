import { encryptPayload, verifyEnvelope } from "../crypto/envelope";
import { fetchPocRecord, insertPocRecord } from "../db/poc-store";
import type { Env } from "../env";
import { assertDummyText, stagingOnlyResponse } from "../lib/staging-guard";

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function requireMasterKey(env: Env): string | Response {
  const key = env.LETTER_VAULT_MASTER_KEY_V1;
  if (!key) {
    return json(
      {
        error: "master_key_not_configured",
        message: "LETTER_VAULT_MASTER_KEY_V1 secret is not set.",
      },
      503,
    );
  }
  return key;
}

/** In-memory roundtrip — no database. Staging only. */
export async function handlePocRoundtrip(
  request: Request,
  env: Env,
): Promise<Response> {
  const blocked = stagingOnlyResponse(env);
  if (blocked) return blocked;

  const masterKey = requireMasterKey(env);
  if (masterKey instanceof Response) return masterKey;

  let body: { dummy_text?: string };
  try {
    body = (await request.json()) as { dummy_text?: string };
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const dummyText = body.dummy_text ?? "";
  const validationError = assertDummyText(dummyText);
  if (validationError) {
    return json({ error: "validation_failed", message: validationError }, 400);
  }

  try {
    const envelope = await encryptPayload(masterKey, dummyText);
    const decryptOk = await verifyEnvelope(masterKey, envelope);
    return json({
      status: "ok",
      phase: "phase2",
      test: "roundtrip",
      decrypt_ok: decryptOk,
      master_key_version: envelope.master_key_version,
      ciphertext_length: envelope.ciphertext_b64.length,
      plaintext_in_response: false,
    });
  } catch {
    return json({ error: "crypto_roundtrip_failed" }, 500);
  }
}

/** Encrypt dummy text and store ciphertext in DB. Staging only. */
export async function handlePocSeal(
  request: Request,
  env: Env,
): Promise<Response> {
  const blocked = stagingOnlyResponse(env);
  if (blocked) return blocked;

  const masterKey = requireMasterKey(env);
  if (masterKey instanceof Response) return masterKey;

  let body: { label?: string; dummy_text?: string };
  try {
    body = (await request.json()) as { label?: string; dummy_text?: string };
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const dummyText = body.dummy_text ?? "";
  const validationError = assertDummyText(dummyText);
  if (validationError) {
    return json({ error: "validation_failed", message: validationError }, 400);
  }

  const label = (body.label ?? "phase2-dummy").slice(0, 64);

  try {
    const envelope = await encryptPayload(masterKey, dummyText);
    const record = await insertPocRecord(env, label, envelope);

    return json({
      status: "ok",
      phase: "phase2",
      test: "seal",
      id: record.id,
      label: record.label,
      master_key_version: record.master_key_version,
      content_hash: record.content_hash,
      plaintext_in_response: false,
      plaintext_in_db: false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "seal_failed";
    if (message.includes("letter_vault_crypto_poc")) {
      return json(
        {
          error: "poc_table_missing",
          message: "Run migration 002_phase2_crypto_poc.sql in Supabase.",
        },
        503,
      );
    }
    return json({ error: "seal_failed", message }, 500);
  }
}

/** Decrypt-verify stored record. Never returns plaintext. Staging only. */
export async function handlePocVerify(
  env: Env,
  id: string,
): Promise<Response> {
  const blocked = stagingOnlyResponse(env);
  if (blocked) return blocked;

  const masterKey = requireMasterKey(env);
  if (masterKey instanceof Response) return masterKey;

  try {
    const record = await fetchPocRecord(env, id);
    if (!record) {
      return json({ error: "not_found" }, 404);
    }

    const decryptOk = await verifyEnvelope(masterKey, record);

    return json({
      status: "ok",
      phase: "phase2",
      test: "verify",
      id: record.id,
      label: record.label,
      decrypt_ok: decryptOk,
      master_key_version: record.master_key_version,
      plaintext_in_response: false,
    });
  } catch {
    return json({ error: "verify_failed" }, 500);
  }
}
