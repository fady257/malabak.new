import type { AppEnv } from "../../../src/server/env.js";
import { getAuthenticatedMember } from "../../../src/server/auth/session.js";
import { d1BlobToBytes } from "../../../src/server/storage/d1-image.js";

interface PagesMediaContext {
  request: Request;
  env: AppEnv;
  params: { id?: string };
}

function notFound(): Response {
  return new Response("غير موجود", { status: 404, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}

export const onRequest = async ({ request, env, params }: PagesMediaContext): Promise<Response> => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("الطريقة غير مسموحة", { status: 405, headers: { Allow: "GET, HEAD", "Cache-Control": "no-store" } });
  }
  const assetId = params.id ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(assetId)) return notFound();

  const asset = await env.DB.prepare(`
    SELECT m.id,m.venue_id,m.pitch_id,m.detected_content_type,m.image_bytes,m.byte_size,m.etag,
           v.public_booking_enabled,p.active AS pitch_active
    FROM media_assets m
    JOIN venues v ON v.id = m.venue_id
    JOIN pitches p ON p.id = m.pitch_id AND p.venue_id = m.venue_id
    WHERE m.id = ? AND m.state = 'active' LIMIT 1
  `).bind(assetId).first<{
    id: string;
    venue_id: string;
    pitch_id: string;
    detected_content_type: "image/webp";
    image_bytes: ArrayBuffer | ArrayBufferView | null;
    byte_size: number;
    etag: string;
    public_booking_enabled: number;
    pitch_active: number;
  }>();
  if (!asset) return notFound();

  const publicImage = asset.public_booking_enabled === 1 && asset.pitch_active === 1;
  let privateAuthorized = false;
  if (!publicImage) {
    const { member } = await getAuthenticatedMember(env.DB, request, env);
    privateAuthorized = Boolean(member && member.role === "owner" && member.venueId === asset.venue_id);
  }
  if (!publicImage && !privateAuthorized) return notFound();

  const etag = `"${asset.etag}"`;
  const cacheControl = publicImage ? "public, max-age=3600, immutable" : "private, no-store";
  if (publicImage && request.headers.get("If-None-Match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": cacheControl, "X-Content-Type-Options": "nosniff" } });
  }

  const bytes = d1BlobToBytes(asset.image_bytes);
  if (!bytes || bytes.byteLength !== asset.byte_size || asset.detected_content_type !== "image/webp") return notFound();
  const headers = new Headers({
    "Content-Type": "image/webp",
    "Content-Length": String(bytes.byteLength),
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cross-Origin-Resource-Policy": "same-site",
    ETag: etag,
    "Cache-Control": cacheControl,
  });
  const body = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(body).set(bytes);
  return new Response(request.method === "HEAD" ? null : body, { headers });
};
