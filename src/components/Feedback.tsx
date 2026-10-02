import { AlertCircle, CheckCircle2, Info, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";

export function LoadingState({ label = "بنحمّل…" }: { label?: string }) {
  return <div className="route-loading"><LoaderCircle className="spinner-icon" size={19} /> <span>{label}</span></div>;
}

export function ErrorNotice({ children }: { children: ReactNode }) {
  return <div className="notice notice-error" role="alert"><AlertCircle size={17} /> <span>{children}</span></div>;
}

export function SuccessNotice({ children }: { children: ReactNode }) {
  return <div className="notice notice-success" role="status"><CheckCircle2 size={17} /> <span>{children}</span></div>;
}

export function InfoNotice({ children }: { children: ReactNode }) {
  return <div className="notice notice-info"><Info size={17} /> <span>{children}</span></div>;
}
