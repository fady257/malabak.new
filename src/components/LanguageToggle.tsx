import { Languages } from "lucide-react";
import { useLocale } from "../app/i18n.js";

export default function LanguageToggle() {
  const { locale, toggleLocale } = useLocale();
  return <button className="language-toggle" type="button" onClick={toggleLocale} aria-label={locale === "ar" ? "Switch language to English" : "غيّر اللغة إلى العربية"} title={locale === "ar" ? "English" : "العربية"}>
    <Languages size={15} aria-hidden="true" /> <span>{locale === "ar" ? "EN" : "عربي"}</span>
  </button>;
}
