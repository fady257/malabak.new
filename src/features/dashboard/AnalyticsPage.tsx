import { useQuery } from "@tanstack/react-query";
import { Activity, CalendarDays, ChartNoAxesColumnIncreasing, CircleDollarSign, Clock3, UserRoundX } from "lucide-react";
import { api } from "../../app/api.js";
import { formatBusinessTime, money } from "../../app/utils.js";
import { ErrorNotice, LoadingState } from "../../components/Feedback.js";

export default function AnalyticsPage() {
  const stats = useQuery({ queryKey: ["owner-analytics"], queryFn: () => api.admin.analytics.query() });
  if (stats.isLoading) return <LoadingState label="بنحسب ملخص الأداء…" />;
  if (stats.isError || !stats.data) return <ErrorNotice>تعذر تحميل التحليلات؛ جرّب تحديث الصفحة.</ErrorNotice>;
  const data = stats.data;
  const peakMax = Math.max(1, ...data.peakStarts.map((item) => item.bookings));
  const cards = [
    { label: "حجوزات آخر ٣٠ يوم", value: String(data.last30Days.bookings), icon: CalendarDays, color: "green" },
    { label: "مبالغ مستلمة", value: money(data.last30Days.revenueEgp * 100), icon: CircleDollarSign, color: "gold" },
    { label: "متوسط الإشغال", value: `${data.last30Days.occupancyPercent}٪`, icon: Activity, color: "blue" },
    { label: "معدل عدم الحضور", value: `${data.last30Days.noShowRatePercent}٪`, icon: UserRoundX, color: "rose" },
  ];
  return <section className="analytics-page">
    <div className="dashboard-page-heading"><div><span className="eyebrow">قراءة بسيطة للأرقام</span><h1>ملخص الأداء</h1><p>إجمالي آخر ثلاثين يومًا من الحجوزات المسجلة. الإيراد يعكس المبالغ التي أدخلها المالك كمستلمة.</p></div><span className="period-pill"><Clock3 size={15} /> آخر ٣٠ يوم</span></div>
    <div className="analytics-grid">{cards.map(({ label, value, icon: Icon, color }) => <article className="analytics-card" key={label}><span className={`analytics-icon ${color}`}><Icon size={19} /></span><span className="analytics-label">{label}</span><strong>{value}</strong></article>)}</div>
    <section className="peak-card"><div className="peak-heading"><span className="settings-icon"><ChartNoAxesColumnIncreasing size={18} /></span><div><h2>الساعات الأكثر حجزًا</h2><p>بناءً على الحجوزات المؤكدة والمكتملة في آخر ٣٠ يومًا.</p></div></div>{data.peakStarts.length === 0 ? <div className="empty-state empty-dashboard"><p>بعد أول حجز مؤكد، هتظهر هنا ساعات الذروة.</p></div> : <div className="peak-bars">{data.peakStarts.map((item) => <div className="peak-bar-row" key={item.startMinute}><span>{formatBusinessTime(item.startMinute)}</span><div className="peak-track"><progress max={peakMax} value={item.bookings} aria-label={`${item.bookings} حجوزات`}>{item.bookings}</progress></div><b>{item.bookings}</b></div>)}</div>}
      <div className="analytics-footnote"><Activity size={15} /><span>الإشغال تقديري: الوحدات المحجوزة ÷ الفترات المفتوحة × الملاعب النشطة. لا يشمل الحجوزات المعلقة أو الملغاة.</span></div>
    </section>
  </section>;
}
