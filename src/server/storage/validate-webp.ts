import { inspectSanitizedWebp } from "./image-validation.js";

export interface VerifiedPitchPhoto {
  bytes: Uint8Array;
  mime: "image/webp";
  width: number;
  height: number;
}

/** Validate already-reencoded browser output without allocating a decoded pixel buffer in Workers Free. */
export function validatePreparedPitchPhoto(bytes: Uint8Array): VerifiedPitchPhoto {
  const image = inspectSanitizedWebp(bytes);
  return { bytes, mime: "image/webp", width: image.width, height: image.height };
}
