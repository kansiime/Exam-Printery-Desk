"use client";
import Link from "next/link";
import { Shell } from "@/components/Shell";
import { CancelOrReport, ErrorNote, Findings, Kpi, Pill, useAction } from "@/components/ui";
import { api } from "@/lib/api";
import { fmt, when } from "@/lib/format";
import { useData } from "@/lib/session";

type ExamRow = { id: number; name: string; ordered_qty: number; price: number; created_at: string; printed: number | null; counted: number | null;
  in_store: number; with_sales: number; sold: number; collected: number; debt: number; status: string };
type SalesRow = { id: number; name: string; issued: number; sold: number; returned: number; holding: number; cash_collected: number; handed: number; cash_held: number; debt: number };
type Pending = { id: number; school_name: string; exam_name: string; copies: number; price: number; price_reason: string; sales_name: string; exam: number };
type Correction = { id: number; target_type: string; target_id: number; reason: string; by: string; created_at: string };
type Overview = { kpis: { sold: number; collected: number; debt: number; cash_not_with_owner: number }; exams: ExamRow[]; sales: SalesRow[];
  pending_prices: Pending[]; corrections: Correction[]; findings: { level: string; text: string }[] };

const STATUS_CLS: Record<string, string> = { "To print": "p-print", Printing: "p-print", "At store": "p-fold", Selling: "p-ready", "Sold out": "p-done" };

export default function OwnerPage() {
  return <Shell allow={["owner"]}>{() => <OverviewScreen />}</Shell>;
}

function OverviewScreen() {
  const ov = useData<Overview>("summary/overview");
  const exams = useData<{ id: number; price: number }[]>("exams");
  const { busy, run } = useAction();
  const d = ov.data;
  const priceOf = (id: number) => exams.data?.find((e) => e.id === id)?.price;
  return (
    <>
      <ErrorNote error={ov.error} />
      <div className="kpis">
        <Kpi label="Copies sold" value={fmt(d?.kpis.sold)} />
        <Kpi label="Money collected" value={fmt(d?.kpis.collected)} />
        <Kpi label="Schools owe" value={fmt(d?.kpis.debt)} bad={(d?.kpis.debt ?? 0) > 0} />
        <Kpi label="Cash not yet with you" value={fmt(d?.kpis.cash_not_with_owner)} bad={(d?.kpis.cash_not_with_owner ?? 0) > 0} />
      </div>

      {!!d?.pending_prices.length && (
        <section className="block"><div><h2>Price approvals</h2><p className="sub">These sales were below your set price. If you reject, the school&apos;s debt is worked out at your set price.</p></div>
          {d.pending_prices.map((v) => (
            <div className="ticket" key={v.id}>
              <div className="head"><div className="t"><h3>{v.school_name}</h3><p className="sub">{v.exam_name} · {fmt(v.copies)} copies by {v.sales_name}</p></div>
                <div style={{ textAlign: "right" }}><div className="big" style={{ fontSize: "1.3rem" }}>{fmt(v.price)}</div><div className="mini">set price {fmt(priceOf(v.exam))}</div></div></div>
              {v.price_reason && <p className="mini">Reason given: {v.price_reason}</p>}
              <div className="row">
                <button type="button" disabled={busy} onClick={() => run(() => api(`visits/${v.id}/decide-price`, { body: { status: "approved" } }), "Discount approved").then(ov.reload)}>Approve discount</button>
                <button type="button" className="danger" disabled={busy} onClick={() => run(() => api(`visits/${v.id}/decide-price`, { body: { status: "rejected" } }), "Discount rejected").then(ov.reload)}>Reject</button>
              </div>
            </div>
          ))}
        </section>
      )}

      {!!d?.corrections.length && (
        <section className="block"><div><h2>Mistakes reported</h2><p className="sub">Workers can&apos;t change records. Cancel the record (it stays in history) or dismiss the report.</p></div>
          {d.corrections.map((c) => (
            <div className="ticket" key={c.id}>
              <p><b>{c.by}</b> says {c.target_type} #{c.target_id} is wrong: “{c.reason}” <span className="mini">· {when(c.created_at)}</span></p>
              <div className="row"><CancelOrReport type={c.target_type} id={c.target_id} onDone={ov.reload} />
                <button type="button" className="ghost" onClick={() => run(() => api(`corrections/${c.id}/dismiss`, { body: {} }), "Dismissed").then(ov.reload)}>Dismiss</button></div>
            </div>
          ))}
        </section>
      )}

      {!!d?.findings.length && (
        <section className="block"><div className="row"><h2 className="grow">Needs your attention</h2><Link href="/owner/fraud">All fraud checks</Link></div>
          <Findings items={d.findings.slice(0, 12)} />
        </section>
      )}

      <NewOrder onDone={ov.reload} />

      <section className="block"><div><h2>Exams</h2><p className="sub">Ordered, printed and store count should match. Red means they don&apos;t.</p></div>
        {d?.exams.length ? (
          <div className="tablewrap"><table>
            <thead><tr><th>Exam</th><th>Ordered</th><th>Printed</th><th>Store count</th><th>In store</th><th>With sales</th><th>Sold</th><th>Collected</th><th>Debt</th><th>Status</th><th></th></tr></thead>
            <tbody>{d.exams.map((e) => (
              <tr key={e.id}>
                <td><b>{e.name}</b><br /><span className="mini">{when(e.created_at)} · UGX {fmt(e.price)}/copy</span></td>
                <td>{fmt(e.ordered_qty)}</td>
                <td className={e.printed != null && e.printed < e.ordered_qty ? "bad" : ""}>{fmt(e.printed)}</td>
                <td className={e.printed != null && e.counted != null && e.counted !== e.printed ? "bad" : ""}>{fmt(e.counted)}</td>
                <td>{fmt(e.in_store)}</td><td>{fmt(e.with_sales)}</td><td>{fmt(e.sold)}</td><td>{fmt(e.collected)}</td>
                <td className={e.debt > 0 ? "bad" : ""}>{fmt(e.debt)}</td>
                <td><Pill cls={STATUS_CLS[e.status] ?? "p-done"}>{e.status}</Pill></td>
                <td><CancelOrReport type="exam" id={e.id} onDone={ov.reload} /></td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <div className="panel"><p className="empty">No exams yet. Post your first print order above.</p></div>}
      </section>

      <section className="block"><div><h2>Sales people</h2><p className="sub">Copies issued must equal sold + returned + still held. Cash held is cash collected but not yet handed to the store keeper.</p></div>
        <div className="tablewrap"><table>
          <thead><tr><th>Name</th><th>Issued</th><th>Sold</th><th>Returned</th><th>Holding</th><th>Cash collected</th><th>Handed in</th><th>Cash held</th><th>Debts</th></tr></thead>
          <tbody>{(d?.sales ?? []).map((s) => (
            <tr key={s.id}><td><b>{s.name}</b></td><td>{fmt(s.issued)}</td><td>{fmt(s.sold)}</td><td>{fmt(s.returned)}</td><td>{fmt(s.holding)}</td>
              <td>{fmt(s.cash_collected)}</td><td>{fmt(s.handed)}</td><td className={s.cash_held > 0 ? "bad" : ""}>{fmt(s.cash_held)}</td><td className={s.debt > 0 ? "bad" : ""}>{fmt(s.debt)}</td></tr>
          ))}</tbody>
        </table></div>
      </section>
    </>
  );
}

function NewOrder({ onDone }: { onDone: () => void }) {
  const { busy, run } = useAction();
  return (
    <section className="panel">
      <div><h2>New print order</h2><p className="sub">Post this when a school says its exams are done. The printer sees it straight away.</p></div>
      <form onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget, f = new FormData(form);
        const ok = await run(() => api("exams", { body: {
          name: f.get("name"), ordered_qty: Number(f.get("qty")), price: Number(f.get("price")), pages: Number(f.get("pages")),
          sides: Number(f.get("sides")), numbered: f.get("numbered") === "1", note: f.get("note") || "", exam_date: f.get("exam_date") || null,
        } }), "Print order sent");
        if (ok) { form.reset(); onDone(); }
      }}>
        <label>Exam<input name="name" required placeholder="e.g. S.4 Mock Term 3 – Mathematics" /></label>
        <div className="grid3">
          <label>Copies to print<input name="qty" type="number" min={1} inputMode="numeric" required placeholder="100" /></label>
          <label>Selling price per copy (UGX)<input name="price" type="number" min={0} inputMode="numeric" required placeholder="2000" /></label>
          <label>Exam date<input name="exam_date" type="date" /></label>
          <label>Pages per copy<input name="pages" type="number" min={1} inputMode="numeric" required placeholder="8" /></label>
          <label>Printing<select name="sides"><option value="1">One side</option><option value="2">Both sides</option></select></label>
          <label>Serial numbers on copies<select name="numbered"><option value="1">Yes, numbered</option><option value="0">No</option></select></label>
        </div>
        <label>Note for the printer (optional)<input name="note" placeholder="e.g. A4, staple top left" /></label>
        <div><button disabled={busy}>Send to printer</button></div>
      </form>
    </section>
  );
}
