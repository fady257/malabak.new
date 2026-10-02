import test from "node:test";
import assert from "node:assert/strict";
import { base64UrlDecode, base64UrlEncode, constantTimeEqual, hmacSha256Hex, sha256Hex } from "../../.test-dist/server/security/crypto.js";

test("base64url round-trips binary secrets without padding", () => {
  const value = Uint8Array.from([0, 1, 2, 127, 128, 254, 255]);
  assert.deepEqual(base64UrlDecode(base64UrlEncode(value)), value);
  assert.equal(base64UrlEncode(value).includes("="), false);
});

test("hashes and HMACs are deterministic and compare safely", async () => {
  assert.equal(await sha256Hex("test"), await sha256Hex("test"));
  assert.notEqual(await sha256Hex("test"), await sha256Hex("other"));
  assert.equal(await hmacSha256Hex("x".repeat(32), "booking"), await hmacSha256Hex("x".repeat(32), "booking"));
  assert.equal(constantTimeEqual("same", "same"), true);
  assert.equal(constantTimeEqual("same", "diff"), false);
});
