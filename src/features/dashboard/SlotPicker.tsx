import { useQuery } from "@tanstack/react-query";
import { Clock3 } from "lucide-react";
import { api } from "../../app/api.js";
import { formatBusinessTime, money } from "../../app/utils.js";

export default function SlotPicker({ pitchId, businessDate, value, onChange, ignoreBookingId, label = "الوقت المتاح" }: {
  pitchId: string;
  businessDate: string;
  value: number | null;
  onChange: (minute: number | null) => void;
  ignoreBookingId?: string;
  label?: string;
}) {
  const options = useQuery({
    queryKey: ["owner-slot-options", pitchId, businessDate, ignoreBookingId ?? "new"],
    queryFn: () => api.admin.availability.query({ pitchId, businessDate, ...(ignoreBookingId ? { ignoreBookingId } : {}) }),
    enabled: Boolean(pitchId && businessDate),
  });
  const available = options.data?.filter((slot) => slot.availability === "available") ?? [];
  return <label className="field">
    <span className="field-label"><Clock3 size={14} /> {label}</span>
    <select className="input select" value={value ?? ""} onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)} disabled={!pitchId || !businessDate || options.isLoading || available.length === 0} required>
      <option value="">{options.isLoading ? "تحميل المواعيد…" : options.isError ? "تعذر تحميل الأوقات" : available.length ? "اختار وقتًا متاحًا" : "لا توجد أوقات متاحة"}</option>
      {available.map((slot) => <option key={slot.startMinute} value={slot.startMinute}>{formatBusinessTime(slot.startMinute)} — {money(slot.pricePiasters)}</option>)}
    </select>
    {options.isError && <span className="field-error">تعذر تحميل الأوقات. غيّر اليوم أو أعد المحاولة.</span>}
  </label>;
}
