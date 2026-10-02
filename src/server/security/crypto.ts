import { requireSecret, type AppEnv } from "../env.js";

const encoder = new TextEncoder();

export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export function randomBytes(length: number): Uint8Array {
  if (!Number.isInteger(length) || length < 1 || length > 65_536) {
    throw new RangeError("Random byte count is outside the supported range.");
  }
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
  }
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export function base64UrlDecode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_+/-]*={0,2}$/.test(value) || value.length > 16_384) {
    throw new RangeError("Invalid base64 value.");
  }
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/g, "");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const raw = atob(padded);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

export async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const input = typeof value === "string" ? encoder.encode(value) : value;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", toArrayBuffer(input)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hmacSha256Hex(secretValue: string, value: string): Promise<string> {
  const secret = requireSecret(secretValue, "HMAC secret");
  const key = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(encoder.encode(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, toArrayBuffer(encoder.encode(value))));
  return [...signature].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function constantTimeEqual(left: string, right: string): boolean {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return difference === 0;
}

async function encryptionKey(env: AppEnv): Promise<CryptoKey> {
  const encoded = requireSecret(env.BOOKING_ENCRYPTION_KEY, "BOOKING_ENCRYPTION_KEY");
  const raw = base64UrlDecode(encoded);
  if (raw.byteLength !== 32) throw new Error("BOOKING_ENCRYPTION_KEY must decode to exactly 32 bytes.");
  return crypto.subtle.importKey("raw", toArrayBuffer(raw), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptPhone(env: AppEnv, normalizedPhone: string): Promise<string> {
  const iv = randomBytes(12);
  const key = await encryptionKey(env);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: toArrayBuffer(iv) },
      key,
      toArrayBuffer(encoder.encode(normalizedPhone)),
    ),
  );
  return `v1.${base64UrlEncode(iv)}.${base64UrlEncode(ciphertext)}`;
}

export async function decryptPhone(env: AppEnv, encrypted: string): Promise<string> {
  const [version, ivText, ciphertextText, extra] = encrypted.split(".");
  if (version !== "v1" || !ivText || !ciphertextText || extra !== undefined) {
    throw new Error("Encrypted phone value has an unsupported format.");
  }
  const cleartext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(base64UrlDecode(ivText)) },
    await encryptionKey(env),
    toArrayBuffer(base64UrlDecode(ciphertextText)),
  );
  return new TextDecoder().decode(cleartext);
}

export function normalizeEgyptianPhone(input: string): string {
  const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
  const persianDigits = "۰۱۲۳۴۵۶۷۸۹";
  let digits = [...input.trim()].map((character) => {
    const arabic = arabicDigits.indexOf(character);
    if (arabic >= 0) return String(arabic);
    const persian = persianDigits.indexOf(character);
    return persian >= 0 ? String(persian) : character;
  }).join("");
  digits = digits.replace(/[\s().-]/g, "");
  if (digits.startsWith("+20")) digits = `0${digits.slice(3)}`;
  else if (digits.startsWith("0020")) digits = `0${digits.slice(4)}`;
  if (!/^01[0125]\d{8}$/.test(digits)) throw new RangeError("Enter a valid Egyptian mobile number.");
  return `+20${digits.slice(1)}`;
}

export async function issueBookingCode(): Promise<string> {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const bytes = randomBytes(16);
  const compact = [...bytes].map((byte) => alphabet[byte & 31] ?? "2").join("");
  return compact.match(/.{1,4}/g)?.join("-") ?? compact;
}

export function normalizeBookingCode(code: string): string {
  const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{16}$/.test(normalized)) {
    throw new RangeError("Booking code is invalid.");
  }
  return normalized;
}

export async function hashBookingCode(env: AppEnv, code: string): Promise<string> {
  return hmacSha256Hex(requireSecret(env.BOOKING_HASH_SECRET, "BOOKING_HASH_SECRET"), normalizeBookingCode(code));
}
