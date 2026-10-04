import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, KeyRound, ShieldCheck } from "lucide-react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { api } from "../../app/api.js";
import { errorMessage } from "../../app/utils.js";
import { SelectField, TextField } from "../../components/Fields.js";
import LanguageToggle from "../../components/LanguageToggle.js";

function AuthFrame({ children, title, eyebrow }: { children: React.ReactNode; title: string; eyebrow: string }) {
  return <main className="auth-shell"><div className="auth-brand"><Link to="/" className="brand"><span className="brand-mark"><span /></span><span className="brand-name">ملعبك</span></Link><LanguageToggle /></div><section className="auth-card"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1>{children}</section><p className="auth-footnote"><ShieldCheck size={15} /> جلسة مشفرة وبيانات دخول لا تُرسل لأي طرف آخر.</p></main>;
}

export default function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const bootstrap = useQuery({ queryKey: ["bootstrap-state"], queryFn: () => api.auth.bootstrapState.query() });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const login = useMutation({
    mutationFn: () => api.auth.login.mutate({ email, password }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["owner-me"] }); navigate("/dashboard", { replace: true }); },
  });
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); login.mutate(); }

  return <AuthFrame eyebrow="منطقة المالك" title="ادخل على ملعبك.">
    <p className="auth-lede">الجدول والحجوزات وإعدادات المكان — من مكان واحد.</p>
    <form className="stack-form" onSubmit={submit}>
      <TextField label="البريد الإلكتروني" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="username" maxLength={254} placeholder="البريد المسموح للمالك" />
      <TextField label="كلمة المرور" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="current-password" maxLength={128} />
      {login.isError && <div className="notice notice-error" role="alert">{errorMessage(login.error)}</div>}
      <button className="button button-primary button-wide" type="submit" disabled={login.isPending}>{login.isPending ? "بنتحقق من البيانات…" : <>تسجيل الدخول <ArrowRight size={16} /></>}</button>
    </form>
    {bootstrap.data?.setupAvailable && <p className="auth-switch">أول مرة؟ <Link to="/dashboard/setup">أنشئ حساب المالك</Link></p>}
    <Link className="auth-back" to="/"><ArrowRight size={15} /> رجوع للموقع</Link>
  </AuthFrame>;
}

export function SetupPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const bootstrap = useQuery({ queryKey: ["bootstrap-state"], queryFn: () => api.auth.bootstrapState.query() });
  const [setupToken, setSetupToken] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [venueName, setVenueName] = useState("");
  const [slug, setSlug] = useState("malabak");
  const [address, setAddress] = useState("");
  const [cashNumber, setCashNumber] = useState("");
  const [deposit, setDeposit] = useState("0");
  const [price, setPrice] = useState("");
  const [holdMinutes, setHoldMinutes] = useState("30");
  const [duration, setDuration] = useState("60");
  const [opening, setOpening] = useState("14:00");
  const [closing, setClosing] = useState("02:00");
  const [localError, setLocalError] = useState("");

  const setup = useMutation({
    mutationFn: () => api.auth.setupOwner.mutate({
      setupToken, email, password, venueName, slug, address: address.trim() || null,
      vodafoneCashNumber: cashNumber.trim() || null, depositEgp: Number(deposit), priceEgp: Number(price),
      holdMinutes: Number(holdMinutes), slotLengthMinutes: Number(duration) as 60 | 90,
      openingTime: opening, closingTime: closing,
    }),
    onSuccess: () => { void queryClient.invalidateQueries(); navigate("/dashboard", { replace: true }); },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError("");
    if (password !== confirmPassword) { setLocalError("كلمتا المرور مش متطابقتين."); return; }
    if (Number(price) < 0 || !Number.isFinite(Number(price))) { setLocalError("اكتب سعرًا صحيحًا للموعد."); return; }
    setup.mutate();
  }

  if (!bootstrap.isLoading && !bootstrap.isError && !bootstrap.data?.setupAvailable) return <Navigate to="/dashboard/login" replace />;

  return <AuthFrame eyebrow="إعداد أول مرة — مرة واحدة فقط" title="جهّز المكان على مزاجك.">
    <p className="auth-lede">اختار كلمة مرور قوية؛ مش هنحط كلمة افتراضية أو نطلبها منك في المحادثة.</p>
    {bootstrap.isError && <div className="notice notice-warning">الخادم غير جاهز للإعداد بعد. راجع إعدادات تشغيل D1 والأسرار.</div>}
    {bootstrap.data?.setupAvailable && <form className="stack-form setup-form" onSubmit={submit}>
      <TextField label="رمز التهيئة لمرة واحدة" type="password" value={setupToken} onChange={(event) => setSetupToken(event.target.value)} required minLength={32} maxLength={256} autoComplete="off" help="تجده في OWNER_SETUP_TOKEN داخل ملف .dev.vars المحلي؛ لا تشاركه." />
      <TextField label="بريد المالك المسموح" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="username" maxLength={254} placeholder="اكتب بريد المالك" />
      <TextField label="اسم المكان" value={venueName} onChange={(event) => setVenueName(event.target.value)} required minLength={2} maxLength={160} placeholder="مثال: ملعب الحي" />
      <TextField label="رابط المكان المختصر" value={slug} onChange={(event) => setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} required minLength={2} maxLength={80} dir="ltr" help="حروف إنجليزية صغيرة وأرقام وشرطة فقط." />
      <TextField label="عنوان المكان (اختياري)" value={address} onChange={(event) => setAddress(event.target.value)} maxLength={240} />
      <div className="form-divider"><span>ساعات العمل والتسعير</span></div>
      <div className="form-row"><TextField label="يفتح" type="time" step={1800} value={opening} onChange={(event) => setOpening(event.target.value)} required /><TextField label="يقفل" type="time" step={1800} value={closing} onChange={(event) => setClosing(event.target.value)} required help="وقت إغلاق أصغر من الفتح يعني بعد منتصف الليل." /></div>
      <SelectField label="مدة الحجز" value={duration} onChange={(event) => setDuration(event.target.value)}><option value="60">٦٠ دقيقة</option><option value="90">٩٠ دقيقة</option></SelectField>
      <TextField label="سعر الموعد (جنيه)" type="number" inputMode="decimal" step="0.5" min="0" value={price} onChange={(event) => setPrice(event.target.value)} required />
      <TextField label="العربون (جنيه)" type="number" inputMode="decimal" step="0.5" min="0" value={deposit} onChange={(event) => setDeposit(event.target.value)} required help="اكتب 0 لو مش بتطلب عربون." />
      <TextField label="مهلة الحجز المعلق (دقيقة)" type="number" min="5" max="240" value={holdMinutes} onChange={(event) => setHoldMinutes(event.target.value)} required />
      <TextField label="رقم فودافون كاش (اختياري)" type="tel" inputMode="tel" value={cashNumber} onChange={(event) => setCashNumber(event.target.value)} maxLength={32} />
      <div className="password-rules"><KeyRound size={17} /><span>كلمة المرور: ١٤ حرفًا على الأقل، وفيها ١٢ حرفًا على الأقل غير المسافات. اخترها بنفسك.</span></div>
      <TextField label="كلمة المرور" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={14} maxLength={128} autoComplete="new-password" />
      <TextField label="أكد كلمة المرور" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required minLength={14} maxLength={128} autoComplete="new-password" />
      {(localError || setup.isError) && <div className="notice notice-error" role="alert">{localError || errorMessage(setup.error)}</div>}
      <button className="button button-primary button-wide" type="submit" disabled={setup.isPending || bootstrap.isLoading}>{setup.isPending ? "بنحفظ الحساب بأمان…" : "إنشاء حساب المالك"}</button>
    </form>}
    <Link className="auth-back" to="/"><ArrowRight size={15} /> رجوع للموقع</Link>
  </AuthFrame>;
}
