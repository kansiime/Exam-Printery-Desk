"use client";
import { useState } from "react";
import { Shell } from "@/components/Shell";
import { CancelOrReport, DataTable, EmptyCard, ErrorNote, Feed, PageHead, Pill, useAction } from "@/components/ui";
import { api } from "@/lib/api";
import { fmt, when } from "@/lib/format";
import { useData } from "@/lib/session";

type StoreExam = { id: number; name: string; numbered: boolean; counted: number | null; issued: number; returned: number; in_store: number; to_count: boolean; printed_at: string | null };
type Summary = { exams: StoreExam[]; sales: { id: number; name: string; cash_held: number; holding: Record<string, number> }[] };
type Move = { id: number; exam_name: string; sales_name: string; qty: number; serials: string; created_at: string; accepted_at?: string | null };
type Receipt = { id: number; exam_name: string; qty: number; serial_from: number | null; serial_to: number | null; created_at: string };

export default function StorePage() {
  return <Shell allow={["store", "owner"]}>{() => <Store />}</Shell>;
}

function Store() {
  const sum = useData<Summary>("summary/store");
  const issues = useData<Move[]>("issues");
  const returns = useData<Move[]>("returns");
  const receipts = useData<Receipt[]>("receipts");
  const reload = () => { sum.reload(); issues.reload(); returns.reload(); receipts.reload(); };
  const exams = sum.data?.exams ?? [];
  const sales = sum.data?.sales ?? [];
  const moves = [
    ...(issues.data ?? []).map((x) => ({ key: "i" + x.id, at: x.created_at, text: <>Issued <b>{fmt(x.qty)}</b> of {x.exam_name} to {x.sales_name} {x.accepted_at ? <Pill cls="p-ready">Accepted</Pill> : <Pill cls="p-fold">Not accepted</Pill>}</>, act: <CancelOrReport type="issue" id={x.id} onDone={reload} /> })),
    ...(returns.data ?? []).map((x) => ({ key: "r" + x.id, at: x.created_at, text: <>Received <b>{fmt(x.qty)}</b> of {x.exam_name} back from {x.sales_name}</>, act: <CancelOrReport type="return" id={x.id} onDone={reload} /> })),
    ...(receipts.data ?? []).map((x) => ({ key: "c" + x.id, at: x.created_at, text: <>Counted <b>{fmt(x.qty)}</b> of {x.exam_name}{x.serial_from != null ? ` (serials ${x.serial_from}–${x.serial_to})` : ""}</>, act: <CancelOrReport type="receipt" id={x.id} onDone={reload} /> })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 15);

  return (
    <>
      <ErrorNote error={sum.error} />
      <PageHead title="Store" sub={<>Fold and count what the printer sends, issue copies to sales people, and take back what they didn&apos;t sell.</>} />
      <section className="block">
        <h3>1. Fold and count</h3>
        {exams.filter((e) => e.to_count).map((e) => <CountTicket key={e.id} exam={e} onDone={reload} />)}
        {!exams.some((e) => e.to_count) && <EmptyCard icon="box">Nothing waiting to count. Exams appear here when the printer posts them.</EmptyCard>}
      </section>
      <div className="split">
        <IssueForm exams={exams.filter((e) => e.in_store > 0)} sales={sales} onDone={reload} />
        <ReturnForm exams={exams} sales={sales} onDone={reload} />
      </div>
      <section className="block">
        <h3>Stock</h3>
        <DataTable<StoreExam> rows={exams.filter((e) => e.counted != null)} rowKey={(e) => e.id} empty="No stock yet."
          columns={[
            { label: "Exam", cell: (e) => <b>{e.name}</b> },
            { label: "Counted", cell: (e) => fmt(e.counted) },
            { label: "Issued", cell: (e) => fmt(e.issued) },
            { label: "Returned", cell: (e) => fmt(e.returned) },
            { label: "In store", cell: (e) => <b>{fmt(e.in_store)}</b>, bad: (e) => e.in_store < 0 },
          ]} />
      </section>
      <section className="panel"><h3>Recent store movements</h3><Feed items={moves} empty="Counts, issues and returns appear here." /></section>
    </>
  );
}

function CountTicket({ exam, onDone }: { exam: StoreExam; onDone: () => void }) {
  const { busy, run } = useAction();
  return (
    <div className="ticket">
      <div className="head"><div className="t"><div className="no">PRINTED {when(exam.printed_at).toUpperCase()}</div><h3>{exam.name}</h3></div><Pill cls="p-fold">To count</Pill></div>
      <form className="grid2" onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const ok = await run(() => api("receipts", { body: { exam: exam.id, qty: Number(f.get("qty")), serial_from: f.get("from") ? Number(f.get("from")) : null, serial_to: f.get("to") ? Number(f.get("to")) : null } }), "Count confirmed");
        if (ok) onDone();
      }}>
        <label>Copies folded and counted<input name="qty" type="number" min={0} inputMode="numeric" required placeholder="Count them yourself" /></label>
        {exam.numbered && <>
          <label>Lowest serial number<input name="from" type="number" min={0} inputMode="numeric" required placeholder="e.g. 1" /></label>
          <label>Highest serial number<input name="to" type="number" min={0} inputMode="numeric" required placeholder="e.g. 98" /></label>
        </>}
        <label>&nbsp;<button disabled={busy}>Confirm count</button></label>
      </form>
    </div>
  );
}

function IssueForm({ exams, sales, onDone }: { exams: StoreExam[]; sales: Summary["sales"]; onDone: () => void }) {
  const { busy, run } = useAction();
  return (
    <section className="panel"><h3>2. Issue copies to a sales person</h3>
      <form onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget, f = new FormData(form);
        const ok = await run(() => api("issues", { body: { exam: Number(f.get("exam")), sales: Number(f.get("sales")), qty: Number(f.get("qty")), serials: f.get("serials") || "" } }), "Copies issued");
        if (ok) { form.reset(); onDone(); }
      }}>
        <label>Exam<select name="exam" required>{exams.map((e) => <option key={e.id} value={e.id}>{e.name} ({fmt(e.in_store)} in store)</option>)}</select></label>
        <label>Sales person<select name="sales" required>{sales.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label>Copies<input name="qty" type="number" min={1} inputMode="numeric" required /></label>
        <label>Serial numbers given (numbered exams)<input name="serials" placeholder="e.g. 001-040" /></label>
        <div><button disabled={busy || !exams.length || !sales.length}>Issue copies</button></div>
      </form>
    </section>
  );
}

function ReturnForm({ exams, sales, onDone }: { exams: StoreExam[]; sales: Summary["sales"]; onDone: () => void }) {
  const [who, setWho] = useState<number | null>(null);
  const { busy, run } = useAction();
  const person = sales.find((s) => s.id === who) ?? sales[0];
  const held = person ? Object.entries(person.holding).map(([id, q]) => ({ id: Number(id), q, name: exams.find((e) => e.id === Number(id))?.name ?? "Exam" })) : [];
  return (
    <section className="panel"><h3>3. Receive returns</h3>
      <form onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget, f = new FormData(form);
        const ok = await run(() => api("returns", { body: { sales: person!.id, exam: Number(f.get("exam")), qty: Number(f.get("qty")), serials: f.get("serials") || "" } }), "Returns received");
        if (ok) { form.reset(); onDone(); }
      }}>
        <label>Sales person<select value={person?.id ?? ""} onChange={(e) => setWho(Number(e.target.value))}>{sales.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label>Exam<select name="exam" required>{held.map((h) => <option key={h.id} value={h.id}>{h.name} (holding {fmt(h.q)})</option>)}</select></label>
        <label>Copies returned<input name="qty" type="number" min={1} inputMode="numeric" required /></label>
        <label>Serial numbers returned (numbered exams)<input name="serials" placeholder="e.g. 031-040" /></label>
        <div><button disabled={busy || !held.length}>Receive returns</button></div>
      </form>
    </section>
  );
}
