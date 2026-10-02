import { useId, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

interface SharedProps { label: string; help?: string; error?: string; className?: string }

type InputProps = SharedProps & InputHTMLAttributes<HTMLInputElement>;
export function TextField({ label, help, error, className = "", ...props }: InputProps) {
  const id = useId();
  return <label className={`field ${className}`} htmlFor={props.id ?? id}>
    <span className="field-label">{label}{props.required && <b aria-hidden="true">*</b>}</span>
    <input id={props.id ?? id} className={error ? "input has-error" : "input"} {...props} />
    {error ? <span className="field-error">{error}</span> : help ? <span className="field-help">{help}</span> : null}
  </label>;
}

type SelectProps = SharedProps & SelectHTMLAttributes<HTMLSelectElement>;
export function SelectField({ label, help, error, className = "", children, ...props }: SelectProps) {
  const id = useId();
  return <label className={`field ${className}`} htmlFor={props.id ?? id}>
    <span className="field-label">{label}{props.required && <b aria-hidden="true">*</b>}</span>
    <select id={props.id ?? id} className={error ? "input select has-error" : "input select"} {...props}>{children}</select>
    {error ? <span className="field-error">{error}</span> : help ? <span className="field-help">{help}</span> : null}
  </label>;
}

type TextareaProps = SharedProps & TextareaHTMLAttributes<HTMLTextAreaElement>;
export function TextAreaField({ label, help, error, className = "", ...props }: TextareaProps) {
  const id = useId();
  return <label className={`field ${className}`} htmlFor={props.id ?? id}>
    <span className="field-label">{label}{props.required && <b aria-hidden="true">*</b>}</span>
    <textarea id={props.id ?? id} className={error ? "input textarea has-error" : "input textarea"} {...props} />
    {error ? <span className="field-error">{error}</span> : help ? <span className="field-help">{help}</span> : null}
  </label>;
}
