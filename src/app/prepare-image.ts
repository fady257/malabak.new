const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const MAX_STORED_BYTES = 1_500_000;
const MAX_SIDE = 1800;
const MAX_PIXELS = 12_000_000;

function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error("تعذر تجهيز الصورة في هذا المتصفح."));
      if (blob.type !== "image/webp") return reject(new Error("المتصفح لا يدعم تجهيز الصور بصيغة WebP."));
      resolve(blob);
    }, "image/webp", quality);
  });
}

/** Re-encode on the owner's device so Pages Functions stay within Free CPU limits. */
export async function preparePitchPhoto(file: File): Promise<File> {
  if (!(file.type === "image/jpeg" || file.type === "image/png" || file.type === "image/webp")) {
    throw new Error("اختار صورة JPEG أو PNG أو WebP فقط.");
  }
  if (file.size < 1 || file.size > MAX_SOURCE_BYTES) {
    throw new Error("حجم الصورة الأصلية لازم يكون أقل من 10 ميجابايت.");
  }

  let bitmap: ImageBitmap | null = null;
  let canvas: HTMLCanvasElement | null = null;
  try {
    bitmap = await createImageBitmap(file);
    if (bitmap.width < 1 || bitmap.height < 1 || bitmap.width * bitmap.height > MAX_PIXELS) {
      throw new Error("أبعاد الصورة أكبر من الحد الآمن؛ اختر صورة أصغر.");
    }
    canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("تعذر تشغيل تجهيز الصورة في هذا المتصفح.");

    let scale = Math.min(1, MAX_SIDE / bitmap.width, MAX_SIDE / bitmap.height);
    let quality = 0.84;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.width = width;
      canvas.height = height;
      context.clearRect(0, 0, width, height);
      context.drawImage(bitmap, 0, 0, width, height);
      const blob = await canvasBlob(canvas, quality);
      if (blob.size <= MAX_STORED_BYTES) {
        const stem = file.name.replace(/\.[^.]*$/, "").slice(0, 80) || "pitch-photo";
        return new File([blob], `${stem}.webp`, { type: "image/webp", lastModified: Date.now() });
      }
      if (quality > 0.48) quality = Math.max(0.48, quality - 0.1);
      else {
        scale *= 0.8;
        quality = 0.84;
      }
    }
    throw new Error("تعذر ضغط الصورة إلى 1.5 ميجابايت؛ جرّب صورة أصغر.");
  } catch (error) {
    if (error instanceof Error && /^(تعذر|اختار|حجم|أبعاد|المتصفح)/.test(error.message)) {
      throw error;
    }
    throw new Error("تعذر فتح الصورة أو تجهيزها. جرّب صورة JPEG أو PNG أو WebP أخرى.");
  } finally {
    bitmap?.close();
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}
