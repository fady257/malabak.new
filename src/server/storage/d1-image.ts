import { MAX_STORED_IMAGE_BYTES } from "./upload-policy.js";

export { MAX_STORED_IMAGE_BYTES };

/**
 * D1 drivers may expose a SQLite BLOB as an ArrayBuffer or any ArrayBufferView.
 * Always return a copy so the response does not retain a shared WASM buffer.
 */
export function d1BlobToBytes(value: unknown): Uint8Array | null {
  if (value instanceof ArrayBuffer) {
    if (value.byteLength < 1 || value.byteLength > MAX_STORED_IMAGE_BYTES) return null;
    return new Uint8Array(value.slice(0));
  }
  if (ArrayBuffer.isView(value)) {
    if (value.byteLength < 1 || value.byteLength > MAX_STORED_IMAGE_BYTES) return null;
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
  }
  return null;
}
