/** Generic responses — avoid revealing whether code, email, or entitlement exists. */

export const ACCESS_DENIED_BODY = {
  status: "error",
  error: "access_denied",
  message: "Unable to verify access.",
} as const;

export const RATE_LIMITED_BODY = {
  status: "error",
  error: "rate_limited",
  message: "Too many attempts. Try again later.",
} as const;

export function accessDeniedResponse(): Response {
  return Response.json(ACCESS_DENIED_BODY, {
    status: 401,
    headers: { "Cache-Control": "no-store" },
  });
}

export function rateLimitedResponse(): Response {
  return Response.json(RATE_LIMITED_BODY, {
    status: 429,
    headers: { "Cache-Control": "no-store" },
  });
}

export function jsonResponse(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
