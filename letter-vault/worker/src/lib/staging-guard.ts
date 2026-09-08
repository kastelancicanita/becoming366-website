import type { Env } from "../env";
import { getVaultEnvironment } from "../env";

export function stagingOnlyResponse(env: Env): Response | null {
  if (getVaultEnvironment(env) === "staging") {
    return null;
  }
  return Response.json(
    {
      error: "forbidden",
      message: "This endpoint is available in staging only.",
    },
    { status: 403, headers: { "Cache-Control": "no-store" } },
  );
}

/** Phase 2: reject payloads that are not clearly dummy test data. */
export function assertDummyText(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("DUMMY:")) {
    return "dummy_text must start with DUMMY: (staging test data only)";
  }
  if (trimmed.length > 500) {
    return "dummy_text exceeds 500 characters";
  }
  return null;
}
