export const MAX_STORED_IMAGE_BYTES = 1_500_000;

export const UPLOAD_POLICY = Object.freeze({
  acceptedSourceFormats: ["image/jpeg", "image/png", "image/webp"] as const,
  outputFormat: "image/webp" as const,
  maxFileBytes: 10 * 1024 * 1024,
  maxPixels: 12_000_000,
  maxOutputSide: 1800,
  maxSanitizedBytes: MAX_STORED_IMAGE_BYTES,
  imagesAreReencoded: true,
  metadataIsRetained: false,
  storage: "private-d1-blob" as const,
});
