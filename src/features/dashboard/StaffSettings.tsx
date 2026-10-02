import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserRoundPlus, UserRoundX } from "lucide-react";
import { api } from "../../app/api.js";
import { errorMessage } from "../../app/utils.js";
import { ErrorNotice, LoadingState, SuccessNotice } from "../../components/Feedback.js";
import { TextField } from "../../components/Fields.js";

type StaffMember = Awaited<ReturnType<typeof api.venue.staffList.query>>[number];

export default function StaffSettings() {
  const queryClient = useQueryClient();
  const staff = useQuery({ queryKey: ["venue-staff"], queryFn: () => api.venue.staffList.query() });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [problem, setProblem] = useState("");
  const active = useMutation({
    mutationFn: (member: StaffMember) => api.venue.setStaffActive.mutate({ userId: member.id, active: !member.active }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["venue-staff"] }); },
  });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(""); setProblem(""); setSaving(true);
    try {
      const result = await api.venue.addStaff.mutate({ email, password });
      setMessage(`تم إنشاء حساب ${result.email}. لن نرسل كلمة المرور آليًا؛ شاركها مع الموظف عبر وسيلة آمنة.`);
      setEmail("");
      await queryClient.invalidateQueries({ queryKey: ["venue-staff"] });
    } catch (error) {
      setProblem(errorMessage(error, "تعذر إنشاء حساب الموظف."));
    } finally {
      setPassword("");
      setSaving(false);
    }
  }

  return <section className="staff-settings-card">
    <div className="settings-section-title"><span className="settings-icon"><UserRoundPlus size={18} /></span><div><h2>فريق الحجوزات</h2><p>الموظف يقدر يدير الحجوزات فقط؛ إعدادات المكان والتقارير للمالك.</p></div></div>
    {staff.isLoading ? <LoadingState label="تحميل حسابات الفريق…" /> : staff.isError ? <ErrorNotice>{errorMessage(staff.error, "تعذر تحميل حسابات الفريق.")}</ErrorNotice> : <div className="staff-list">
      {(staff.data ?? []).length === 0 && <p className="staff-empty">لا يوجد موظفون مضافون.</p>}
      {(staff.data ?? []).map((member) => <article className="staff-row" key={member.id}><div><b>{member.email}</b><small>{member.active ? "حساب فعال · إدارة الحجوزات" : "حساب موقوف"}</small></div><button className={member.active ? "button button-quiet button-small" : "button button-secondary button-small"} type="button" disabled={active.isPending} onClick={() => active.mutate(member)}>{member.active ? <><UserRoundX size={14} /> إيقاف الحساب</> : "إعادة التفعيل"}</button></article>)}
    </div>}
    {active.isError && <ErrorNotice>{errorMessage(active.error)}</ErrorNotice>}
    {message && <SuccessNotice>{message}</SuccessNotice>}
    {problem && <ErrorNotice>{problem}</ErrorNotice>}
    <form className="staff-add-form" onSubmit={(event) => void submit(event)}>
      <TextField label="بريد الموظف" type="email" autoComplete="off" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} />
      <TextField label="كلمة مرور أولية يحددها المالك" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={14} maxLength={128} help="١٤ حرفًا على الأقل. لا تُرسل تلقائيًا." />
      <button className="button button-secondary button-small" type="submit" disabled={saving}>{saving ? "بننشئ الحساب…" : <><UserRoundPlus size={15} /> إضافة موظف</>}</button>
    </form>
  </section>;
}
