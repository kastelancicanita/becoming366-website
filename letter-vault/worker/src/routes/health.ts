import { checkDatabaseConnectivity } from "../db/supabase";
import type { Env } from "../env";
import { getVaultEnvironment } from "../env";
import {
  checkSurpriseDeliverySchema,
  type SurpriseSchemaStatus,
} from "../lib/surprise-schema";

export interface HealthResponse {
  status: "ok";
  service: "letter-vault-api";
  environment: string;
  database: "connected" | "not_configured" | "error";
  schema_version?: string;
  database_error?: string;
  surprise_delivery_schema?: SurpriseSchemaStatus;
}

export async function handleHealth(env: Env): Promise<Response> {
  const db = await checkDatabaseConnectivity(env);

  const body: HealthResponse = {
    status: "ok",
    service: "letter-vault-api",
    environment: getVaultEnvironment(env),
    database:
      db.state === "connected"
        ? "connected"
        : db.state === "not_configured"
          ? "not_configured"
          : "error",
  };

  if (db.state === "connected") {
    body.schema_version = db.schema_version;
    if (getVaultEnvironment(env) === "staging") {
      try {
        body.surprise_delivery_schema = await checkSurpriseDeliverySchema(env);
      } catch {
        /* optional diagnostic */
      }
    }
  }

  if (db.state === "error") {
    body.database_error = db.message;
  }

  return Response.json(body, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
    },
  });
}
