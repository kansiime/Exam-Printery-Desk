"use client";
import { Shell } from "@/components/Shell";
import { EmptyCard, ErrorNote, Kpi, PageHead, Pill, T, useAction } from "@/components/ui";
import { api } from "@/lib/api";
import { fmt, ugx, when } from "@/lib/format";
import { Me, useData } from "@/lib/session";

type DebtVisit = { id: number; exam: string; copies: number; price: number; debt: number; date: string; due: string | null; overdue: boolean; age_days: number; sales: string };
type Debts = { schools: { school: string; district: string; contact: string; phone: string; total: number; visits: DebtVisit[] }[]; total: number; ageing: { under_30: number; "30_60": number; over_60: number } };

export default function DebtsPage() {
  return <Shell allow={["owner", "sales"]}>{(me) => <DebtsScreen me={me} />}</Shell>;
}

function DebtsScreen({ me }: { me: Me }) {
  const d = useData<Debts>("summary/debts");
  const { busy, run } = useAction();
  const data = d.data;
  return (
    <>
      <ErrorNote error={d.error} />
      <PageHead title={me.role === "sales" ? "My schools that owe" : "Debts"} sub={<>Record money as soon as a school pays.{me.role === "sales" ? " Cash you collect is added to what you must hand in." : ""}</>} />
      <div className="kpis">
        <Kpi label="Total owed" value={fmt(data?.total)} bad={(data?.total ?? 0) > 0} />
        <Kpi label="Under 30 days" value={fmt(data?.ageing.under_30)} />
        <Kpi label="30–60 days" value={fmt(data?.ageing["30_60"])} />
        <Kpi label="Over 60 days" value={fmt(data?.ageing.over_60)} bad={(data?.ageing.over_60 ?? 0) > 0} />
      </div>
      {data?.schools.length ? data.schools.map((s) => (
        <div className="ticket" key={s.school}>
          <div className="head">
            <div className="t"><h3>{s.school}</h3><p className="sub">{[s.district, s.contact, s.phone].filter(Boolean).join(" · ") || "No contact recorded"}</p></div>
            <div style={{ textAlign: "right" }}><div className="big" style={{ fontSize: "1.4rem", color: "var(--bad)" }}>{fmt(s.total)}</div><div className="mini">UGX owed</div></div>
          </div>
          <ul className="feed">{s.visits.map((v) => (
            <li key={v.id}><time>{when(v.date)}</time><span className="grow">{v.exam}: {fmt(v.copies)} × {fmt(v.price)}, owes <b>{fmt(v.debt)}</b>
              {v.due && <> · promised by {when(v.due)} {v.overdue && <Pill cls="p-bad">Overdue</Pill>}</>}
              {me.role === "owner" && <><br /><span className="mini">Sold by {v.sales} · {v.age_days} days ago</span></>}</span></li>
          ))}</ul>
          <form className="grid3" onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget, f = new FormData(form);
            const ok = await run(() => api("payments", { body: { visit: Number(f.get("visit")), amount: Number(f.get("amount")), method: f.get("method"), momo_id: f.get("momo_id") || "" } }), "Payment recorded");
            if (ok) { form.reset(); d.reload(); }
          }}>
            <label>Against<select name="visit">{s.visits.map((v) => <option key={v.id} value={v.id}>{v.exam} ({fmt(v.debt)})</option>)}</select></label>
            <label>Amount received (UGX)<input name="amount" type="number" min={1} inputMode="numeric" required /></label>
            <label>Paid by<select name="method"><option value="cash">Cash</option><option value="momo">Mobile money (to business number)</option></select></label>
            <label>Mobile money ID (if mobile money)<input name="momo_id" placeholder="From the payment SMS" /></label>
            <label>&nbsp;<button disabled={busy}><T>Record payment</T></button></label>
          </form>
        </div>
      )) : <EmptyCard icon="check">No schools owe money right now.</EmptyCard>}
      {me.role === "owner" && data && data.total > 0 && <p className="mini">Biggest debtor: {data.schools[0].school}, {ugx(data.schools[0].total)}.</p>}
    </>
  );
}
