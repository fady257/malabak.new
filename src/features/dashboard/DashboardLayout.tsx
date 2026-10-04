import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, CalendarDays, ExternalLink, LayoutDashboard, LogOut, Settings2 } from "lucide-react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { api } from "../../app/api.js";
import { LoadingState } from "../../components/Feedback.js";
import LanguageToggle from "../../components/LanguageToggle.js";

const items = [
  { to: "/dashboard", label: "الحجوزات القادمة", icon: LayoutDashboard, match: ["/dashboard", "/dashboard/bookings"] },
  { to: "/dashboard/schedule", label: "جدول اليوم", icon: CalendarDays, match: ["/dashboard/schedule"] },
  { to: "/dashboard/settings", label: "المكان والملاعب", icon: Settings2, match: ["/dashboard/settings"] },
  { to: "/dashboard/analytics", label: "ملخص الأداء", icon: BarChart3, match: ["/dashboard/analytics"] },
];

export default function DashboardLayout({ children, bookingsOnly = false }: { children: React.ReactNode; bookingsOnly?: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ["owner-me"], queryFn: () => api.auth.me.query(), retry: false });
  const logout = useMutation({ mutationFn: () => api.auth.logout.mutate(), onSuccess: () => {
    queryClient.clear();
    navigate("/dashboard/login", { replace: true });
  } });

  if (me.isLoading) return <LoadingState label="بنتأكد من جلسة الدخول…" />;
  if (me.isError || !me.data) return <Navigate to="/dashboard/login" replace state={{ from: location.pathname }} />;
  const activePage = location.pathname;
  if (me.data.role !== "owner" && ["/dashboard/settings", "/dashboard/analytics"].includes(activePage)) return <Navigate to="/dashboard" replace />;
  return <main className="dashboard-shell">
    <aside className="dashboard-sidebar">
      <Link to="/" className="brand dashboard-brand"><span className="brand-mark"><span /></span><span className="brand-name">ملعبك</span><small>إدارة المكان</small></Link>
      <div className="sidebar-caption">المساحة</div>
      <nav className="dashboard-nav" aria-label="أقسام لوحة الإدارة">
        {items.filter(({ to }) => me.data.role === "owner" || !["/dashboard/settings", "/dashboard/analytics"].includes(to)).map(({ to, label, icon: Icon, match }) => <Link key={to} to={to} className={match.includes(activePage) ? "dashboard-nav-link active" : "dashboard-nav-link"}><Icon size={18} /><span>{label}</span>{match.includes(activePage) && <i />}</Link>)}
      </nav>
      <div className="sidebar-place"><span className="place-dot" /><div><small>المكان الحالي</small><b>{me.data.venueName}</b></div></div>
      <div className="sidebar-bottom"><span className="avatar-initial">{me.data.venueName.slice(0, 1)}</span><div className="owner-id"><b>{me.data.role === "owner" ? "حساب المالك" : "حساب الفريق"}</b><small>بيانات الحساب خاصة</small></div><button className="icon-button" type="button" aria-label="تسجيل الخروج" title="تسجيل الخروج" disabled={logout.isPending} onClick={() => logout.mutate()}><LogOut size={17} /></button></div>
    </aside>
    <section className="dashboard-main">
      <header className="dashboard-topbar"><div><span className="topbar-eyebrow">لوحة المكان</span><strong>{me.data.venueName}</strong></div><div className="topbar-actions"><Link to={`/v/${encodeURIComponent(me.data.venueSlug)}`} className="public-link" target="_blank" rel="noopener noreferrer">عرض صفحة الحجز <ExternalLink size={15} /></Link><span className="secure-pill"><span /> محمي</span><LanguageToggle /></div></header>
      <div className="mobile-dashboard-nav">{items.filter(({ to }) => me.data.role === "owner" || !["/dashboard/settings", "/dashboard/analytics"].includes(to)).map(({ to, label, icon: Icon, match }) => <Link key={to} to={to} className={match.includes(activePage) ? "mobile-nav-link active" : "mobile-nav-link"}><Icon size={17} /><span>{label}</span></Link>)}</div>
      {logout.isError && <div className="dashboard-alert">تعذر تسجيل الخروج. حاول مرة أخرى.</div>}
      <div className={bookingsOnly ? "dashboard-content bookings-only" : "dashboard-content"}>{children}</div>
    </section>
  </main>;
}
