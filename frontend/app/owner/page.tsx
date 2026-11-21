"use client";
import Link from "next/link";
import { Shell } from "@/components/Shell";
import { CancelOrReport, DataTable, Disclosure, ErrorNote, Findings, GiveResetCode, Kpi, PageHead, Pill, T, useAction } from "@/components/ui";
import { api } from "@/lib/api";
import { fmt, when } from "@/lib/format";
import { Me, needsName, useData } from "@/lib/session";

type ExamRow = { id: number; closed: boolean; name: string; ordered_qty: number; price: number; created_at: string; printed: number | null; counted: number | null;
  in_store: number; with_sales: number; sold: number; collected: number; debt: number; status: string };
type SalesRow = { id: number; name: string; issued: number; sold: number; returned: number; holding: number; cash_collected: number; handed: number; cash_held: number; debt: number };
type Pending = { id: number; school_name: string; exam_name: string; copies: number; price: number; price_reason: string; sales_name: string; exam: number };
type Correction = { id: number; target_type: string; target_id: number; reason: string; by: string; created_at: string };
type Overview = { kpis: { sold: number; collected: number; debt: number; cash_not_with_owner: number }; exams: ExamRow[]; sales: SalesRow[];
  pending_prices: Pending[]; corrections: Correction[]; findings: { level: string; text: string }[] };

const STATUS_CLS: Record<string, string> = { "To print": "p-print", Printing: "p-print", "At store": "p-fold", Selling: "p-ready", "Sold out": "p-done" };

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default function OwnerPage() {
  return <Shell allow={["owner"]}>{(me) => <OverviewScreen me={me} />}</Shell>;
}

function OverviewScreen({ me }: { me: Me }) {
  const ov = useData<Overview>("summary/overview");
  const exams = useData<{ id: number; price: number }[]>("exams");
  const { busy, run } = useAction();
  const d = ov.data;
  const priceOf = (id: number) => exams.data?.find((e) => e.id === id)?.price;
  const serious = d?.findings.filter((f) => f.level === "bad").length ?? 0;

  return (
    <>
      <ErrorNote error={ov.error} />
      {needsName(me) && (
        <div className="banner info row"><span className="grow">Add your name so it shows here and on everything you record.</span><Link href="/account">Add my name</Link></div>
      )}
      <PageHead title={needsName(me) ? greeting() : `${greeting()}, ${me.first_name}`}
        sub={!d ? "Loading your figures…" : serious ? `${serious} serious warning${serious > 1 ? "s need" : " needs"} your attention.` : "Everything adds up. No serious warnings."} />

      <div className="kpis">
        <Kpi label="Copies sold" value={fmt(d?.kpis.sold)} />
        <Kpi label="Money collected" value={<>{fmt(d?.kpis.collected)}<span className="u">UGX</span></>} />
        <Kpi label="Schools owe" value={<>{fmt(d?.kpis.debt)}<span className="u">UGX</span></>} bad={(d?.kpis.debt ?? 0) > 0} />
        <Kpi label="Cash not with you" value={<>{fmt(d?.kpis.cash_not_with_owner)}<span className="u">UGX</span></>} bad={(d?.kpis.cash_not_with_owner ?? 0) > 0} />
      </div>

      <Disclosure title="New print order" sub="When a school says its exams are done" icon="plus" primary>
        <NewOrder onDone={ov.reload} />
      </Disclosure>

      <ResetRequests />

      {!!d?.pending_prices.length && (
        <section className="block">
          <div className="sectiontitle"><h2>Price approvals</h2><span className="count">{d.pending_prices.length}</span></div>
          <p className="sub">These sales were below your set price. If you reject, the school&apos;s debt is worked out at your set price.</p>
          {d.pending_prices.map((v) => (
            <div className="ticket" key={v.id}>
              <div className="head"><div className="t"><h3>{v.school_name}</h3><p className="sub">{v.exam_name} · {fmt(v.copies)} copies by {v.sales_name}</p></div>
                <div style={{ textAlign: "right" }}><div className="big" style={{ fontSize: "1.3rem" }}>{fmt(v.price)}</div><div className="mini">set price {fmt(priceOf(v.exam))}</div></div></div>
              {v.price_reason && <p className="mini" style={{ margin: 0 }}>Reason given: {v.price_reason}</p>}
              <div className="row">
                <button type="button" disabled={busy} onClick={() => run(() => api(`visits/${v.id}/decide-price`, { body: { status: "approved" } }), "Discount approved").then(ov.reload)}>Approve</button>
                <button type="button" className="danger" disabled={busy} onClick={() => run(() => api(`visits/${v.id}/decide-price`, { body: { status: "rejected" } }), "Discount rejected").then(ov.reload)}>Reject</button>
              </div>
            </div>
          ))}
        </section>
      )}

      {!!d?.corrections.length && (
        <section className="block">
          <div className="sectiontitle"><h2>Mistakes reported</h2><span className="count">{d.corrections.length}</span></div>
          {d.corrections.map((c) => (
            <div className="ticket" key={c.id}>
              <p style={{ margin: 0 }}><b>{c.by}</b> says {c.target_type} #{c.target_id} is wrong: “{c.reason}” <span className="mini">· {when(c.created_at)}</span></p>
              <div className="row"><CancelOrReport type={c.target_type} id={c.target_id} onDone={ov.reload} />
                <button type="button" className="ghost" onClick={() => run(() => api(`corrections/${c.id}/dismiss`, { body: {} }), "Dismissed").then(ov.reload)}>Dismiss</button></div>
            </div>
          ))}
        </section>
      )}

      {!!d?.findings.length && (
        <section className="block">
          <div className="sectiontitle"><h2>Needs your attention</h2><span className="count">{d.findings.length}</span><Link href="/owner/fraud">See all</Link></div>
          <Findings items={d.findings.slice(0, 6)} />
        </section>
      )}

      <section className="block">
        <div className="sectiontitle"><h2>Exams</h2></div>
        <p className="sub">Ordered, printed and store count should match. Red means they don&apos;t.</p>
        <DataTable<ExamRow> rows={d?.exams ?? []} rowKey={(e) => e.id} empty="No exams yet. Open “New print order” above to post your first one."
          columns={[
            { label: "Exam", cell: (e) => <><b>{e.name}</b> <Pill cls={e.closed ? "p-done" : STATUS_CLS[e.status] ?? "p-done"}>{e.closed ? "Closed" : e.status}</Pill><br /><span className="mini">{when(e.created_at)} · UGX {fmt(e.price)} per copy</span></> },
            { label: "Ordered", cell: (e) => fmt(e.ordered_qty) },
            { label: "Printed", cell: (e) => fmt(e.printed), bad: (e) => e.printed != null && e.printed < e.ordered_qty },
            { label: "Store count", cell: (e) => fmt(e.counted), bad: (e) => e.printed != null && e.counted != null && e.counted !== e.printed },
            { label: "In store", cell: (e) => fmt(e.in_store) },
            { label: "With sales", cell: (e) => fmt(e.with_sales) },
            { label: "Sold", cell: (e) => fmt(e.sold) },
            { label: "Collected", cell: (e) => fmt(e.collected) },
            { label: "Debt", cell: (e) => fmt(e.debt), bad: (e) => e.debt > 0 },
            { label: "", cell: (e) => <span className="row" style={{ justifyContent: "flex-end" }}>
                <button type="button" className="ghost" disabled={busy} onClick={() => run(async () => {
                  const r = await api<{ in_store: number; with_sales: number }>(`exams/${e.id}/close`, { body: e.closed ? { reopen: true } : {} });
                  if (!e.closed && (r.in_store || r.with_sales)) throw new Error(`Closed. Note: ${fmt(r.in_store)} copies still in store and ${fmt(r.with_sales)} with sales people.`);
                }, e.closed ? "Exam reopened" : "Exam closed and locked").then(ov.reload)}>{e.closed ? "Reopen" : "Close exam"}</button>
                {!e.closed && <CancelOrReport type="exam" id={e.id} onDone={ov.reload} />}</span> },
          ]} />
      </section>

      <section className="block">
        <div className="sectiontitle"><h2>Sales people</h2></div>
        <p className="sub">Copies issued must equal sold + returned + still held. Cash held is cash collected but not yet handed to the store keeper.</p>
        <DataTable<SalesRow> rows={d?.sales ?? []} rowKey={(s) => s.id} empty="No sales people yet. Add them on the Team screen."
          columns={[
            { label: "Name", cell: (s) => <b>{s.name}</b> },
            { label: "Issued", cell: (s) => fmt(s.issued) },
            { label: "Sold", cell: (s) => fmt(s.sold) },
            { label: "Returned", cell: (s) => fmt(s.returned) },
            { label: "Holding", cell: (s) => fmt(s.holding) },
            { label: "Cash collected", cell: (s) => fmt(s.cash_collected) },
            { label: "Handed in", cell: (s) => fmt(s.handed) },
            { label: "Cash held", cell: (s) => fmt(s.cash_held), bad: (s) => s.cash_held > 0 },
            { label: "Debts", cell: (s) => fmt(s.debt), bad: (s) => s.debt > 0 },
          ]} />
      </section>
    </>
  );
}

function NewOrder({ onDone }: { onDone: () => void }) {
  const { busy, run } = useAction();
  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      const form = e.currentTarget, f = new FormData(form);
      const ok = await run(() => api("exams", { body: {
        name: f.get("name"), ordered_qty: Number(f.get("qty")), price: Number(f.get("price")), pages: Number(f.get("pages")),
        sides: Number(f.get("sides")), numbered: f.get("numbered") === "1", note: f.get("note") || "", exam_date: f.get("exam_date") || null,
      } }), "Print order sent to the printer");
      if (ok) { form.reset(); onDone(); }
    }}>
      <label>Exam<input name="name" required placeholder="e.g. S.4 Mock Term 3 – Mathematics" /></label>
      <div className="grid3">
        <label>Copies to print<input name="qty" type="number" min={1} inputMode="numeric" required placeholder="100" /></label>
        <label>Price per copy (UGX)<input name="price" type="number" min={0} inputMode="numeric" required placeholder="2000" /></label>
        <label>Pages per copy<input name="pages" type="number" min={1} inputMode="numeric" required placeholder="8" /></label>
        <label>Printing<select name="sides"><option value="1">One side</option><option value="2">Both sides</option></select></label>
        <label>Numbered copies<select name="numbered"><option value="1">Yes, numbered</option><option value="0">No</option></select></label>
        <label>Exam date<input name="exam_date" type="date" /></label>
      </div>
      <label>Note for the printer (optional)<input name="note" placeholder="e.g. A4, staple top left" /></label>
      <div><button disabled={busy}><T>Send to printer</T></button></div>
    </form>
  );
}

type ResetReq = { id: number; user: number; name: string; username: string; phone: string; created_at: string };

function ResetRequests() {
  const reqs = useData<ResetReq[]>("auth/password/requests");
  const { run } = useAction();
  if (!reqs.data?.length) return null;
  return (
    <section className="block">
      <div className="sectiontitle"><h2>Password reset requests</h2><span className="count">{reqs.data.length}</span></div>
      <p className="sub">These people tapped “Forgot your password?”. Create a code and give it to them by WhatsApp, a call or in person. Only do this if you know the request is really from them.</p>
      {reqs.data.map((r) => (
        <div className="ticket" key={r.id}>
          <div className="head" style={{ alignItems: "center" }}>
            <div className="t"><h3>{r.name}</h3><p className="sub">username {r.username}{r.phone ? ` · ${r.phone}` : ""} · asked {when(r.created_at)}</p></div>
            <button type="button" className="ghost" onClick={() => run(() => api(`auth/password/requests/${r.id}/dismiss`, { body: {} }), "Request dismissed").then(reqs.reload)}>Dismiss</button>
          </div>
          <GiveResetCode userId={r.user} />
        </div>
      ))}
    </section>
  );
}
