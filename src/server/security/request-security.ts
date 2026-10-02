import { TRPCError } from "@trpc/server";
import { sha256Hex, constantTimeEqual } from "./crypto.js";
import type { AppEnv, RequestContext } from "../env.js";

function configuredOrigins(env: AppEnv): Set<string> {
  const origins = new Set<string>();
  for (const entry of (env.APP_ORIGINS ?? "").split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    try {
      const url = new URL(trimmed);
      if (url.origin === trimmed.replace(/\/$/, "")) origins.add(url.origin);
    } catch {
      throw new Error("APP_ORIGINS contains an invalid origin.");
    }
  }
  return origins;
}

export function assertSameOrigin(request: Request, env: AppEnv): void {
  const origin = request.headers.get("Origin");
  if (!origin) throw new TRPCError({ code: "FORBIDDEN", message: "تعذر التحقق من مصدر الطلب." });

  let normalizedOrigin: string;
  try {
    const parsed = new URL(origin);
    if (parsed.origin !== origin) throw new Error("non-canonical");
    normalizedOrigin = parsed.origin;
  } catch {
    throw new TRPCError({ code: "FORBIDDEN", message: "مصدر الطلب غير مسموح." });
  }

  const allowed = configuredOrigins(env);
  if (allowed.size > 0 && allowed.has(normalizedOrigin)) return;

  const requestUrl = new URL(request.url);
  // The Preview proxy can forward a public HTTPS same-origin request to an internal HTTP host.
  // Sec-Fetch-Site is browser-controlled; writes still require the independent double-submit CSRF token below.
  if (request.headers.get("Sec-Fetch-Site") === "same-origin" && normalizedOrigin.startsWith("https://")) return;
  const isLocal = ["localhost", "127.0.0.1", "::1"].includes(requestUrl.hostname);
  if (isLocal && requestUrl.origin === normalizedOrigin) return;
  throw new TRPCError({ code: "FORBIDDEN", message: "مصدر الطلب غير مسموح. اضبط APP_ORIGINS لهذا النطاق." });
}

export async function assertCsrf(context: RequestContext): Promise<void> {
  assertSameOrigin(context.request, context.env);
  const header = context.request.headers.get("X-CSRF-Token");
  if (!header || !context.rawCsrfCookie || !constantTimeEqual(header, context.rawCsrfCookie)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "انتهت صلاحية الحماية. حدّث الصفحة وحاول مرة أخرى." });
  }
  if (context.member) {
    const submittedHash = await sha256Hex(header);
    if (!constantTimeEqual(submittedHash, context.member.csrfTokenHash)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "رمز حماية الجلسة غير صالح." });
    }
  }
}

export function assertConfiguredSecret(value: string | undefined, variable: string): string {
  if (!value || value.length < 32) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: `إعداد الخادم ناقص: ${variable}. راجع ملف README.` });
  }
  return value;
}
