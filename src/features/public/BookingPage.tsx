import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CalendarDays, Check, Clock3, LockKeyhole, MapPin, ShieldCheck } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { api } from "../../app/api.js";
import { addDateDays, errorMessage, formatBusinessTime, formatDate, formatDateTime, money, todayInCairo } from "../../app/utils.js";
import { TextAreaField, TextField } from "../../components/Fields.js";
import LanguageToggle from "../../components/LanguageToggle.js";

export default function BookingPage() {
  const { slug = "" } = useParams();
  const queryClient = useQueryClient();
  const venue = useQuery({ queryKey: ["public-venue", slug], queryFn: () => api.venue.publicBySlug.query({ slug }), enabled: Boolean(slug) });
  const [pitchId, setPitchId] = useState("");
  const [date, setDate] = useState(todayInCairo());
  const [startMinute, setStartMinute] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [created, setCreated] = useState<Awaited<ReturnType<typeof api.booking.create.mutate>> | null>(null);

  useEffect(() => { if (!pitchId && venue.data?.pitches[0]) setPitchId(venue.data.pitches[0].id); }, [venue.data, pitchId]);
  const slots = useQuery({
    queryKey: ["public-availability", slug, pitchId, date],
    queryFn: () => api.booking.availability.query({ venueSlug: slug, pitchId, businessDate: date }),
    enabled: Boolean(slug && pitchId && date),
    refetchInterval: 30_000,
  });
  const create = useMutation({
    mutationFn: () => api.booking.create.mutate({
      venueSlug: slug, pitchId, businessDate: date, startMinute: startMinute ?? -1,
      customerName: name, customerPhone: phone, paymentReference: reference.trim() || null,
      customerNote: note.trim() || null,
    }),
    onSuccess: (booking) => {
      setCreated(booking);
      void queryClient.invalidateQueries({ queryKey: ["public-availability"] });
    },
  });
  const maxDate = addDateDays(todayInCairo(), 60);
  const place = venue.data;
  const selectedSlot = slots.data?.find((slot) => slot.startMinute === startMinute);
  const [clockNow, setClockNow] = useState(() => Date.now());
  useEffect(() => {
    if (!created) return;
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [created]);
  const holdRemainingMs = created ? Math.max(0, created.holdExpiresAtMs - clockNow) : 0;
  const holdCountdown = `${String(Math.floor(holdRemainingMs / 60_000)).padStart(2, "0")}:${String(Math.floor((holdRemainingMs % 60_000) / 1000)).padStart(2, "0")}`;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (startMinute === null) return;
    create.mutate();
  }

  if (venue.isLoading) return <main className="route-loading"><span className="spinner" /> بنحمّل المواعيد…</main>;
  if (venue.isError || !place) return <main className="wrap narrow"><Link to="/" className="back-link"><ArrowRight size={16} /> رجوع</Link><div className="notice notice-warning">صفحة الحجز غير متاحة أو غير منشورة.</div></main>;

  return <main className="public-shell booking-shell">
    <header className="public-nav wrap"><Link to="/" className="brand"><span className="brand-mark"><span /></span><span className="brand-name">ملعبك</span></Link><nav><Link to="/manage-booking" className="nav-link">إدارة حجزي</Link><LanguageToggle /></nav></header>
    <div className="wrap booking-layout">
      <section className="booking-intro"><Link to="/" className="back-link"><ArrowRight size={16} /> كل الملاعب</Link><span className="eyebrow">الحجز بخطوات واضحة</span><h1>موعد لعبتك،<br /><em>اختاره براحتك.</em></h1><p>المواعيد اللي ظاهرة هنا بتتحدث مع كل حجز. اختار المتاح، وبعدها راجع بياناتك قبل الإرسال.</p><div className="venue-mini"><span className="venue-mini-icon"><MapPin size={18} /></span><div><b>{place.name}</b><small>{place.address || "ملاعب خماسية"}</small></div></div><div className="security-note"><ShieldCheck size={18} /><span>رمز الحجز ورقمك مطلوبان لمتابعة أو إلغاء الطلب.</span></div></section>
      <section className="booking-panel">
        <div className="panel-topline"><span>١ / اختار موعدك</span><span className="panel-step">{place.slotLengthMinutes} دقيقة</span></div>
        <div className="booking-fields">
          <label className="field"><span className="field-label">الملعب</span><select className="input select" value={pitchId} onChange={(event) => { setPitchId(event.target.value); setStartMinute(null); setCreated(null); }}>
            {place.pitches.map((pitch) => <option key={pitch.id} value={pitch.id}>{pitch.name}</option>)}
          </select></label>
          <TextField label="اليوم" type="date" min={todayInCairo()} max={maxDate} value={date} onChange={(event) => { setDate(event.target.value); setStartMinute(null); setCreated(null); }} />
        </div>
        <div className="day-caption"><CalendarDays size={16} /><span>{formatDate(date)}</span></div>
        <div className="slot-legend"><span><i className="legend-free" /> متاح</span><span><i className="legend-pending" /> بانتظار التأكيد</span><span><i className="legend-booked" /> محجوز — الوقت مشطوب</span></div>
        {slots.isLoading ? <div className="slot-placeholder"><span className="spinner" /> بنحدّث المواعيد…</div> : slots.isError ? <div className="notice notice-warning">تعذر تحميل المواعيد. غيّر اليوم أو حاول مرة أخرى.</div> : !slots.data?.length ? <div className="empty-slots">مفيش مواعيد في اليوم ده. جرّب يوم تاني.</div> : <div className="slot-grid" aria-label="المواعيد المتاحة والمحجوزة">
          {slots.data?.map((slot) => <button type="button" key={`${slot.startMinute}-${slot.durationMinutes}`} disabled={slot.availability !== "available"} onClick={() => { setStartMinute(slot.startMinute); setCreated(null); }} className={`slot-choice ${slot.startMinute === startMinute ? "selected" : ""} ${slot.availability !== "available" ? "unavailable" : ""}`}>
            <span>{formatBusinessTime(slot.startMinute)}</span><small>{slot.availability === "available" ? money(slot.pricePiasters) : slot.availability === "pending" ? "محجوز مؤقتًا" : "محجوز"}</small>
          </button>)}
        </div>}
        {selectedSlot && !created && <form onSubmit={submit} className="booking-form">
          <div className="form-divider"><span>٢ / بيانات الحجز</span><span>{money(selectedSlot.pricePiasters)}</span></div>
          <TextField label="الاسم" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={120} placeholder="الاسم اللي هيتسجل عليه الحجز" />
          <TextField label="رقم الموبايل" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} required maxLength={40} placeholder="01xxxxxxxxx" help="هنحتاجه مع رمز الحجز لو حبيت تتابع أو تلغي." />
          {place.depositPiasters > 0 && <><div className="deposit-card"><b>العربون المطلوب: {money(place.depositPiasters)}</b><span>حوّل إلى فودافون كاش ثم أضف مرجع التحويل. الملعب يراجع الدفع قبل التأكيد.</span>{place.vodafoneCashNumber && <strong dir="ltr">{place.vodafoneCashNumber}</strong>}</div><TextField label="مرجع التحويل" value={reference} onChange={(event) => setReference(event.target.value)} required maxLength={100} placeholder="رقم العملية أو اسم المحوّل" /></>}
          <TextAreaField label="ملاحظة للملعب (اختياري)" value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} rows={2} placeholder="أي معلومة تساعد في تنسيق الموعد" />
          {create.isError && <div className="notice notice-error" role="alert">{errorMessage(create.error)}</div>}
          <button className="button button-primary button-wide" type="submit" disabled={create.isPending}>{create.isPending ? <><span className="spinner spinner-light" /> بنحفظ طلبك…</> : <>إرسال طلب الحجز <ArrowRight size={17} /></>}</button>
          <p className="fine-print">إرسال الطلب يحجز الموعد مؤقتًا إلى أن يراجعه الملعب. ما تشاركش رمز الحجز مع حد.</p>
        </form>}
        {created && <div className="booking-success" role="status">
          <span className="success-emblem"><Check size={23} /></span><span className="eyebrow">الطلب اتحفظ</span><h2>احتفظ برمز الحجز.</h2><p>الموعد محجوز لك مؤقتًا، والملعب هيأكد الطلب بعد مراجعة البيانات.</p>
          <div className="booking-code"><span>رمز الحجز</span><strong dir="ltr">{created.bookingCode}</strong><small>مع رقم موبايلك، الرمز ده بيسمح لك تتابع الحجز أو تطلب إلغاءه.</small></div>
          <div className="booking-summary"><span><CalendarDays size={15} /> {formatDate(created.businessDate)}</span><span><Clock3 size={15} /> {formatBusinessTime(created.startMinute)}</span><b>{money(created.pricePiasters)}</b></div>
          <p className="hold-clock">{holdRemainingMs > 0 ? <>متبقي لتأكيد الموعد <b dir="ltr">{holdCountdown}</b> · حتى {formatDateTime(created.holdExpiresAtMs)}</> : "انتهت مهلة الحجز. حدّث المواعيد قبل طلب موعد جديد."}</p>
          <div className="success-actions"><Link to="/manage-booking" className="button button-primary">تابع حالة الحجز</Link><button className="button button-quiet" type="button" onClick={() => { setCreated(null); setStartMinute(null); setReference(""); }}>حجز موعد آخر</button></div>
          <div className="private-note"><LockKeyhole size={14} /> رمز الحجز لا يُخزّن كنص في النظام.</div>
        </div>}
      </section>
    </div>
  </main>;
}
