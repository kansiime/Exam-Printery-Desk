"use client";
import { useMemo, useState } from "react";
import { Shell } from "@/components/Shell";
import { CancelOrReport, DataTable, Disclosure, ErrorNote, Kpi, PageHead, Pill, useAction, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { fmt, today, when } from "@/lib/format";
import { useData } from "@/lib/session";

type Totals = { value: number; collected: number; costs: number; commission: number; profit: number; debt: number; copies: number; schools: number };
type ExamRow = { id: number; name: string; sold: number; value: number; collected: number; debt: number; costs: number; profit: number; closed: boolean };
type SalesRow = { id: number; name: string; schools: number; sold: number; value: number; collected: number; commission_percent: number; commission: number; open_debt: number; overdue_debt: number };
type SchoolRow = { id: number; name: string; district: string; phone: string; value: number; copies: number; debt: number; oldest_debt_days: number; overdue: boolean };
type Report = { totals: Totals; exams: ExamRow[]; best_exams: ExamRow[]; sales: SalesRow[]; top_schools: SchoolRow[]; slow_payers: SchoolRow[]; expenses_by_category: { category: string; amount: number }[] };
type Expense = { id: number; date: string; category: string; category_label: string; amount: number; exam_name: string; note: string };

const iso = (d: Date) => d.toLocaleDateString("en-CA");
function presets() {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  return {
    "This month": [iso(new Date(y, m, 1)), iso(now)],
    "Last month": [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))],
    "This year": [iso(new Date(y, 0, 1)), iso(now)],
    "All time": ["", ""],
  } as Record<string, [string, string]>;
}

export default function ReportsPage() {
  return <Shell allow={["owner"]}>{() => <Reports />}</Shell>;
}

function Reports() {
  const ranges = useMemo(presets, []);
  const [range, setRange] = useState<[string, string]>(ranges["This month"]);
  const [from, to] = range;
  const q = [from && `from=${from}`, to && `to=${to}`].filter(Boolean).join("&");
  const rep = useData<Report>(`reports${q ? "?" + q : ""}`);
  const expenses = useData<Expense[]>("expenses");
  const exams = useData<{ id: number; name: string }[]>("exams");
  const toast = useToast();
  const { busy, run } = useAction();
  const d = rep.data;
  const reload = () => { rep.reload(); expenses.reload(); };

  async function downloadExcel() {
    try {
      const res = await fetch(`/api/reports/excel/${q ? "?" + q : ""}`, { credentials: "same-origin" });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `printery-report-${from || "start"}-to-${to || today()}.xlsx`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch { toast("Could not download the report. Try again."); }
  }

  return (
    <>
      <ErrorNote error={rep.error} />
      <PageHead title="Reports" sub="Sales are counted by the date of the school visit; costs by the date you enter. Debts are what schools owe today.">
        <div className="row noprint">
          <button type="button" className="ghost" onClick={downloadExcel}>Download Excel</button>
          <button type="button" className="ghost" onClick={() => window.print()}>Print / PDF</button>
        </div>
      </PageHead>

      <div className="row noprint">
        {Object.entries(ranges).map(([label, r]) => (
          <button key={label} type="button" className={from === r[0] && to === r[1] ? "" : "ghost"} onClick={() => setRange(r)}>{label}</button>
        ))}
        <label style={{ minWidth: 150 }}>From<input type="date" value={from} onChange={(e) => setRange([e.target.value, to])} /></label>
        <label style={{ minWidth: 150 }}>To<input type="date" value={to} onChange={(e) => setRange([from, e.target.value])} /></label>
      </div>
      <p className="mini printonly">Period: {from || "start"} to {to || today()}</p>

      <div className="kpis">
        <Kpi label="Sales value" value={<>{fmt(d?.totals.value)}<span className="u">UGX</span></>} />
        <Kpi label="Money collected" value={<>{fmt(d?.totals.collected)}<span className="u">UGX</span></>} />
        <Kpi label="Costs + commission" value={<>{fmt((d?.totals.costs ?? 0) + (d?.totals.commission ?? 0))}<span className="u">UGX</span></>} />
        <Kpi label="Profit" value={<>{fmt(d?.totals.profit)}<span className="u">UGX</span></>} bad={(d?.totals.profit ?? 0) < 0} />
      </div>
      <p className="mini" style={{ margin: 0 }}>{fmt(d?.totals.copies)} {d?.totals.copies === 1 ? "copy" : "copies"} sold to {fmt(d?.totals.schools)} {d?.totals.schools === 1 ? "school" : "schools"}. Schools owe {fmt(d?.totals.debt)} UGX in total today. Profit = sales value − costs − commission.</p>

      <Disclosure title="Add an expense" sub="Paper, toner, transport, wages, rent… so profit is right" icon="plus" primary>
        <form onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget, f = new FormData(form);
          if (await run(() => api("expenses", { body: { date: f.get("date"), category: f.get("category"), amount: Number(f.get("amount")), exam: f.get("exam") ? Number(f.get("exam")) : null, note: f.get("note") || "" } }), "Expense recorded")) { form.reset(); reload(); }
        }}>
          <div className="grid3">
            <label>Date<input name="date" type="date" required defaultValue={today()} /></label>
            <label>What for<select name="category">
              <option value="paper">Paper</option><option value="toner">Toner and ink</option><option value="machine">Copier repair and service</option>
              <option value="transport">Transport</option><option value="wages">Wages</option><option value="commission">Sales commission (paid)</option>
              <option value="rent">Rent and power</option><option value="other">Other</option></select></label>
            <label>Amount (UGX)<input name="amount" type="number" min={1} inputMode="numeric" required /></label>
          </div>
          <div className="grid2">
            <label>For one exam? (optional)<select name="exam"><option value="">No, general cost</option>{(exams.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
            <label>Note (optional)<input name="note" placeholder="e.g. 4 reams from Kikuubo" /></label>
          </div>
          <div><button disabled={busy}>Record expense</button></div>
        </form>
        <ul className="feed">{(expenses.data ?? []).slice(0, 10).map((x) => (
          <li key={x.id}><time>{when(x.date)}</time><span className="grow"><b>{fmt(x.amount)}</b> · {x.category_label}{x.exam_name ? ` · ${x.exam_name}` : ""}{x.note ? ` · ${x.note}` : ""}</span><span className="act"><CancelOrReport type="expense" id={x.id} onDone={reload} /></span></li>
        ))}</ul>
      </Disclosure>

      <section className="block"><h2>Profit per exam</h2>
        <DataTable<ExamRow> rows={d?.exams ?? []} rowKey={(e) => e.id} empty="No sales or costs in this period."
          columns={[
            { label: "Exam", cell: (e) => <><b>{e.name}</b>{e.closed && <> <Pill cls="p-done">Closed</Pill></>}</> },
            { label: "Copies sold", cell: (e) => fmt(e.sold) },
            { label: "Sales value", cell: (e) => fmt(e.value) },
            { label: "Collected", cell: (e) => fmt(e.collected) },
            { label: "Its costs", cell: (e) => fmt(e.costs) },
            { label: "Profit", cell: (e) => <b>{fmt(e.profit)}</b>, bad: (e) => e.profit < 0 },
            { label: "Still owed", cell: (e) => fmt(e.debt), bad: (e) => e.debt > 0 },
          ]} />
      </section>

      <section className="block"><h2>Sales people and commission</h2>
        <p className="sub" style={{ margin: 0 }}>Commission = the person&apos;s rate (set on Team) × money they collected in this period.</p>
        <DataTable<SalesRow> rows={d?.sales ?? []} rowKey={(s) => s.id} empty="No sales people yet."
          columns={[
            { label: "Name", cell: (s) => <b>{s.name}</b> },
            { label: "Schools", cell: (s) => fmt(s.schools) },
            { label: "Copies sold", cell: (s) => fmt(s.sold) },
            { label: "Sales value", cell: (s) => fmt(s.value) },
            { label: "Collected", cell: (s) => fmt(s.collected) },
            { label: "Commission", cell: (s) => <>{fmt(s.commission)} <span className="mini">({s.commission_percent}%)</span></> },
            { label: "Debts open", cell: (s) => fmt(s.open_debt), bad: (s) => s.open_debt > 0 },
            { label: "Overdue", cell: (s) => fmt(s.overdue_debt), bad: (s) => s.overdue_debt > 0 },
          ]} />
      </section>

      <div className="split">
        <section className="block"><h2>Top schools</h2>
          <DataTable<SchoolRow> rows={d?.top_schools ?? []} rowKey={(s) => s.id} empty="No sales in this period."
            columns={[{ label: "School", cell: (s) => <><b>{s.name}</b><br /><span className="mini">{s.district}</span></> }, { label: "Copies", cell: (s) => fmt(s.copies) }, { label: "Value", cell: (s) => fmt(s.value) }]} />
        </section>
        <section className="block"><h2>Slow payers</h2>
          <DataTable<SchoolRow> rows={d?.slow_payers ?? []} rowKey={(s) => s.id} empty="No school owes money."
            columns={[{ label: "School", cell: (s) => <><b>{s.name}</b> {s.overdue && <Pill cls="p-bad">Overdue</Pill>}<br /><span className="mini">{s.phone}</span></> },
              { label: "Owes", cell: (s) => fmt(s.debt), bad: () => true }, { label: "Oldest", cell: (s) => `${s.oldest_debt_days} days` }]} />
        </section>
      </div>

      <div className="split">
        <section className="block"><h2>Best-selling exams</h2>
          <DataTable<ExamRow> rows={d?.best_exams ?? []} rowKey={(e) => e.id} empty="No sales in this period."
            columns={[{ label: "Exam", cell: (e) => <b>{e.name}</b> }, { label: "Copies", cell: (e) => fmt(e.sold) }, { label: "Value", cell: (e) => fmt(e.value) }]} />
        </section>
        <section className="block"><h2>Costs by type</h2>
          <DataTable<{ category: string; amount: number }> rows={d?.expenses_by_category ?? []} rowKey={(c) => c.category} empty="No costs recorded in this period."
            columns={[{ label: "Cost", cell: (c) => <b>{c.category}</b> }, { label: "Amount", cell: (c) => fmt(c.amount) }]} />
        </section>
      </div>
    </>
  );
}
