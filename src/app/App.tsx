import { useEffect } from "react";
import { Link, Navigate, Route, Routes } from "react-router-dom";
import { useLocale } from "./i18n.js";
import HomePage from "../features/public/HomePage.js";
import BookingPage from "../features/public/BookingPage.js";
import ManageBookingPage from "../features/public/ManageBookingPage.js";
import LoginPage, { SetupPage } from "../features/auth/AuthPages.js";
import DashboardLayout from "../features/dashboard/DashboardLayout.js";
import SchedulePage from "../features/dashboard/SchedulePage.js";
import SettingsPage from "../features/dashboard/SettingsPage.js";
import AnalyticsPage from "../features/dashboard/AnalyticsPage.js";

function NotFound() {
  return <main className="not-found"><span className="brand-mark"><span /></span><p className="eyebrow">الصفحة دي مش موجودة</p><h1>شكلنا خرجنا من الملعب.</h1><Link className="button button-primary" to="/">ارجع للرئيسية</Link></main>;
}

export default function App() {
  const { locale } = useLocale();
  useEffect(() => {
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);
  return <div data-locale={locale}><Routes>
    <Route path="/" element={<HomePage />} />
    <Route path="/v/:slug" element={<BookingPage />} />
    <Route path="/manage-booking" element={<ManageBookingPage />} />
    <Route path="/dashboard/login" element={<LoginPage />} />
    <Route path="/dashboard/setup" element={<SetupPage />} />
    <Route path="/dashboard" element={<DashboardLayout bookingsOnly><SchedulePage bookingsOnly /></DashboardLayout>} />
    <Route path="/dashboard/schedule" element={<DashboardLayout><SchedulePage /></DashboardLayout>} />
    <Route path="/dashboard/bookings" element={<DashboardLayout bookingsOnly><SchedulePage bookingsOnly /></DashboardLayout>} />
    <Route path="/dashboard/settings" element={<DashboardLayout><SettingsPage /></DashboardLayout>} />
    <Route path="/dashboard/analytics" element={<DashboardLayout><AnalyticsPage /></DashboardLayout>} />
    <Route path="/admin" element={<Navigate to="/dashboard" replace />} />
    <Route path="*" element={<NotFound />} />
  </Routes></div>;
}
