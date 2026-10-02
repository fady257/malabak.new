import test from "node:test";
import assert from "node:assert/strict";
import { d1BlobToBytes, MAX_STORED_IMAGE_BYTES } from "../../.test-dist/server/storage/d1-image.js";

test("converts supported D1 BLOB views to an isolated byte copy", () => {
  const source = new Uint8Array([9, 1, 2, 8]);
  const view = source.subarray(1, 3);
  const result = d1BlobToBytes(view);
  assert.deepEqual([...result], [1, 2]);
  source[1] = 99;
  assert.deepEqual([...result], [1, 2]);
});

test("accepts ArrayBuffer BLOBs and rejects missing, empty, and oversized values", () => {
  assert.deepEqual([...d1BlobToBytes(new Uint8Array([1, 2]).buffer)], [1, 2]);
  assert.equal(d1BlobToBytes(null), null);
  assert.equal(d1BlobToBytes(new ArrayBuffer(0)), null);
  assert.equal(d1BlobToBytes(new Uint8Array(MAX_STORED_IMAGE_BYTES + 1)), null);
});
