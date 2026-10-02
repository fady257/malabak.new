import test from "node:test";
import assert from "node:assert/strict";
import { inspectRasterImage } from "../../.test-dist/server/storage/image-validation.js";

const onePixelPng = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4r8QAAANFASJPqXK/AAAAAElFTkSuQmCC",
  "base64",
));

test("accepts a small PNG by its binary structure, not its filename", () => {
  assert.deepEqual(inspectRasterImage(onePixelPng), { mime: "image/png", width: 1, height: 1 });
});

test("rejects SVG and other active/document formats", () => {
  assert.throws(() => inspectRasterImage(new TextEncoder().encode("<svg onload=alert(1)></svg>")), /Only valid JPEG/);
});

test("rejects truncated raster files", () => {
  assert.throws(() => inspectRasterImage(onePixelPng.subarray(0, 38)), /incomplete|malformed|header/i);
});

test("rejects PNG chunks whose CRC does not match their content", () => {
  const corrupt = new Uint8Array(onePixelPng);
  corrupt[41] ^= 0xff;
  assert.throws(() => inspectRasterImage(corrupt), /CRC/i);
});

test("rejects declared dimensions above the memory-safe pixel budget before decode", () => {
  const bomb = new Uint8Array(45);
  bomb.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  bomb.set([0, 0, 0, 13, 73, 72, 68, 82], 8);
  bomb.set([0x00, 0x00, 0x40, 0x00], 16);
  bomb.set([0x00, 0x00, 0x40, 0x00], 20);
  bomb.set([8, 6, 0, 0, 0], 24);
  assert.throws(() => inspectRasterImage(bomb), /dimensions exceed/i);
});
