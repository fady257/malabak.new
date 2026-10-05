import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownLeft, CalendarDays, Check, CircleAlert, Clock3, MessageCircle, Pencil, RefreshCw, X } from "lucide-react";
import { api } from "../../app/api.js";
import { addDateDays, errorMessage, formatBusinessTime, formatDate, formatDateTime, money, paymentLabel, statusLabel, statusTone, todayInCairo, whatsappUrl } from "../../app/utils.js";
import { isEnglishLocale, translateText } from "../../app/i18n.js";
import { ErrorNotice, LoadingState, SuccessNotice } from "../../components/Feedback.js";
import { SelectField, TextField } from "../../components/Fields.js";
import ManualBookingForm from "./ManualBookingForm.js";
import SlotPicker from "./SlotPicker.js";

type Booking = Awaited<ReturnType<typeof api.booking.ownerBookingsForDay.query>>[number];
type Pitch = Awaited<ReturnType<typeof api.venue.pitches.query>>[number];
type PaymentStatus = "unpaid" | "deposit" | "paid";
type BookingStatus = "confirmed" | "rejected" | "cancelled" | "completed" | "no_show";

function BookingRow({ booking, pitches, onSaved }: { booking: Booking; pitches: Pitch[]; onSaved: () => void }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [targetDate, setTargetDate] = useState(booking.businessDate);
  const [targetPitch, setTargetPitch] = useState(booking.pitchId);
  const [targetTime, setTargetTime] = useState<number | null>(booking.startMinute);
  const [payment, setPayment] = useState<PaymentStatus>((booking.paymentStatus as PaymentStatus) ?? "unpaid");
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["owner-bookings"] });
    void queryClient.invalidateQueries({ queryKey: ["owner-analytics"] });
    onSaved();
  };
  const updateStatus = useMutation({
    mutationFn: (input: { status: BookingStatus; paymentStatus?: PaymentStatus }) => api.admin.changeStatus.mutate({
      bookingId: booking.id, expectedUpdatedAtMs: booking.updatedAtMs, status: input.status,
      ...(input.paymentStatus ? { paymentStatus: input.paymentStatus } : {}),
    }),
    onSuccess: invalidate,
  });
  const reschedule = useMutation({
    mutationFn: () => api.admin.reschedule.mutate({ bookingId: booking.id, expectedUpdatedAtMs: booking.updatedAtMs, pitchId: targetPitch, businessDate: targetDate, startMinute: targetTime ?? -1 }),
    onSuccess: () => { setEditing(false); invalidate(); },
  });
  const active = ["pending", "confirmed"].includes(booking.status);
  const passed = booking.endAtUtcMs <= Date.now();
  const bookingMessage = booking.status === "confirmed"
    ? (isEnglishLocale() ? `Hi ${booking.customerName}, your booking at ${booking.pitchName} is confirmed for ${formatDate(booking.businessDate)} at ${formatBusinessTime(booking.startMinute)}. Contact us if you need to make a change.` : `أهلًا ${booking.customerName}، نأكد لك موعد ملعب ${booking.pitchName} يوم ${formatDate(booking.businessDate)} الساعة ${formatBusinessTime(booking.startMinute)}. لو محتاج أي تعديل تواصل معنا.`)
    : (isEnglishLocale() ? `Hi ${booking.customerName}, we received your booking request for ${booking.pitchName} on ${formatDate(booking.businessDate)} at ${formatBusinessTime(booking.startMinute)}. The venue will confirm it after review; this message is not a confirmation.` : `أهلًا ${booking.customerName}، استلمنا طلب حجز ${booking.pitchName} يوم ${formatDate(booking.businessDate)} الساعة ${formatBusinessTime(booking.startMinute)}. الملعب هيراجع الطلب ويأكد لك؛ الرسالة دي مش تأكيد للحجز.`);
  const whatsapp = active ? whatsappUrl(booking.customerPhone, bookingMessage) : null;
  const reminder = booking.status === "confirmed" && booking.startAtUtcMs > Date.now()
    ? whatsappUrl(booking.customerPhone, isEnglishLocale() ? `Hi ${booking.customerName}, a reminder that your booking at ${booking.pitchName} is on ${formatDate(booking.businessDate)} at ${formatBusinessTime(booking.startMinute)}. We look forward to seeing you.` : `أهلًا ${booking.customerName}، تذكير بموعدك في ${booking.pitchName} يوم ${formatDate(booking.businessDate)} الساعة ${formatBusinessTime(booking.startMinute)}. مستنيينك.`)
    : null;
  const activePitches = pitches.filter((pitch) => pitch.active);

  function changeStatus(status: BookingStatus, paymentStatus?: PaymentStatus) {
    if (status === "cancelled" && !window.confirm(translateText("تأكيد إلغاء الحجز؟ سيبقى سجل الحجز محفوظًا، ويتحرر الموعد لغيره."))) return;
    updateStatus.mutate({ status, ...(paymentStatus ? { paymentStatus } : {}) });
  }

  return <article className={`booking-row ${active ? "booking-row-active" : "booking-row-closed"}`}>
    <div className="booking-time-column"><span className="booking-date-label"><CalendarDays size={13} />{formatDate(booking.businessDate)}</span><span className={active ? "booking-time" : "booking-time struck"}>{formatBusinessTime(booking.startMinute)}</span><small>{booking.durationMinutes} دقيقة</small><span className={`status-badge tone-${statusTone(booking.status)}`}>{statusLabel[booking.status] ?? booking.status}</span></div>
    <div className="booking-main-info">
      <div className="booking-title-line"><div><h3 className={active ? "" : "struck-text"}>{booking.customerName}</h3><span className="booking-pitch">{booking.pitchName}</span></div><div className="booking-money"><b>{money(booking.pricePiasters)}</b><small>{money(booking.paymentReceivedPiasters)} مستلم</small></div></div>
      <div className="booking-contact"><a href={`tel:${booking.customerPhone}`} dir="ltr">{booking.customerPhone}</a>{whatsapp && <a className="whatsapp-link" href={whatsapp} target="_blank" rel="noopener noreferrer"><MessageCircle size={14} /> رسالة واتساب</a>}{reminder && <a className="whatsapp-link" href={reminder} target="_blank" rel="noopener noreferrer"><Clock3 size={14} /> تذكير واتساب</a>}</div>
      <div className="booking-meta-line"><span className={`status-badge tone-${statusTone(booking.paymentStatus)}`}>{paymentLabel[booking.paymentStatus] ?? booking.paymentStatus}</span>{booking.priorNoShows > 0 && <span className="no-show-warning"><CircleAlert size={13} /> غاب قبل كده {booking.priorNoShows} مرة</span>}{booking.paymentReference && <span className="reference-chip">مرجع: {booking.paymentReference}</span>}{booking.customerNote && <span className="customer-note">ملاحظة: {booking.customerNote}</span>}{booking.holdExpiresAtMs && booking.status === "pending" && <span className="hold-chip">المهلة {formatDateTime(booking.holdExpiresAtMs)}</span>}</div>
      {active && <div className="booking-actions">
        <label className="compact-select"><span>الدفع</span><select value={payment} onChange={(event) => setPayment(event.target.value as PaymentStatus)}><option value="unpaid">غير مدفوع</option><option value="deposit">العربون</option><option value="paid">مدفوع بالكامل</option></select></label>
        {booking.status === "pending" ? <button className="button button-primary button-small" type="button" onClick={() => updateStatus.mutate({ status: "confirmed", paymentStatus: payment })} disabled={updateStatus.isPending}><Check size={14} /> تأكيد الحجز</button> : <button className="button button-secondary button-small" type="button" onClick={() => updateStatus.mutate({ status: "confirmed", paymentStatus: payment })} disabled={updateStatus.isPending}>حفظ حالة الدفع</button>}
        {booking.status === "pending" && <button className="button button-quiet button-small" type="button" onClick={() => changeStatus("rejected")} disabled={updateStatus.isPending}>رفض الطلب</button>}
        {booking.status === "confirmed" && <button className="button button-quiet button-small" type="button" onClick={() => { setTargetDate(booking.businessDate); setTargetPitch(booking.pitchId); setTargetTime(booking.startMinute); setEditing((current) => !current); }}><Pencil size={14} /> {editing ? "إغلاق التعديل" : "تغيير الموعد"}</button>}
        <button className="button button-danger-quiet button-small" type="button" onClick={() => changeStatus("cancelled")} disabled={updateStatus.isPending}>إلغاء</button>
        {booking.status === "confirmed" && passed && <><button className="button button-quiet button-small" type="button" onClick={() => changeStatus("completed")} disabled={updateStatus.isPending}>اكتمل</button><button className="button button-quiet button-small" type="button" onClick={() => changeStatus("no_show")} disabled={updateStatus.isPending}>لم يحضر</button></>}
      </div>}
      {editing && active && <div className="reschedule-panel">
        <div className="reschedule-heading"><RefreshCw size={16} /><b>اختار الفترة الجديدة</b><span>الحجز القديم يفضل محفوظ لحد ما الجديد يتأكد.</span></div>
        <div className="form-row">
          <TextField label="اليوم الجديد" type="date" min={todayInCairo()} max={addDateDays(todayInCairo(), 370)} value={targetDate} onChange={(event) => { setTargetDate(event.target.value); setTargetTime(null); }} />
          <SelectField label="الملعب" value={targetPitch} onChange={(event) => { setTargetPitch(event.target.value); setTargetTime(null); }}>{activePitches.map((pitch) => <option key={pitch.id} value={pitch.id}>{pitch.name}</option>)}</SelectField>
          <SlotPicker pitchId={targetPitch} businessDate={targetDate} ignoreBookingId={booking.id} value={targetTime} onChange={setTargetTime} label="الموعد الجديد" />
        </div>
        {reschedule.isError && <ErrorNotice>{errorMessage(reschedule.error)}</ErrorNotice>}
        {reschedule.isSuccess && <SuccessNotice>اتحفظ التعديل واتحدث الجدول.</SuccessNotice>}
        <div className="reschedule-actions"><button className="button button-primary button-small" type="button" disabled={reschedule.isPending || targetTime === null} onClick={() => reschedule.mutate()}>{reschedule.isPending ? "بنحفظ…" : "حفظ الموعد الجديد"}</button><button className="button button-quiet button-small" type="button" onClick={() => setEditing(false)}><X size={14} /> رجوع</button></div>
      </div>}
      {updateStatus.isError && <div className="row-error"><CircleAlert size={15} /> {errorMessage(updateStatus.error)}</div>}
      {updateStatus.isSuccess && <span className="saved-inline">اتحفظ آخر تعديل</span>}
    </div>
    {active && <span className="reserved-stamp"><span className="reserved-line" />موعد محجوز</span>}
  </article>;
}

export default function SchedulePage({ bookingsOnly = false }: { bookingsOnly?: boolean }) {
  const [date, setDate] = useState(todayInCairo());
  const bookings = useQuery({ queryKey: ["owner-bookings", bookingsOnly ? "all" : date], queryFn: () => api.booking.ownerBookingsForDay.query(bookingsOnly ? {} : { businessDate: date }), refetchInterval: bookingsOnly ? 30_000 : false, refetchIntervalInBackground: false });
  const pitches = useQuery({ queryKey: ["venue-pitches"], queryFn: () => api.venue.pitches.query() });
  const overview = useQuery({ queryKey: ["owner-analytics"], queryFn: () => api.admin.analytics.query() });
  const entries = bookings.data ?? [];
  const activeCount = entries.filter((entry) => entry.status === "pending" || entry.status === "confirmed").length;
  const pendingCount = entries.filter((entry) => entry.status === "pending").length;
  const confirmedCount = entries.filter((entry) => entry.status === "confirmed").length;
  return <section className="schedule-page">
    <div className="dashboard-page-heading"><div><span className="eyebrow">{bookingsOnly ? "متابعة كل الأيام" : "التشغيل اليومي"}</span><h1>{bookingsOnly ? "كل الحجوزات" : "جدول الملعب"}</h1><p>{bookingsOnly ? "حجوزات كل الأيام — القادمة والسابقة — ظاهرة هنا ومرتبة حسب التاريخ والساعة، وتتحدث تلقائيًا كل ٣٠ ثانية." : "كل تغيير بيتحفظ قبل ما يظهر كتأكيد، ومواعيد الحجز المزدوج مرفوضة من قاعدة البيانات."}</p></div>{!bookingsOnly && <label className="date-switcher"><CalendarDays size={17} /><span>تاريخ الجدول</span><input aria-label="تاريخ الجدول" type="date" min={todayInCairo()} max={addDateDays(todayInCairo(), 370)} value={date} onChange={(event) => setDate(event.target.value)} /></label>}</div>
    <div className="summary-strip"><div><span>{bookingsOnly ? "كل الحجوزات" : "حجوزات اليوم"}</span><b>{bookingsOnly ? entries.length : overview.isLoading ? "—" : overview.data?.today.total ?? 0}</b></div><div><span>{bookingsOnly ? "بانتظار التأكيد" : "بانتظارك"}</span><b className="number-warm">{bookingsOnly ? pendingCount : overview.isLoading ? "—" : overview.data?.today.pending ?? 0}</b></div><div><span>مؤكدة</span><b>{bookingsOnly ? confirmedCount : overview.isLoading ? "—" : overview.data?.today.confirmed ?? 0}</b></div><div><span>{bookingsOnly ? "الحجوزات النشطة" : "الفترات المأخوذة"}</span><b>{activeCount}</b></div></div>
    {!bookingsOnly && <details className="manual-details"><summary><span><CalendarDays size={17} /> إضافة حجز يدوي أو أسبوعي</span><ArrowDownLeft size={17} /></summary>{pitches.isLoading ? <LoadingState label="تحميل الملاعب…" /> : pitches.isError ? <ErrorNotice>تعذر تحميل الملاعب.</ErrorNotice> : <ManualBookingForm pitches={pitches.data ?? []} initialDate={date} />}</details>}
    <div className="booking-list-head"><div><h2>{bookingsOnly ? "حجوزات كل الأيام" : formatDate(date)}</h2><p>{entries.length} حجز · {activeCount} نشط</p></div><button type="button" className="icon-button refresh-button" title="تحديث الجدول" aria-label="تحديث الجدول" onClick={() => { void bookings.refetch(); void overview.refetch(); }}><RefreshCw size={16} /></button></div>
    {bookings.isLoading ? <LoadingState label="بنحمّل جدول المواعيد…" /> : bookings.isError ? <div className="notice notice-error">{errorMessage(bookings.error, "تعذر تحميل الحجوزات.")}</div> : entries.length === 0 ? <div className="empty-state empty-dashboard"><span className="empty-mark"><Clock3 size={22} /></span><h3>{bookingsOnly ? "مفيش حجوزات لحد دلوقتي" : "اليوم فاضي لسه"}</h3><p>{bookingsOnly ? "أي حجز جديد هيظهر هنا تلقائيًا ومعاه تاريخه وميعاده." : "المواعيد اللي يحجزها العملاء هتظهر هنا. تقدر كمان تضيف حجزًا يدويًا لو فتحت النموذج."}</p></div> : <div className="booking-list">{entries.map((booking) => <BookingRow key={booking.id} booking={booking} pitches={pitches.data ?? []} onSaved={() => { void bookings.refetch(); void overview.refetch(); }} />)}</div>}
    {bookings.isRefetching && !bookings.isLoading && <p className="sync-caption"><RefreshCw size={13} /> جاري تحديث المعلومات من قاعدة البيانات…</p>}
  </section>;
}
