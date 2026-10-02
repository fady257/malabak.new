import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { ArrowRight, CalendarDays, Clock3, LockKeyhole, PhoneCall, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../../app/api.js";
import { errorMessage, formatBusinessTime, formatDate, money, paymentLabel, statusLabel, statusTone, whatsappUrl, currentIntlLocale } from "../../app/utils.js";
import { isEnglishLocale, translateText } from "../../app/i18n.js";
import { TextField } from "../../components/Fields.js";
import LanguageToggle from "../../components/LanguageToggle.js";

type BookingDetails = Awaited<ReturnType<typeof api.booking.lookup.mutate>>;

export default function ManageBookingPage() {
  const [code, setCode] = useState("");
  const [phone, setPhone] = useState("");
  const [booking, setBooking] = useState<BookingDetails | null>(null);
  const lookup = useMutation({ mutationFn: () => api.booking.lookup.mutate({ code: code.trim(), phone }) });
  const cancel = useMutation({ mutationFn: () => api.booking.cancelOwn.mutate({ code: code.trim(), phone }), onSuccess: () => {
    setBooking((current) => current ? { ...current, status: "cancelled" } : current);
  } });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBooking(null);
    lookup.mutate(undefined, { onSuccess: setBooking });
  }

  const canCancel = booking && ["pending", "confirmed"].includes(booking.status) && booking.startAtUtcMs > Date.now();
  const whatsapp = booking?.venueWhatsapp ? whatsappUrl(booking.venueWhatsapp, isEnglishLocale() ? `Hello, I have a question about a booking at ${booking.venueName} on ${booking.businessDate} at ${formatBusinessTime(booking.startMinute)}.` : `مرحبًا، عندي استفسار عن حجز في ${booking.venueName} يوم ${booking.businessDate} الساعة ${formatBusinessTime(booking.startMinute)}.`) : null;

  return <main className="public-shell manage-shell">
    <header className="public-nav wrap"><Link to="/" className="brand"><span className="brand-mark"><span /></span><span className="brand-name">ملعبك</span></Link><nav><Link to="/" className="nav-link">الصفحة الرئيسية</Link><LanguageToggle /></nav></header>
    <section className="manage-card wrap narrow">
      <Link to="/" className="back-link"><ArrowRight size={16} /> رجوع</Link>
      <span className="eyebrow">استعلام آمن</span><h1>حجزك، في إيدك.</h1><p className="manage-lede">اكتب رمز الحجز ورقم الموبايل المسجل. ما حدش يقدر يشوف أو يلغي الحجز من غير الاتنين.</p>
      <div className="form-card"><form onSubmit={submit} className="stack-form"><TextField label="رمز الحجز" value={code} onChange={(event) => setCode(event.target.value)} dir="ltr" autoCapitalize="characters" required minLength={16} maxLength={40} placeholder="XXXX-XXXX-XXXX-XXXX" /><TextField label="رقم الموبايل المسجل" value={phone} onChange={(event) => setPhone(event.target.value)} type="tel" inputMode="tel" autoComplete="tel" required maxLength={40} placeholder="01xxxxxxxxx" /><button type="submit" className="button button-primary button-wide" disabled={lookup.isPending}>{lookup.isPending ? <><span className="spinner spinner-light" /> بندوّر على الحجز…</> : <>عرض حالة الحجز <ArrowRight size={16} /></>}</button></form>
        {lookup.isError && <div className="notice notice-error" role="alert">{errorMessage(lookup.error)}</div>}
        {cancel.isError && <div className="notice notice-error" role="alert">{errorMessage(cancel.error)}</div>}
      </div>
      {booking && <article className="booking-detail-card" aria-live="polite">
        <div className="booking-detail-top"><span className="eyebrow">{booking.venueName}</span><span className={`status-badge tone-${statusTone(booking.status)}`}>{statusLabel[booking.status] ?? booking.status}</span></div>
        <h2>{booking.pitchName}</h2><div className="booking-meta"><span><CalendarDays size={16} />{formatDate(booking.businessDate)}</span><span><Clock3 size={16} />{formatBusinessTime(booking.startMinute)} · {booking.durationMinutes} دقيقة</span></div>
        <div className="detail-divider"><span>السعر</span><strong>{money(booking.pricePiasters)}</strong></div><div className="detail-divider"><span>الدفع</span><span>{paymentLabel[booking.paymentStatus] ?? booking.paymentStatus}</span></div>
        {booking.paymentReference && <div className="detail-divider"><span>مرجع التحويل</span><b>{booking.paymentReference}</b></div>}
        {booking.holdExpiresAtMs && booking.status === "pending" && <p className="hold-clock">تنتهي المهلة: {new Intl.DateTimeFormat(currentIntlLocale(), { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Cairo" }).format(new Date(booking.holdExpiresAtMs))}</p>}
        {canCancel && <div className="detail-actions"><button type="button" className="button button-danger" disabled={cancel.isPending} onClick={() => { if (window.confirm(translateText("تأكيد طلب إلغاء الحجز؟ يظل سجل الحجز محفوظًا، ويصبح الموعد متاحًا لغيرك."))) cancel.mutate(); }}>{cancel.isPending ? "بنحفظ الإلغاء…" : "إلغاء الحجز"}</button>{whatsapp && <a className="button button-quiet" href={whatsapp} target="_blank" rel="noopener noreferrer"><PhoneCall size={16} /> سؤال الملعب</a>}</div>}
        {booking.status === "cancelled" && <p className="notice notice-success">تم إلغاء الحجز؛ بقي سجل التغيير محفوظًا.</p>}
        <p className="private-note"><ShieldCheck size={15} /> ما بنحذفش سجل الحجز، وبنحرر الموعد بأمان بعد الإلغاء.</p>
      </article>}
      <div className="manage-security"><LockKeyhole size={16} /> لا تكتب رمز الحجز في مكان عام، ولا تشاركه إلا مع من تثق به.</div>
    </section>
  </main>;
}
