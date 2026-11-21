"use client";
import { useState } from "react";
import { Shell } from "@/components/Shell";
import { EmptyCard, ErrorNote, Kpi, PageHead, Pill, T, useAction } from "@/components/ui";
import { api } from "@/lib/api";
import { fmt, today, ugx, when } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { Me, useData } from "@/lib/session";

type DebtVisit = { id: number; exam: string; copies: number; price: number; debt: number; date: string; due: string | null; overdue: boolean; age_days: number; sales: string };
type Note = { id: number; text: string; promised_amount: number | null; promised_date: string | null; by: string; created_at: string };
type School = {
  id: number; school: string; district: string; contact: string; phone: string; total: number; visits: DebtVisit[];
  chase_date: string | null; overdue: boolean; broken_promise: string; notes: Note[]; whatsapp_sent: { kind: string; status: string; created_at: string }[];
  wa_phone: string; reminder_text: string;
};
type Debts = { schools: School[]; total: number; ageing: { under_30: number; "30_60": number; over_60: number }; auto_whatsapp: boolean };

const KIND: Record<string, string> = { before_due: "Friendly reminder", overdue: "Overdue reminder", weekly: "Weekly reminder" };

export default function DebtsPage() {
  return <Shell allow={["owner", "sales"]}>{(me) => <DebtsScreen me={me} />}</Shell>;
}

function DebtsScreen({ me }: { me: Me }) {
  const d = useData<Debts>("summary/debts");
  const data = d.data;
  return (
    <>
      <ErrorNote error={d.error} />
      <PageHead title={me.role === "sales" ? "My schools that owe" : "Debts"} sub={<>Record money as soon as a school pays. Note every promise a school makes; reminders follow the promised date.{me.role === "sales" ? " Cash you collect is added to what you must hand in." : ""}</>} />
      <div className="kpis">
        <Kpi label="Total owed" value={fmt(data?.total)} bad={(data?.total ?? 0) > 0} />
        <Kpi label="Under 30 days" value={fmt(data?.ageing.under_30)} />
        <Kpi label="30–60 days" value={fmt(data?.ageing["30_60"])} />
        <Kpi label="Over 60 days" value={fmt(data?.ageing.over_60)} bad={(data?.ageing.over_60 ?? 0) > 0} />
      </div>
      {data && <p className="mini" style={{ margin: 0 }}>{data.auto_whatsapp
        ? "WhatsApp reminders go to schools automatically: 2 days before the promised date, when it is missed, then weekly."
        : "Automatic WhatsApp reminders are not switched on yet, so use the green “Remind on WhatsApp” button. It opens WhatsApp with the message written."}</p>}
      {data?.schools.length ? data.schools.map((s) => <Debtor key={s.id} s={s} me={me} onChange={d.reload} />) : <EmptyCard icon="check">No schools owe money right now.</EmptyCard>}
      {me.role === "owner" && data && data.total > 0 && <p className="mini">Biggest debtor: {data.schools[0].school}, {ugx(data.schools[0].total)}.</p>}
    </>
  );
}

function Debtor({ s, me, onChange }: { s: School; me: Me; onChange: () => void }) {
  const { busy, run } = useAction();
  const { t } = useT();
  const [noting, setNoting] = useState(false);
  const [paying, setPaying] = useState(false);
  const wa = `https://wa.me/${s.wa_phone}?text=${encodeURIComponent(s.reminder_text)}`;
  return (
    <div className="ticket">
      <div className="head">
        <div className="t"><h3>{s.school}</h3><p className="sub">{[s.district, s.contact, s.phone].filter(Boolean).join(" · ") || "No contact recorded"}</p></div>
        <div style={{ textAlign: "right" }}><div className="big" style={{ fontSize: "1.4rem", color: "var(--bad)" }}>{fmt(s.total)}</div><div className="mini">UGX owed</div></div>
      </div>

      {s.broken_promise && <div className="banner" style={{ background: "var(--bad-soft)", color: "var(--bad)" }}><b>Promise broken.</b> {s.broken_promise}</div>}
      {s.chase_date && <p style={{ margin: 0 }}>{s.notes.some((n) => n.promised_date) ? "Promised to pay by" : "Due by"} <b>{when(s.chase_date)}</b> {s.overdue && <Pill cls="p-bad">Overdue</Pill>}</p>}

      <div className="row">
        {s.wa_phone ? <a className="btnlink" href={wa} target="_blank" rel="noopener">Remind on WhatsApp</a> : <span className="mini">Add the school&apos;s phone on Schools to remind them on WhatsApp.</span>}
        {s.phone && <a className="ghostlink" href={`tel:${s.phone}`}>Call</a>}
        <button type="button" className="ghost" onClick={() => setNoting((x) => !x)}>Add note or promise</button>
        <button type="button" className="ghost" onClick={() => setPaying((x) => !x)}><T>Record payment</T></button>
      </div>

      {noting && (
        <form className="panel" style={{ background: "var(--surface-2)" }} onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget, f = new FormData(form);
          const ok = await run(() => api("debt-notes", { body: { school: s.id, text: f.get("text"), promised_amount: f.get("amount") || null, promised_date: f.get("date") || null } }), "Note saved");
          if (ok) { form.reset(); setNoting(false); onChange(); }
        }}>
          <label>What did they say?<textarea name="text" required placeholder="e.g. Bursar says they will pay half on Friday after the PTA meeting" /></label>
          <div className="grid2">
            <label>Promised amount (UGX, optional)<input name="amount" type="number" min={1} inputMode="numeric" /></label>
            <label>Promised date (optional)<input name="date" type="date" min={today()} /></label>
          </div>
          <p className="mini" style={{ margin: 0 }}>With a promised date, reminders follow it, and you are told if the promise is broken.</p>
          <div><button disabled={busy}>Save note</button></div>
        </form>
      )}

      {paying && (
        <form className="panel" style={{ background: "var(--surface-2)" }} onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget, f = new FormData(form);
          const ok = await run(() => api("payments", { body: { visit: Number(f.get("visit")), amount: Number(f.get("amount")), method: f.get("method"), momo_id: f.get("momo_id") || "" } }), "Payment recorded");
          if (ok) { form.reset(); setPaying(false); onChange(); }
        }}>
          <div className="grid2">
            <label>Against<select name="visit">{s.visits.map((v) => <option key={v.id} value={v.id}>{v.exam} ({fmt(v.debt)})</option>)}</select></label>
            <label>Amount received (UGX)<input name="amount" type="number" min={1} inputMode="numeric" required /></label>
            <label>Paid by<select name="method"><option value="cash">Cash</option><option value="momo">Mobile money (to business number)</option></select></label>
            <label>Mobile money ID (if mobile money)<input name="momo_id" placeholder="From the payment SMS" /></label>
          </div>
          <div><button disabled={busy}>{t("Record payment")}</button></div>
        </form>
      )}

      <ul className="feed">
        {s.visits.map((v) => (
          <li key={v.id}><time>{when(v.date)}</time><span className="grow">{v.exam}: {fmt(v.copies)} × {fmt(v.price)}, owes <b>{fmt(v.debt)}</b>
            {me.role === "owner" && <><br /><span className="mini">Sold by {v.sales} · {v.age_days} days ago</span></>}</span></li>
        ))}
        {s.notes.map((n) => (
          <li key={"n" + n.id}><time>{when(n.created_at)}</time><span className="grow"><b>Note:</b> “{n.text}”
            {(n.promised_amount || n.promised_date) && <><br /><b>Promise:</b> {n.promised_amount ? ugx(n.promised_amount) : "payment"}{n.promised_date ? ` by ${when(n.promised_date)}` : ""}</>}
            <br /><span className="mini">Noted by {n.by}</span></span></li>
        ))}
        {s.whatsapp_sent.map((m, i) => (
          <li key={"w" + i}><time>{when(m.created_at)}</time><span className="grow">{KIND[m.kind] ?? "Reminder"} sent on WhatsApp {m.status === "sent" ? "✓" : <Pill cls="p-bad">failed</Pill>}</span></li>
        ))}
      </ul>
    </div>
  );
}
