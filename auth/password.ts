import { base64UrlDecode, base64UrlEncode, constantTimeEqual, randomBytes, toArrayBuffer } from "../security/crypto.js";
import { requireSecret } from "../env.js";

const HASH_NAME = "pbkdf2-sha256";
// Workers WebCrypto rejects PBKDF2 iteration counts above 100,000.
export const PASSWORD_HASH_ITERATIONS = 100_000;
const DERIVED_BYTES = 32;
const encoder = new TextEncoder();

export function validatePassword(password: string): void {
  const codePoints = [...password];
  if (codePoints.length < 14 || codePoints.length > 128) {
    throw new RangeError("Password must be between 14 and 128 characters.");
  }
  if (password.trim().length < 12 || /[\u0000-\u001f\u007f]/.test(password)) {
    throw new RangeError("Password must contain at least 12 non-space characters.");
  }
}

async function derive(password: string, salt: Uint8Array, pepper: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(encoder.encode(`${password}\u0000${requireSecret(pepper, "AUTH_PEPPER")}`)),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: toArrayBuffer(salt), iterations: PASSWORD_HASH_ITERATIONS },
    key,
    DERIVED_BYTES * 8,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string, pepper: string): Promise<string> {
  validatePassword(password);
  const salt = randomBytes(16);
  const derived = await derive(password, salt, pepper);
  return `${HASH_NAME}$${PASSWORD_HASH_ITERATIONS}$${base64UrlEncode(salt)}$${base64UrlEncode(derived)}`;
}

export async function verifyPassword(password: string, encoded: string, pepper: string): Promise<boolean> {
  const [algorithm, iterationsText, saltText, expectedText, extra] = encoded.split("$");
  if (algorithm !== HASH_NAME || iterationsText !== String(PASSWORD_HASH_ITERATIONS) || !saltText || !expectedText || extra !== undefined) {
    return false;
  }
  try {
    const expected = base64UrlDecode(expectedText);
    const actual = await derive(password, base64UrlDecode(saltText), pepper);
    return expected.byteLength === DERIVED_BYTES && constantTimeEqual(base64UrlEncode(actual), base64UrlEncode(expected));
  } catch {
    return false;
  }
}
