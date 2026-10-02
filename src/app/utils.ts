import { isEnglishLocale } from "./i18n.js";

export function currentIntlLocale(): string { return isEnglishLocale() ? "en-EG" : "ar-EG"; }

export function todayInCairo(): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

export function addDateDays(date: string, count: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year ?? 2000, (month ?? 1) - 1, day ?? 1));
  value.setUTCDate(value.getUTCDate() + count);
  return value.toISOString().slice(0, 10);
}

export function formatTime(minute: number): string {
  const total = ((minute % 1440) + 1440) % 1440;
  return new Intl.DateTimeFormat(currentIntlLocale(), { hour: "2-digit", minute: "2-digit", hourCycle: "h12" })
    .format(new Date(Date.UTC(2020, 0, 1, Math.floor(total / 60), total % 60)));
}

export function formatBusinessTime(minute: number): string {
  return minute >= 1440 ? `${isEnglishLocale() ? "After midnight" : "بعد منتصف الليل"} · ${formatTime(minute)}` : formatTime(minute);
}

export function formatDate(date: string, options: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long" }): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(currentIntlLocale(), { ...options, timeZone: "Africa/Cairo" })
    .format(new Date(Date.UTC(year ?? 2000, (month ?? 1) - 1, day ?? 1, 12)));
}

export function formatDateTime(timestamp: number): string {
  return new Intl.DateTimeFormat(currentIntlLocale(), { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Cairo" }).format(new Date(timestamp));
}

export function money(piasters: number): string {
  return new Intl.NumberFormat(currentIntlLocale(), { style: "currency", currency: "EGP", maximumFractionDigits: 0 })
    .format(Math.max(0, piasters) / 100);
}

export const statusLabel: Record<string, string> = {
  pending: "بانتظار تأكيد الملعب",
  confirmed: "مؤكد",
  cancelled: "ملغي",
  rejected: "مرفوض",
  expired: "انتهت المهلة",
  completed: "اكتمل",
  no_show: "لم يحضر العميل",
};

export const paymentLabel: Record<string, string> = {
  unpaid: "غير مدفوع",
  deposit: "عربون مستلم",
  paid: "مدفوع بالكامل",
};

export function statusTone(status: string): string {
  if (status === "confirmed" || status === "completed" || status === "paid") return "success";
  if (status === "pending" || status === "deposit") return "warning";
  if (["cancelled", "rejected", "expired", "no_show", "unpaid"].includes(status)) return "muted";
  return "neutral";
}

export function whatsappUrl(phone: string, message: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

export function errorMessage(error: unknown, fallback = "حدث خطأ. حاول مرة أخرى."): string {
  return error instanceof Error ? error.message : fallback;
}
