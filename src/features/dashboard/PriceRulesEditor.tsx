import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock3, Plus, Save, Trash2 } from "lucide-react";
import { api } from "../../app/api.js";
import { errorMessage, money } from "../../app/utils.js";
import { translateText } from "../../app/i18n.js";
import { ErrorNotice, LoadingState, SuccessNotice } from "../../components/Feedback.js";
import { SelectField, TextField } from "../../components/Fields.js";

type Pitch = Awaited<ReturnType<typeof api.venue.pitches.query>>[number];
type PriceRule = Awaited<ReturnType<typeof api.venue.priceRules.query>>[number];

const DAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const WEEKEND_MASK = (1 << 5) | (1 << 6);

function minuteToClock(value: number): string {
  const minute = ((value % 1440) + 1440) % 1440;
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}
function clockToMinute(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
}
function businessMinute(value: string, opening: number, closing: number): number {
  const minute = clockToMinute(value);
  return closing > 1440 && minute < opening ? minute + 1440 : minute;
}
function dayLabel(mask: number): string {
  const selected = DAYS.filter((_, day) => (mask & (1 << day)) !== 0);
  return selected.length === 7 ? "كل أيام الأسبوع" : selected.join("، ");
}

function PriceRuleForm({ pitches, openingMinute, closingMinute, rule, onDone }: {
  pitches: Pitch[]; openingMinute: number; closingMinute: number; rule?: PriceRule; onDone?: () => void;
}) {
  const queryClient = useQueryClient();
  const [pitchId, setPitchId] = useState(rule?.pitchId ?? "all");
  const [dayMask, setDayMask] = useState(rule?.dayMask ?? WEEKEND_MASK);
  const [start, setStart] = useState(minuteToClock(rule?.startMinute ?? Math.max(openingMinute, 18 * 60)));
  const [end, setEnd] = useState(minuteToClock(rule?.endMinute ?? closingMinute));
  const [price, setPrice] = useState(rule ? String(rule.priceEgp) : "");
  const save = useMutation({
    mutationFn: () => {
      const startMinute = businessMinute(start, openingMinute, closingMinute);
      let endMinute = businessMinute(end, openingMinute, closingMinute);
      if (closingMinute > 1440 && endMinute <= startMinute && clockToMinute(end) <= clockToMinute(start)) endMinute += 1440;
      return api.venue.savePriceRule.mutate({
        ...(rule ? { id: rule.id } : {}),
        pitchId: pitchId === "all" ? null : pitchId,
        dayMask,
        startMinute,
        endMinute,
        priceEgp: Number(price),
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["venue-price-rules"] });
      await queryClient.invalidateQueries({ queryKey: ["public-availability"] });
      if (!rule) { setPrice(""); setDayMask(WEEKEND_MASK); }
      onDone?.();
    },
  });
  const remove = useMutation({
    mutationFn: () => api.venue.deletePriceRule.mutate({ id: rule!.id }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["venue-price-rules"] });
      await queryClient.invalidateQueries({ queryKey: ["public-availability"] });
      onDone?.();
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (dayMask === 0) return;
    save.mutate();
  }

  return <form className="price-rule-form" onSubmit={submit}>
    <SelectField label="الملعب" value={pitchId} onChange={(event) => setPitchId(event.target.value)}><option value="all">كل الملاعب</option>{pitches.map((pitch) => <option key={pitch.id} value={pitch.id}>{pitch.name}</option>)}</SelectField>
    <fieldset className="day-mask-field"><legend>الأيام التي ينطبق عليها السعر</legend><div className="day-mask-list">{DAYS.map((day, index) => <label key={day} className={dayMask & (1 << index) ? "day-mask-selected" : ""}><input type="checkbox" checked={Boolean(dayMask & (1 << index))} onChange={() => setDayMask((mask) => mask ^ (1 << index))} /><span>{day}</span></label>)}</div></fieldset>
    <div className="price-time-row"><TextField label="من الساعة" type="time" step={1800} value={start} onChange={(event) => setStart(event.target.value)} required /><TextField label="إلى الساعة" type="time" step={1800} value={end} onChange={(event) => setEnd(event.target.value)} required /><TextField label="السعر (جنيه)" type="number" min="0" max="500000" step="0.5" inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} required /></div>
    {(save.isError || remove.isError) && <ErrorNotice>{errorMessage(save.error ?? remove.error)}</ErrorNotice>}
    {save.isSuccess && <SuccessNotice>اتحفظت قاعدة السعر؛ الحجوزات السابقة تحتفظ بأسعارها.</SuccessNotice>}
    <div className="price-rule-actions"><button className="button button-secondary button-small" type="submit" disabled={save.isPending || dayMask === 0}>{save.isPending ? "بنحفظ…" : <><Save size={14} /> {rule ? "حفظ التعديل" : "إضافة السعر"}</>}</button>{rule && <button className="button button-danger-quiet button-small" type="button" disabled={remove.isPending} onClick={() => { if (window.confirm(translateText("حذف قاعدة السعر؟ الحجوزات المحفوظة لن تتغير."))) remove.mutate(); }}><Trash2 size={14} /> حذف القاعدة</button>}</div>
  </form>;
}

export default function PriceRulesEditor({ pitches, openingMinute, closingMinute }: { pitches: Pitch[]; openingMinute: number; closingMinute: number }) {
  const rules = useQuery({ queryKey: ["venue-price-rules"], queryFn: () => api.venue.priceRules.query() });
  const [adding, setAdding] = useState(false);
  return <section className="price-rules-card">
    <div className="settings-section-title"><span className="settings-icon"><Clock3 size={18} /></span><div><h2>أسعار خاصة</h2><p>أضف سعر المساء أو الجمعة/السبت؛ السعر الافتراضي يظل كما هو لباقي الفترات.</p></div></div>
    <p className="price-rule-note">الأوقات بعد منتصف الليل تظل ضمن يوم العمل المختار. أسعار الحجوزات القديمة لا تتغير بعد تعديل القواعد.</p>
    {rules.isLoading ? <LoadingState label="تحميل قواعد الأسعار…" /> : rules.isError ? <ErrorNotice>{errorMessage(rules.error, "تعذر تحميل قواعد الأسعار.")}</ErrorNotice> : <div className="price-rule-list">
      {(rules.data ?? []).length === 0 && <p className="staff-empty">لا توجد قواعد خاصة؛ السعر الافتراضي المعيّن أعلاه هو المطبق على كل الأوقات.</p>}
      {(rules.data ?? []).map((rule) => <details className="price-rule-item" key={rule.id}><summary><span><b>{dayLabel(rule.dayMask)}</b><small>{minuteToClock(rule.startMinute)}–{minuteToClock(rule.endMinute)} · {rule.pitchName ?? "كل الملاعب"}</small></span><strong>{money(rule.priceEgp * 100)}</strong></summary><PriceRuleForm pitches={pitches} openingMinute={openingMinute} closingMinute={closingMinute} rule={rule} /></details>)}
      <details className="new-price-rule" open={adding} onToggle={(event) => setAdding(event.currentTarget.open)}><summary><Plus size={15} /> إضافة سعر خاص</summary>{adding && <PriceRuleForm pitches={pitches} openingMinute={openingMinute} closingMinute={closingMinute} onDone={() => setAdding(false)} />}</details>
    </div>}
  </section>;
}
