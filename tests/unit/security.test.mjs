import test from "node:test";
import assert from "node:assert/strict";
import { normalizeEgyptianPhone, normalizeBookingCode, encryptPhone, decryptPhone } from "../../.test-dist/server/security/crypto.js";
import { hashPassword, verifyPassword, validatePassword } from "../../.test-dist/server/auth/password.js";

const pepper = "test-only-strong-pepper-value-with-32-chars";
const aesKey = Buffer.alloc(32, 7).toString("base64");
const env = { BOOKING_ENCRYPTION_KEY: aesKey };

test("normalizes Egyptian phone inputs including Arabic numerals", () => {
  assert.equal(normalizeEgyptianPhone("010 1234 5678"), "+201012345678");
  assert.equal(normalizeEgyptianPhone("+20 101 234 5678"), "+201012345678");
  assert.equal(normalizeEgyptianPhone("٠١٠١٢٣٤٥٦٧٨"), "+201012345678");
  assert.throws(() => normalizeEgyptianPhone("123"), /valid Egyptian mobile/);
});

test("validates high-entropy booking codes with an ambiguity-free alphabet", () => {
  assert.equal(normalizeBookingCode("ABCD-EFGH-JKLM-NPQR"), "ABCDEFGHJKLMNPQR");
  assert.throws(() => normalizeBookingCode("OOOO-1111-AAAA-BBBB"), /invalid/);
});

test("encrypts phone values with AES-GCM and decrypts without storing plaintext", async () => {
  const encrypted = await encryptPhone(env, "+201012345678");
  assert.match(encrypted, /^v1\./);
  assert.notEqual(encrypted, "+201012345678");
  assert.equal(await decryptPhone(env, encrypted), "+201012345678");
  await assert.rejects(() => decryptPhone({ BOOKING_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString("base64") }, encrypted));
});

test("password hashes are salted and verified without revealing the cleartext", async () => {
  validatePassword("this is a strong sample passphrase");
  const first = await hashPassword("this is a strong sample passphrase", pepper);
  const second = await hashPassword("this is a strong sample passphrase", pepper);
  assert.notEqual(first, second);
  assert.equal(await verifyPassword("this is a strong sample passphrase", first, pepper), true);
  assert.equal(await verifyPassword("this is another wrong passphrase", first, pepper), false);
  assert.throws(() => validatePassword("weakpass"), /14 and 128/);
});
