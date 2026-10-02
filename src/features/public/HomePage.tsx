import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowUpLeft, CalendarDays, Clock3, MapPin, ShieldCheck, Trophy } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../../app/api.js";
import LanguageToggle from "../../components/LanguageToggle.js";

export default function HomePage() {
  const venue = useQuery({ queryKey: ["public-venue-default"], queryFn: () => api.venue.publicDefault.query() });
  const setup = useQuery({ queryKey: ["bootstrap-state"], queryFn: () => api.auth.bootstrapState.query() });
  const place = venue.data;

  return <main className="public-shell">
    <header className="public-nav wrap">
      <Link to="/" className="brand" aria-label="ملعبك — الصفحة الرئيسية"><span className="brand-mark"><span /></span><span className="brand-name">ملعبك</span></Link>
      <nav aria-label="التنقل الرئيسي">
        <Link to="/manage-booking" className="nav-link">إدارة حجزي</Link>
        <Link to="/dashboard/login" className="nav-owner">دخول المالك <ArrowUpLeft size={15} /></Link>
        <LanguageToggle />
      </nav>
    </header>

    <section className="hero wrap">
      <div className="hero-copy">
        <span className="eyebrow"><span className="eyebrow-dot" /> مواعيد واضحة. ملعبك جاهز.</span>
        <h1>الملعب اللي في بالك،<br /><em>احجزه من هنا.</em></h1>
        <p>اختار الملعب والساعة المناسبة. هتعرف السعر وحالة الموعد قبل ما تأكد طلبك — ومواعيدك تفضل واضحة قدامك.</p>
        <div className="hero-actions">
          {place ? <a className="button button-primary" href="#pitches">اختار ملعبك <ArrowLeft size={17} /></a> : <Link className="button button-primary" to="/dashboard/setup">جهّز صفحة المكان <ArrowLeft size={17} /></Link>}
          <Link to="/manage-booking" className="button button-quiet">تابع حجزك</Link>
        </div>
        <div className="hero-assurance"><ShieldCheck size={17} /><span>بياناتك محفوظة بأمان، ورمز الحجز يخصك وحدك.</span></div>
      </div>
      <div className="hero-visual" aria-label="رسم تجريدي لملعب كرة قدم">
        <div className="field-art"><div className="field-midline" /><div className="field-circle" /><div className="field-box field-box-top" /><div className="field-box field-box-bottom" /><div className="field-ball"><span /></div></div>
        <div className="float-tag tag-time"><Clock3 size={15} /><span>موعدك، على اختيارك</span></div>
        <div className="float-tag tag-booking"><CalendarDays size={15} /><span>حجز واضح من البداية</span></div>
        <div className="hero-stamp"><Trophy size={18} /><span>يلا نلعب</span></div>
      </div>
    </section>

    <section className="venue-section wrap" id="pitches">
      <div className="section-heading">
        <div><span className="eyebrow">الوجهة</span><h2>{venue.isLoading ? "بنجهّز مواعيدك…" : place?.name ?? "صفحة ملعبك"}</h2>{place?.address && <p className="muted"><MapPin size={15} /> {place.address}</p>}</div>
        {place && <span className="section-count">{place.pitches.length} ملاعب</span>}
      </div>
      {venue.isLoading ? <div className="skeleton-card" /> : venue.isError ? <div className="notice notice-warning">صفحة الحجز غير متاحة مؤقتًا. جرّب بعد قليل أو تواصل مع الملعب.</div> : !place ? <div className="empty-state"><span className="empty-mark"><Trophy size={24} /></span><h3>لسه ما فيش مكان منشور</h3><p>{setup.data?.setupAvailable ? "ابدأ بإعداد حساب المالك وساعات العمل، وبعدها هتظهر الملاعب هنا." : "هيظهر الحجز هنا بمجرد تفعيل صفحة المكان."}</p>{setup.data?.setupAvailable && <Link to="/dashboard/setup" className="button button-primary">إعداد حساب المالك</Link>}</div> : place.pitches.length === 0 ? <div className="empty-state"><h3>الملاعب هتظهر هنا قريبًا</h3><p>تواصل مع المكان لمعرفة المواعيد المتاحة.</p></div> : <div className="pitch-list">
        {place.pitches.map((pitch, index) => <article className="pitch-card" key={pitch.id}>
          <div className="pitch-image-wrap">
            {pitch.coverUrl ? <img className="pitch-image" src={pitch.coverUrl} alt={`صورة ${pitch.name}`} loading="lazy" /> : <div className={`pitch-placeholder pitch-placeholder-${index % 3}`} aria-hidden="true"><span className="mini-pitch"><i /></span></div>}
            <span className="pitch-number">{String(index + 1).padStart(2, "0")}</span>
          </div>
          <div className="pitch-info"><div><span className="pitch-subtitle">ملعب خماسي {pitch.indoor ? "داخلي" : "خارجي"}</span><h3>{pitch.name}</h3><p>{pitch.description || "اختار ميعاد مناسب وشوف السعر والتفاصيل قبل الحجز."}</p></div><Link className="round-link" to={`/v/${encodeURIComponent(place.slug)}`} aria-label={`احجز ${pitch.name}`}><ArrowLeft size={18} /></Link></div>
        </article>)}
      </div>}
    </section>

    <section className="how-section wrap"><div className="how-intro"><span className="eyebrow">على ثلاث خطوات</span><h2>الحجز من غير لف.</h2></div><div className="how-steps"><div><b>01</b><h3>اختار اليوم والملعب</h3><p>المواعيد المتاحة بس هي اللي هتقدر تختارها.</p></div><div><b>02</b><h3>اكتب بيانات الحجز</h3><p>رمز الحجز خاص بيك؛ احتفظ به علشان تتابع طلبك.</p></div><div><b>03</b><h3>تابع التأكيد</h3><p>تقدر تستعلم عن الحجز أو تطلب إلغاءه من صفحة إدارة حجزي.</p></div></div></section>

    <footer className="public-footer wrap"><Link to="/" className="brand brand-small"><span className="brand-mark"><span /></span><span className="brand-name">ملعبك</span></Link><span>وقت لعبك، متظبط.</span><Link to="/manage-booking">إدارة الحجز <ArrowLeft size={14} /></Link></footer>
  </main>;
}
