/** Generic management responses — prevent Letter ID / email enumeration. */

export const MANAGEMENT_REQUEST_OK = {
  status: "ok",
  message:
    "If a matching letter exists, management instructions have been sent to the purchaser email on file.",
} as const;

export function managementRequestResponse(): Response {
  return Response.json(MANAGEMENT_REQUEST_OK, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}

export function managementDeniedResponse(): Response {
  return Response.json(
    { status: "error", error: "access_denied", message: "Unable to continue." },
    { status: 401, headers: { "Cache-Control": "no-store" } },
  );
}

export function jsonResponse(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
