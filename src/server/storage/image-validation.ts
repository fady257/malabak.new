import { MAX_STORED_IMAGE_BYTES } from "./upload-policy.js";

export const MAX_INPUT_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 12_000_000;
export const MAX_IMAGE_SIDE = 10_000;

export type RasterMime = "image/jpeg" | "image/png" | "image/webp";
export interface RasterMetadata {
  mime: RasterMime;
  width: number;
  height: number;
}

function u16be(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function u16le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function u24le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16);
}

function u32be(bytes: Uint8Array, offset: number): number {
  return (((bytes[offset] ?? 0) << 24) | ((bytes[offset + 1] ?? 0) << 16) | ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0)) >>> 0;
}

function u32le(bytes: Uint8Array, offset: number): number {
  return (((bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16) | ((bytes[offset + 3] ?? 0) << 24)) >>> 0);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let value = "";
  for (let index = 0; index < length; index += 1) value += String.fromCharCode(bytes[offset + index] ?? 0);
  return value;
}

function dimensions(width: number, height: number, mime: RasterMime): RasterMetadata {
  if (
    !Number.isInteger(width) || !Number.isInteger(height) ||
    width < 1 || height < 1 || width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE ||
    width * height > MAX_IMAGE_PIXELS
  ) {
    throw new RangeError("Image dimensions exceed the safe processing limit.");
  }
  return { mime, width, height };
}

const PNG_CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function pngCrc32(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let index = start; index < end; index += 1) {
    crc = (PNG_CRC_TABLE[(crc ^ (bytes[index] ?? 0)) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function parsePng(bytes: Uint8Array): RasterMetadata {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 45 || signature.some((value, index) => bytes[index] !== value)) {
    throw new RangeError("PNG file is incomplete or malformed.");
  }
  if (u32be(bytes, 8) !== 13 || ascii(bytes, 12, 4) !== "IHDR") {
    throw new RangeError("PNG header is invalid.");
  }
  const result = dimensions(u32be(bytes, 16), u32be(bytes, 20), "image/png");
  const bitDepth = bytes[24] ?? 0;
  const colorType = bytes[25] ?? 255;
  const compression = bytes[26] ?? 255;
  const filter = bytes[27] ?? 255;
  const interlace = bytes[28] ?? 255;
  if (![1, 2, 4, 8, 16].includes(bitDepth) || ![0, 2, 3, 4, 6].includes(colorType) || compression !== 0 || filter !== 0 || ![0, 1].includes(interlace)) {
    throw new RangeError("PNG uses an unsupported image encoding.");
  }

  let offset = 8;
  let sawHeader = false;
  let sawData = false;
  let sawEnd = false;
  let chunks = 0;
  while (offset + 12 <= bytes.length && chunks < 2048) {
    const length = u32be(bytes, offset);
    const type = ascii(bytes, offset + 4, 4);
    const end = offset + 12 + length;
    if (end > bytes.length || end <= offset) throw new RangeError("PNG contains an invalid chunk length.");
    if (u32be(bytes, offset + 8 + length) !== pngCrc32(bytes, offset + 4, offset + 8 + length)) {
      throw new RangeError("PNG chunk CRC does not match its content.");
    }
    if (chunks === 0 && (type !== "IHDR" || length !== 13)) throw new RangeError("PNG header chunk is misplaced.");
    if (type === "IHDR") {
      if (sawHeader || chunks !== 0) throw new RangeError("PNG has duplicate header chunks.");
      sawHeader = true;
    }
    if (type === "IDAT") sawData = true;
    if (type === "IEND") {
      if (length !== 0 || !sawData || end !== bytes.length) throw new RangeError("PNG end marker is invalid.");
      sawEnd = true;
      offset = end;
      break;
    }
    offset = end;
    chunks += 1;
  }
  if (!sawHeader || !sawData || !sawEnd) throw new RangeError("PNG is missing required image data.");
  return result;
}

function parseJpeg(bytes: Uint8Array): RasterMetadata {
  if (bytes.length < 16 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) {
    throw new RangeError("JPEG file is incomplete or malformed.");
  }
  const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  let width = 0;
  let height = 0;
  let sawScan = false;
  let markers = 0;
  while (offset < bytes.length - 2 && markers < 4096) {
    while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === undefined) break;
    if (marker === 0xda) { sawScan = true; break; }
    if (marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { markers += 1; continue; }
    if (offset + 2 > bytes.length) throw new RangeError("JPEG segment is truncated.");
    const length = u16be(bytes, offset);
    if (length < 2 || offset + length > bytes.length) throw new RangeError("JPEG segment length is invalid.");
    if (startOfFrame.has(marker)) {
      if (length < 8) throw new RangeError("JPEG frame header is invalid.");
      height = u16be(bytes, offset + 3);
      width = u16be(bytes, offset + 5);
    }
    offset += length;
    markers += 1;
  }
  if (!sawScan || !width || !height) throw new RangeError("JPEG has no valid image frame.");
  return dimensions(width, height, "image/jpeg");
}

function parseWebp(bytes: Uint8Array): RasterMetadata {
  if (bytes.length < 30 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP" || u32le(bytes, 4) + 8 !== bytes.length) {
    throw new RangeError("WebP file is incomplete or malformed.");
  }
  let offset = 12;
  let width = 0;
  let height = 0;
  let chunks = 0;
  while (offset + 8 <= bytes.length && chunks < 1024) {
    const kind = ascii(bytes, offset, 4);
    const length = u32le(bytes, offset + 4);
    const payload = offset + 8;
    const end = payload + length;
    if (end > bytes.length || end <= offset) throw new RangeError("WebP chunk length is invalid.");
    if (kind === "ANIM" || kind === "ANMF") throw new RangeError("Animated WebP is not accepted.");
    if (kind === "VP8X") {
      if (length < 10) throw new RangeError("WebP extended header is invalid.");
      if (((bytes[payload] ?? 0) & 0x02) !== 0) throw new RangeError("Animated WebP is not accepted.");
      width = 1 + u24le(bytes, payload + 4);
      height = 1 + u24le(bytes, payload + 7);
    } else if (kind === "VP8 " && length >= 10 && bytes[payload + 3] === 0x9d && bytes[payload + 4] === 0x01 && bytes[payload + 5] === 0x2a) {
      width = u16le(bytes, payload + 6) & 0x3fff;
      height = u16le(bytes, payload + 8) & 0x3fff;
    } else if (kind === "VP8L" && length >= 5 && bytes[payload] === 0x2f) {
      const b1 = bytes[payload + 1] ?? 0;
      const b2 = bytes[payload + 2] ?? 0;
      const b3 = bytes[payload + 3] ?? 0;
      const b4 = bytes[payload + 4] ?? 0;
      width = 1 + (b1 | ((b2 & 0x3f) << 8));
      height = 1 + ((b2 >> 6) | (b3 << 2) | ((b4 & 0x0f) << 10));
    }
    offset = end + (length & 1);
    chunks += 1;
  }
  if (!width || !height || offset !== bytes.length) throw new RangeError("WebP has no complete still-image frame.");
  return dimensions(width, height, "image/webp");
}

export function inspectRasterImage(bytes: Uint8Array): RasterMetadata {
  if (bytes.byteLength < 16 || bytes.byteLength > MAX_INPUT_IMAGE_BYTES) {
    throw new RangeError("Image must be between 16 bytes and 10 MiB.");
  }
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return parsePng(bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return parseJpeg(bytes);
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return parseWebp(bytes);
  throw new RangeError("Only valid JPEG, PNG, or still WebP images are accepted; SVG and other files are rejected.");
}

/** Validate a browser-reencoded WebP without decoding pixels in a 10 ms CPU Worker. */
export function inspectSanitizedWebp(bytes: Uint8Array): RasterMetadata {
  if (
    bytes.byteLength < 30 || bytes.byteLength > MAX_STORED_IMAGE_BYTES ||
    ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP" ||
    u32le(bytes, 4) + 8 !== bytes.byteLength
  ) {
    throw new RangeError("حجم أو ترويسة WebP غير صالحة أو تتجاوز 1.5 ميجابايت.");
  }

  let offset = 12;
  let sawExtendedHeader = false;
  let extendedWidth = 0;
  let extendedHeight = 0;
  let extendedFlags = 0;
  let sawAlphaChunk = false;
  let imageKind: "VP8 " | "VP8L" | null = null;
  let imageWidth = 0;
  let imageHeight = 0;
  let chunkCount = 0;

  while (offset < bytes.length) {
    if (offset + 8 > bytes.length || chunkCount >= 4) throw new RangeError("حاوية WebP غير مكتملة أو غير مدعومة.");
    const kind = ascii(bytes, offset, 4);
    const length = u32le(bytes, offset + 4);
    const payload = offset + 8;
    const end = payload + length;
    if (end > bytes.length || end <= offset) throw new RangeError("حجم مقطع WebP غير صالح.");

    if (kind === "VP8X") {
      if (offset !== 12 || sawExtendedHeader || length !== 10) throw new RangeError("ترويسة WebP الموسعة غير صالحة.");
      sawExtendedHeader = true;
      extendedFlags = bytes[payload] ?? 0;
      // Only alpha is allowed; ICC, EXIF, XMP, animation, and reserved flags are rejected.
      if ((extendedFlags & ~0x10) !== 0) throw new RangeError("بيانات WebP الوصفية أو المتحركة غير مقبولة.");
      extendedWidth = 1 + u24le(bytes, payload + 4);
      extendedHeight = 1 + u24le(bytes, payload + 7);
    } else if (kind === "ALPH") {
      if (!sawExtendedHeader || (extendedFlags & 0x10) === 0 || sawAlphaChunk || imageKind || length < 1) {
        throw new RangeError("مقطع شفافية WebP غير صالح.");
      }
      sawAlphaChunk = true;
    } else if (kind === "VP8 ") {
      if (imageKind || length < 10 || bytes[payload + 3] !== 0x9d || bytes[payload + 4] !== 0x01 || bytes[payload + 5] !== 0x2a) {
        throw new RangeError("إطار WebP lossy غير صالح.");
      }
      imageKind = "VP8 ";
      imageWidth = u16le(bytes, payload + 6) & 0x3fff;
      imageHeight = u16le(bytes, payload + 8) & 0x3fff;
    } else if (kind === "VP8L") {
      if (imageKind || length < 5 || bytes[payload] !== 0x2f) throw new RangeError("إطار WebP lossless غير صالح.");
      const b1 = bytes[payload + 1] ?? 0;
      const b2 = bytes[payload + 2] ?? 0;
      const b3 = bytes[payload + 3] ?? 0;
      const b4 = bytes[payload + 4] ?? 0;
      imageKind = "VP8L";
      imageWidth = 1 + (b1 | ((b2 & 0x3f) << 8));
      imageHeight = 1 + ((b2 >> 6) | (b3 << 2) | ((b4 & 0x0f) << 10));
    } else {
      throw new RangeError("مقاطع WebP الإضافية أو بيانات EXIF غير مقبولة.");
    }

    const paddedEnd = end + (length & 1);
    if (paddedEnd > bytes.length) throw new RangeError("حشوة مقطع WebP غير مكتملة.");
    offset = paddedEnd;
    chunkCount += 1;
  }

  if (!imageKind || !imageWidth || !imageHeight) throw new RangeError("WebP لا يحتوي على إطار صورة ثابت.");
  if (sawExtendedHeader && (extendedWidth !== imageWidth || extendedHeight !== imageHeight)) {
    throw new RangeError("أبعاد ترويسة WebP لا تطابق إطار الصورة.");
  }
  if ((extendedFlags & 0x10) !== 0 && imageKind === "VP8 " && !sawAlphaChunk) {
    throw new RangeError("مقطع شفافية WebP مفقود.");
  }
  if (imageWidth > 1800 || imageHeight > 1800) throw new RangeError("ارفع صورة WebP ثابتة لا تتجاوز 1800 بكسل لكل جانب.");
  return dimensions(imageWidth, imageHeight, "image/webp");
}
