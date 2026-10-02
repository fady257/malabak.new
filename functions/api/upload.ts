import type { AppEnv } from "../../src/server/env.js";
import { assertCsrf, assertSameOrigin } from "../../src/server/security/request-security.js";
import { getAuthenticatedMember } from "../../src/server/auth/session.js";
import { enforceRateLimit } from "../../src/server/security/rate-limit.js";
import { validatePreparedPitchPhoto } from "../../src/server/storage/validate-webp.js";
import { MAX_STORED_IMAGE_BYTES } from "../../src/server/storage/d1-image.js";
import { auditEventStatement } from "../../src/server/db/audit.js";

const MAX_REQUEST_BYTES = MAX_STORED_IMAGE_BYTES;

interface PagesUploadContext { request: Request; env: AppEnv }

class UploadTooLargeError extends RangeError {}

function json(body: unknown, status: number, headers = new Headers()): Response {
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(JSON.stringify(body), { status, headers });
}

async function readBoundedImage(request: Request): Promise<Uint8Array> {
  const contentLength = request.headers.get("Content-Length");
  const declared = contentLength === null ? null : Number(contentLength);
  if (declared !== null && (!Number.isSafeInteger(declared) || declared < 1 || declared > MAX_REQUEST_BYTES)) {
    throw new UploadTooLargeError("الصورة لازم تكون أقل من 1.5 ميجابايت بعد تجهيزها.");
  }
  if (!request.body) throw new RangeError("لم يصل ملف صورة.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_REQUEST_BYTES) {
        await reader.cancel("image exceeds D1 BLOB limit");
        throw new UploadTooLargeError("الصورة لازم تكون أقل من 1.5 ميجابايت بعد تجهيزها.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total < 1) throw new RangeError("ملف الصورة فارغ.");
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export const onRequest = async ({ request, env }: PagesUploadContext): Promise<Response> => {
  if (request.method !== "POST") return json({ error: "الطريقة غير مسموحة." }, 405, new Headers({ Allow: "POST" }));
  try {
    assertSameOrigin(request, env);
    const cookies = await getAuthenticatedMember(env.DB, request, env);
    const member = cookies.member;
    if (!member) return json({ error: "سجّل الدخول بمالك المكان لرفع صورة." }, 401);
    if (member.role !== "owner") return json({ error: "رفع صور المكان متاح للمالك فقط." }, 403);

    const context = { env, request, responseHeaders: new Headers(), ...cookies };
    await assertCsrf(context);
    await enforceRateLimit(env.DB, env, request, { scope: "owner-pitch-photo-upload", limit: 15, windowMs: 60 * 60_000, blockMs: 60 * 60_000 });

    const contentType = (request.headers.get("Content-Type") ?? "").split(";", 1)[0]?.trim().toLowerCase();
    if (contentType !== "image/webp") return json({ error: "جهّز الصورة كـWebP من صفحة إعدادات الملعب." }, 415);
    const pitchId = request.headers.get("X-Pitch-Id")?.trim() ?? "";
    if (pitchId.length < 1 || pitchId.length > 64) return json({ error: "معرّف الملعب غير صالح." }, 400);

    // Prove ownership before reading/validating the (already compact) WebP.
    const pitch = await env.DB.prepare("SELECT id FROM pitches WHERE id = ? AND venue_id = ? AND active = 1 LIMIT 1")
      .bind(pitchId, member.venueId).first<{ id: string }>();
    if (!pitch) return json({ error: "الملعب المحدد غير موجود أو غير نشط." }, 404);

    const verified = validatePreparedPitchPhoto(await readBoundedImage(request));
    const assetId = crypto.randomUUID();
    const now = Date.now();

    // D1 batch is atomic: the previous image is removed only when the new verified image and audit row are saved.
    await env.DB.batch([
      env.DB.prepare("DELETE FROM media_assets WHERE pitch_id = ? AND venue_id = ?")
        .bind(pitchId, member.venueId),
      env.DB.prepare(`
        INSERT INTO media_assets
          (id,venue_id,pitch_id,detected_content_type,image_bytes,byte_size,width,height,etag,state,uploaded_by_user_id,created_at_ms)
        VALUES (?,?,?, 'image/webp', ?, ?, ?, ?, ?, 'active', ?, ?)
      `).bind(assetId, member.venueId, pitchId, verified.bytes, verified.bytes.byteLength, verified.width, verified.height, assetId, member.userId, now),
      auditEventStatement(env.DB, { venueId: member.venueId, actorUserId: member.userId, entityType: "media", entityId: assetId, action: "pitch_photo_replaced", createdAtMs: now }),
    ]);

    return json({ ok: true, assetId, url: `/api/media/${encodeURIComponent(assetId)}`, width: verified.width, height: verified.height }, 201);
  } catch (error) {
    if (error instanceof UploadTooLargeError) return json({ error: error.message }, 413);
    if (error instanceof RangeError) return json({ error: error.message }, 400);
    if (error instanceof Error && error.message.includes("rate limit")) return json({ error: "طلبات كثيرة خلال وقت قصير. حاول بعد قليل." }, 429);
    return json({ error: "تعذر التحقق من الصورة أو حفظها. لم نعلن نجاحًا؛ حاول مرة أخرى." }, 500);
  }
};
