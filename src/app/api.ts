import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "../server/trpc/router.js";

export function readCookie(name: string): string | null {
  const prefix = `${name}=`;
  const item = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix));
  return item ? decodeURIComponent(item.slice(prefix.length)) : null;
}

export const api = createTRPCProxyClient<AppRouter>({
  links: [httpBatchLink({
    url: "/api/trpc",
    headers() {
      const csrf = readCookie("malak_csrf");
      return csrf ? { "x-csrf-token": csrf } : {};
    },
  })],
});

export async function uploadImage(form: FormData): Promise<{ assetId: string; url?: string; width: number; height: number }> {
  const pitchId = form.get("pitchId");
  const file = form.get("file");
  if (typeof pitchId !== "string" || !pitchId || !(file instanceof File) || file.type !== "image/webp") {
    throw new Error("جهّز صورة الملعب بصيغة WebP قبل الرفع.");
  }
  const headers = new Headers();
  const csrf = readCookie("malak_csrf");
  if (csrf) headers.set("x-csrf-token", csrf);
  headers.set("content-type", "image/webp");
  headers.set("x-pitch-id", pitchId);
  const response = await fetch("/api/upload", { method: "POST", credentials: "include", headers, body: file });
  const result = await response.json() as { ok?: boolean; error?: string; assetId?: string; url?: string; width?: number; height?: number };
  if (!response.ok || !result.ok || !result.assetId || !result.width || !result.height) {
    throw new Error(result.error ?? "تعذر رفع الصورة. حاول مرة أخرى.");
  }
  return { assetId: result.assetId, ...(result.url ? { url: result.url } : {}), width: result.width, height: result.height };
}
