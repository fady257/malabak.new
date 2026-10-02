import test from "node:test";
import assert from "node:assert/strict";
import { validatePreparedPitchPhoto } from "../../.test-dist/server/storage/validate-webp.js";
import { inspectSanitizedWebp } from "../../.test-dist/server/storage/image-validation.js";

const onePixelWebp = Uint8Array.from(Buffer.from(
  "UklGRjAAAABXRUJQVlA4ICQAAABQAQCdASoBAAEAAUAmJQBOgC6gAP77LkvF3YjjJ4dVU9ffoAA=",
  "base64",
));

test("validates a small browser-reencoded WebP for D1 storage", () => {
  const result = validatePreparedPitchPhoto(onePixelWebp);
  assert.equal(result.mime, "image/webp");
  assert.ok(result.width > 0);
  assert.ok(result.height > 0);
  assert.deepEqual(inspectSanitizedWebp(result.bytes), { mime: "image/webp", width: result.width, height: result.height });
});

test("refuses malformed or non-WebP input before database storage", () => {
  assert.throws(() => validatePreparedPitchPhoto(onePixelWebp.subarray(0, 20)), /WebP|صورة|malformed/i);
  assert.throws(() => validatePreparedPitchPhoto(new Uint8Array(80)), /WebP|صورة|Only/i);
});

test("rejects EXIF metadata chunks even when the WebP image frame itself is valid", () => {
  const withExif = new Uint8Array(onePixelWebp.length + 10);
  withExif.set(onePixelWebp);
  const view = new DataView(withExif.buffer);
  view.setUint32(4, withExif.length - 8, true);
  withExif.set([69, 88, 73, 70], onePixelWebp.length); // EXIF
  view.setUint32(onePixelWebp.length + 4, 2, true);
  withExif.set([1, 2], onePixelWebp.length + 8);
  assert.throws(() => validatePreparedPitchPhoto(withExif), /metadata|EXIF|مقاطع WebP/i);
});
