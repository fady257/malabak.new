import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, ExternalLink, ImageUp, Save, ShieldCheck, Upload } from "lucide-react";
import { Link } from "react-router-dom";
import { api, uploadImage } from "../../app/api.js";
import { preparePitchPhoto } from "../../app/prepare-image.js";
import { currentIntlLocale, errorMessage } from "../../app/utils.js";
import { ErrorNotice, LoadingState, SuccessNotice } from "../../components/Feedback.js";
import { SelectField, TextAreaField, TextField } from "../../components/Fields.js";
import PriceRulesEditor from "./PriceRulesEditor.js";
import StaffSettings from "./StaffSettings.js";

type Pitch = Awaited<ReturnType<typeof api.venue.pitches.query>>[number];

function minuteToClock(value: number): string {
  const minute = ((value % 1440) + 1440) % 1440;
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}
function clockToMinute(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
}

function PitchCard({ pitch }: { pitch: Pitch }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(pitch.name);
  const [description, setDescription] = useState(pitch.description ?? "");
  const [indoor, setIndoor] = useState(pitch.indoor);
  const [active, setActive] = useState(pitch.active);
  const [message, setMessage] = useState("");
  const [problem, setProblem] = useState("");
  const [uploading, setUploading] = useState(false);
  useEffect(() => { setName(pitch.name); setDescription(pitch.description ?? ""); setIndoor(pitch.indoor); setActive(pitch.active); }, [pitch]);
  const update = useMutation({
    mutationFn: () => api.venue.updatePitch.mutate({ id: pitch.id, name, description: description.trim() || null, indoor, active }),
    onSuccess: () => { setProblem(""); setMessage("اتحفظت بيانات الملعب."); void queryClient.invalidateQueries({ queryKey: ["venue-pitches"] }); void queryClient.invalidateQueries({ queryKey: ["public-venue"] }); },
  });

  async function upload(file: File | undefined) {
    if (!file) return;
    setProblem(""); setMessage("");
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { setProblem("اختار JPEG أو PNG أو WebP فقط."); return; }
    if (file.size > 10 * 1024 * 1024) { setProblem("الصورة أكبر من الحد المسموح (10 ميجابايت)."); return; }
    setUploading(true);
    try {
      const prepared = await preparePitchPhoto(file);
      const form = new FormData(); form.set("pitchId", pitch.id); form.set("file", prepared);
      const result = await uploadImage(form);
      setMessage(`تم فحص الصورة وحفظها بأمان (${result.width} × ${result.height}).`);
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["venue-pitches"] }), queryClient.invalidateQueries({ queryKey: ["public-venue"] })]);
    } catch (error) { setProblem(errorMessage(error, "تعذر رفع الصورة.")); }
    finally { setUploading(false); }
  }

  return <details className="pitch-manage-card"><summary><span className="pitch-manage-thumb">{pitch.coverUrl ? <img src={pitch.coverUrl} alt={`غلاف ${pitch.name}`} /> : <ImageUp size={18} />}</span><span><b>{pitch.name}</b><small>{pitch.active ? "نشط للحجز" : "متوقف عن الحجز"}</small></span><span className={`status-badge tone-${pitch.active ? "success" : "muted"}`}>{pitch.indoor ? "داخلي" : "خارجي"}</span></summary>
    <div className="pitch-edit-content"><form className="pitch-edit-form" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setMessage(""); setProblem(""); update.mutate(); }}>
      <TextField label="اسم الملعب" value={name} onChange={(event) => setName(event.target.value)} required minLength={2} maxLength={100} />
      <TextAreaField label="وصف قصير" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={400} rows={2} />
      <label className="switch-row"><span><b>نوع الملعب</b><small>حدّد هل الملعب داخلي أو خارجي.</small></span><select className="input select" value={indoor ? "inside" : "outside"} onChange={(event) => setIndoor(event.target.value === "inside")}><option value="outside">خارجي</option><option value="inside">داخلي</option></select></label>
      <label className="switch-row"><span><b>حالة الحجز</b><small>لا يمكن إيقاف ملعب عليه حجوزات قادمة.</small></span><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /></label>
      {update.isError && <ErrorNotice>{errorMessage(update.error)}</ErrorNotice>}
      {message && <SuccessNotice>{message}</SuccessNotice>}
      {problem && <ErrorNotice>{problem}</ErrorNotice>}
      <button className="button button-secondary button-small" type="submit" disabled={update.isPending}>{update.isPending ? "بنحفظ…" : <><Save size={15} /> حفظ بيانات الملعب</>}</button>
    </form>
    <div className="pitch-photo-box"><div><b><ImageUp size={16} /> صورة الملعب</b><p>JPEG أو PNG أو WebP حتى 10 ميجابايت؛ تُجهّز على جهازك وتُعاد إلى WebP من دون بيانات وصفية، وبحد تخزين 1.5 ميجابايت داخل D1 المجانية.</p>{pitch.coverUrl && <img className="pitch-current-photo" src={pitch.coverUrl} alt={`صورة ${pitch.name}`} referrerPolicy="no-referrer" />}</div><label className={`button button-quiet button-small file-button ${uploading ? "disabled" : ""}`}><Upload size={15} /> {uploading ? "بنجهّز الصورة ونرفعها…" : "اختار صورة"}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={(event) => { void upload(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label></div>
    </div>
  </details>;
}

function NewPitchForm() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [indoor, setIndoor] = useState(false);
  const create = useMutation({ mutationFn: () => api.venue.createPitch.mutate({ name, description: description.trim() || null, indoor }), onSuccess: () => {
    setName(""); setDescription(""); setIndoor(false); void queryClient.invalidateQueries({ queryKey: ["venue-pitches"] });
  } });
  return <details className="new-pitch-details"><summary>إضافة ملعب جديد</summary><form className="pitch-edit-form" onSubmit={(event) => { event.preventDefault(); create.mutate(); }}>
    <TextField label="اسم الملعب" value={name} onChange={(event) => setName(event.target.value)} required minLength={2} maxLength={100} />
    <TextAreaField label="وصف (اختياري)" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={400} rows={2} />
    <label className="switch-row"><span><b>داخل الصالة؟</b></span><input type="checkbox" checked={indoor} onChange={(event) => setIndoor(event.target.checked)} /></label>
    {create.isError && <ErrorNotice>{errorMessage(create.error)}</ErrorNotice>}
    <button className="button button-primary button-small" disabled={create.isPending}>{create.isPending ? "بنضيف…" : "إضافة الملعب"}</button>
  </form></details>;
}

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ["venue-settings"], queryFn: () => api.venue.settings.query() });
  const pitches = useQuery({ queryKey: ["venue-pitches"], queryFn: () => api.venue.pitches.query() });
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [description, setDescription] = useState("");
  const [cash, setCash] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [deposit, setDeposit] = useState("0");
  const [holdMinutes, setHoldMinutes] = useState("30");
  const [duration, setDuration] = useState("60");
  const [opening, setOpening] = useState("14:00");
  const [closing, setClosing] = useState("02:00");
  const [price, setPrice] = useState("0");
  const [noticeHours, setNoticeHours] = useState("2");
  const [publicBooking, setPublicBooking] = useState(true);
  const [saved, setSaved] = useState<number | null>(null);
  useEffect(() => {
    const value = settings.data;
    if (!value) return;
    setName(value.name); setAddress(value.address ?? ""); setDescription(value.description ?? "");
    setCash(value.vodafoneCashNumber ?? ""); setWhatsapp(value.whatsappNumber ?? "");
    setDeposit(String(value.depositEgp)); setHoldMinutes(String(value.holdMinutes)); setDuration(String(value.slotLengthMinutes));
    setOpening(minuteToClock(value.openingMinute)); setClosing(minuteToClock(value.closingBusinessMinute));
    setPrice(String(value.defaultPriceEgp)); setNoticeHours(String(value.cancellationNoticeHours)); setPublicBooking(value.publicBookingEnabled);
  }, [settings.data]);
  const save = useMutation({
    mutationFn: () => {
      const openMinute = clockToMinute(opening);
      let closeMinute = clockToMinute(closing);
      if (closeMinute <= openMinute) closeMinute += 1440;
      return api.venue.updateSettings.mutate({
        name, address: address.trim() || null, description: description.trim() || null,
        vodafoneCashNumber: cash.trim() || null, whatsappNumber: whatsapp.trim() || null,
        depositEgp: Number(deposit), holdMinutes: Number(holdMinutes), slotLengthMinutes: Number(duration) as 60 | 90,
        openingMinute: openMinute, closingBusinessMinute: closeMinute, defaultPriceEgp: Number(price),
        cancellationNoticeHours: Number(noticeHours), publicBookingEnabled: publicBooking,
      });
    },
    onSuccess: (result) => { setSaved(result.savedAtMs); void queryClient.invalidateQueries({ queryKey: ["venue-settings"] }); void queryClient.invalidateQueries({ queryKey: ["public-venue"] }); },
  });

  if (settings.isLoading) return <LoadingState label="بنحمّل إعدادات المكان…" />;
  if (settings.isError || !settings.data) return <ErrorNotice>{errorMessage(settings.error, "تعذر تحميل بيانات المكان.")}</ErrorNotice>;
  const pageUrl = `/v/${encodeURIComponent(settings.data.slug)}`;
  return <section className="settings-page">
    <div className="dashboard-page-heading"><div><span className="eyebrow">تعديل واضح وحفظ صريح</span><h1>المكان والملاعب</h1><p>غيّر ساعات العمل أو السعر واحفظ. إذا كان الإعداد الجديد يتعارض مع حجوزات قادمة، النظام يوقف التغيير ويشرح السبب.</p></div><Link className="public-link settings-open-link" to={pageUrl} target="_blank" rel="noopener noreferrer">صفحة الحجز <ExternalLink size={15} /></Link></div>
    <form className="settings-card" onSubmit={(event) => { event.preventDefault(); setSaved(null); save.mutate(); }}>
      <div className="settings-section-title"><span className="settings-icon"><Building2 size={18} /></span><div><h2>بيانات المكان</h2><p>المعلومات اللي تظهر للعميل عند اختيار الملعب.</p></div></div>
      <div className="settings-grid"><TextField label="اسم المكان" value={name} onChange={(event) => setName(event.target.value)} required minLength={2} maxLength={160} /><TextField label="العنوان" value={address} onChange={(event) => setAddress(event.target.value)} maxLength={240} /><TextAreaField className="settings-wide" label="وصف المكان" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={600} rows={3} help="نص قصير وواضح يظهر للعميل." /><TextField label="فودافون كاش" type="tel" inputMode="tel" value={cash} onChange={(event) => setCash(event.target.value)} maxLength={32} /><TextField label="واتساب التواصل" type="tel" inputMode="tel" value={whatsapp} onChange={(event) => setWhatsapp(event.target.value)} maxLength={32} help="يستخدم رابط واتساب جاهز؛ لا تُرسل رسائل تلقائيًا." /></div>
      <div className="settings-section-title settings-subsection"><span className="settings-icon"><Save size={18} /></span><div><h2>المواعيد والأسعار</h2><p>كل الأوقات بتتفسر على توقيت القاهرة؛ الإغلاق الأقل من الفتح يعني بعد منتصف الليل.</p></div></div>
      <div className="settings-grid"><TextField label="يفتح" type="time" step={1800} value={opening} onChange={(event) => setOpening(event.target.value)} required /><TextField label="يقفل" type="time" step={1800} value={closing} onChange={(event) => setClosing(event.target.value)} required /><SelectField label="مدة الحجز" value={duration} onChange={(event) => setDuration(event.target.value)}><option value="60">٦٠ دقيقة</option><option value="90">٩٠ دقيقة</option></SelectField><TextField label="السعر الافتراضي (جنيه)" type="number" min="0" max="500000" step="0.5" value={price} onChange={(event) => setPrice(event.target.value)} required /><TextField label="العربون (جنيه)" type="number" min="0" max="500000" step="0.5" value={deposit} onChange={(event) => setDeposit(event.target.value)} required /><TextField label="مهلة تأكيد الطلب (دقيقة)" type="number" min="5" max="240" value={holdMinutes} onChange={(event) => setHoldMinutes(event.target.value)} required /><TextField label="آخر وقت للإلغاء (ساعات قبل الموعد)" type="number" min="0" max="168" value={noticeHours} onChange={(event) => setNoticeHours(event.target.value)} required /></div>
      <label className="public-toggle"><span className="toggle-icon"><ShieldCheck size={18} /></span><span><b>السماح بالحجز العام</b><small>عند الإيقاف تختفي صفحة العميل، وتبقى لوحة الإدارة متاحة.</small></span><input type="checkbox" checked={publicBooking} onChange={(event) => setPublicBooking(event.target.checked)} /></label>
      {save.isError && <ErrorNotice>{errorMessage(save.error)}</ErrorNotice>}{saved && <SuccessNotice>اتحفظت الإعدادات في {new Intl.DateTimeFormat(currentIntlLocale(), { timeStyle: "short" }).format(new Date(saved))}. كل صفحة الحجز اتحدثت.</SuccessNotice>}
      <div className="settings-save-row"><button className="button button-primary" type="submit" disabled={save.isPending}>{save.isPending ? "بنحفظ التغييرات…" : <><Save size={16} /> حفظ التغييرات</>}</button><span>ما بنعلنش نجاح قبل ما قاعدة البيانات تأكد الحفظ.</span></div>
    </form>
    <PriceRulesEditor pitches={pitches.data ?? []} openingMinute={settings.data.openingMinute} closingMinute={settings.data.closingBusinessMinute} />
    <section className="pitches-settings"><div className="settings-section-title"><span className="settings-icon"><ImageUp size={18} /></span><div><h2>ملاعب المكان</h2><p>صورة واحدة لكل ملعب؛ رفع صورة جديدة يستبدل القديمة بشكل آمن.</p></div></div>
      {pitches.isLoading ? <LoadingState label="تحميل الملاعب…" /> : pitches.isError ? <ErrorNotice>تعذر تحميل بيانات الملاعب.</ErrorNotice> : <div className="pitch-manage-list">{(pitches.data ?? []).map((pitch) => <PitchCard key={pitch.id} pitch={pitch} />)}<NewPitchForm /></div>}
    </section>
    <StaffSettings />
  </section>;
}
