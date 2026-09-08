const ALLOWED_ORIGINS = [
  "https://becoming366.com",
  "https://www.becoming366.com",
  "http://localhost:8787",
  "http://127.0.0.1:8787",
  "null",
];

export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin") ?? "";
  const allowed =
    ALLOWED_ORIGINS.includes(origin) ||
    origin.endsWith(".pages.dev") ||
    origin.includes("becoming366");

  return {
    "Access-Control-Allow-Origin": allowed ? origin || "*" : "https://becoming366.com",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, X-Letter-Vault-Session, X-Letter-Vault-Management-Session",
    "Access-Control-Max-Age": "86400",
  };
}

export function withCors(response: Response, request: Request): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(corsHeaders(request))) {
    headers.set(k, v);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function handleCorsPreflight(request: Request): Response | null {
  if (request.method !== "OPTIONS") return null;
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}
