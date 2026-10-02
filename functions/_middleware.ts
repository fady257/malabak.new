import { rotateAnonymousCsrf, cookiesFromHeader } from "../src/server/auth/session.js";
import type { AppEnv } from "../src/server/env.js";

interface PagesEvent<E> {
  request: Request;
  env: E;
  next(): Promise<Response>;
}

function securityHeaders(headers: Headers): void {
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("X-Permitted-Cross-Domain-Policies", "none");
  headers.set("Content-Security-Policy", [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors https://*.manus.computer https://manus.im https://*.manus.im",
  ].join("; "));
}

export const onRequest = async ({ request, env, next }: PagesEvent<AppEnv>): Promise<Response> => {
  const response = await next();
  const headers = new Headers(response.headers);
  securityHeaders(headers);

  const url = new URL(request.url);
  const acceptsHtml = request.headers.get("Accept")?.toLowerCase().includes("text/html") ?? false;
  const isHtml = request.method === "GET" && acceptsHtml && !url.pathname.startsWith("/api/");
  if (isHtml && response.status === 200 && !cookiesFromHeader(request.headers.get("Cookie")).has("malak_csrf")) {
    await rotateAnonymousCsrf(headers, env);
  }
  if (url.pathname.startsWith("/api/")) headers.set("Cache-Control", "private, no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};
