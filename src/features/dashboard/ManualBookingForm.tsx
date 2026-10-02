import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, Repeat2 } from "lucide-react";
import { api } from "../../app/api.js";
import { addDateDays, errorMessage, formatBusinessTime, formatDate, money, todayInCairo } from "../../app/utils.js";
import { ErrorNotice, SuccessNotice } from "../../components/Feedback.js";
import { SelectField, TextAreaField, TextField } from "../../components/Fields.js";
import SlotPicker from "./SlotPicker.js";

type Pitch = Awaited<ReturnType<typeof api.venue.pitches.query>>[number];
type Created = Awaited<ReturnType<typeof api.admin.createManual.mutate>>;

export default function ManualBookingForm({ pitches, initialDate }: { pitches: Pitch[]; initialDate: string }) {
  const queryClient = useQueryClient();
  const [pitchId, setPitchId] = useState(pitches.find((pitch) => pitch.active)?.id ?? "");
  const [businessDate, setBusinessDate] = useState(initialDate || todayInCairo());
  const [startMinute, setStartMinute] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [repeatWeeks, setRepeatWeeks] = useState("1");
  const [created, setCreated] = useState<Created | null>(null);
  const pitchOptions = pitches.filter((pitch) => pitch.active);
  const mutation = useMutation({
    mutationFn: () => api.admin.createManual.mutate({
      pitchId, businessDate, startMinute: startMinute ?? -1,
      customerName: name, customerPhone: phone, customerNote: note.trim() || null,
      repeatWeeks: Number(repeatWeeks),
    }),
    onSuccess: (value) => {
      setCreated(value);
      void queryClient.invalidateQueries({ queryKey: ["owner-day-bookings"] });
      void queryClient.invalidateQueries({ queryKey: ["owner-analytics"] });
      void queryClient.invalidateQueries({ queryKey: ["owner-slot-options"] });
    },
  });
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); mutation.mutate(); }
  const maxDate = addDateDays(todayInCairo(), 370);

  if (!pitchOptions.length) return <div className="notice notice-warning">أضف ملعبًا نشطًا قبل تسجيل حجز يدوي.</div>;
  return <div className="manual-booking">
    <div className="manual-heading"><span className="manual-icon"><CalendarPlus size={19} /></span><div><h3>سجّل حجزًا من الملعب</h3><p>نفس قواعد منع التداخل والحفظ تُطبق على الحجز اليدوي.</p></div></div>
    <form className="manual-grid" onSubmit={submit}>
      <SelectField label="الملعب" value={pitchId} onChange={(event) => { setPitchId(event.target.value); setStartMinute(null); setCreated(null); }} required>
        {pitchOptions.map((pitch) => <option key={pitch.id} value={pitch.id}>{pitch.name}</option>)}
      </SelectField>
      <TextField label="اليوم" type="date" min={todayInCairo()} max={maxDate} value={businessDate} onChange={(event) => { setBusinessDate(event.target.value); setStartMinute(null); setCreated(null); }} required />
      <SlotPicker pitchId={pitchId} businessDate={businessDate} value={startMinute} onChange={(value) => { setStartMinute(value); setCreated(null); }} />
      <TextField label="اسم العميل" value={name} onChange={(event) => setName(event.target.value)} required maxLength={120} />
      <TextField label="رقم العميل" type="tel" inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} required maxLength={40} />
      <SelectField label="التكرار الأسبوعي" value={repeatWeeks} onChange={(event) => setRepeatWeeks(event.target.value)}>
        <option value="1">مرة واحدة</option><option value="4">أربع أسابيع</option><option value="8">ثمانية أسابيع</option><option value="12">اثنا عشر أسبوعًا</option><option value="52">اثنان وخمسون أسبوعًا</option>
      </SelectField>
      <TextAreaField className="manual-note" label="ملاحظة داخلية (اختياري)" value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} rows={2} />
      {Number(repeatWeeks) > 1 && <p className="repeat-caption"><Repeat2 size={15} /> الموعد يتكرر كل أسبوع بنفس الساعة؛ لو أي أسبوع متعارض مش هيتحفظ أي موعد.</p>}
      {mutation.isError && <div className="manual-message"><ErrorNotice>{errorMessage(mutation.error)}</ErrorNotice></div>}
      <div className="manual-submit"><button className="button button-primary" type="submit" disabled={mutation.isPending || startMinute === null}>{mutation.isPending ? "بنحفظ الحجز…" : "حفظ الحجز"}</button><small>يظهر تأكيد الحفظ بعد انتهاء قاعدة البيانات فقط.</small></div>
    </form>
    {created && <div className="created-bookings" role="status"><SuccessNotice>اتحفظ {created.bookings.length} {created.bookings.length === 1 ? "حجز" : "حجوزات"} بنجاح.</SuccessNotice><div className="code-list"><b>رموز المتابعة — احتفظ بها أو شارك الرمز مع العميل:</b>{created.bookings.map((booking) => <div key={booking.id}><span>{formatDate(booking.businessDate)} · {formatBusinessTime(booking.startMinute)} · {money(booking.pricePiasters)}</span><code dir="ltr">{booking.customerCode}</code></div>)}</div></div>}
  </div>;
}
