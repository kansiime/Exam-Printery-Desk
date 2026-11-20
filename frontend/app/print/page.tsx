"use client";
import { useState } from "react";
import { Shell } from "@/components/Shell";
import { CancelOrReport, ErrorNote, Feed, PhotoInput, useAction } from "@/components/ui";
import { api, toForm } from "@/lib/api";
import { fmt, when } from "@/lib/format";
import { useData } from "@/lib/session";

type Exam = { id: number; name: string; ordered_qty: number; pages: number; sides: number; numbered: boolean; note: string; created_at: string };
type Run = { id: number; exam: number; exam_name: string; machine: string; meter_before: number; meter_after: number | null; qty: number | null; started_at: string; done_at: string | null; by: string };
type Other = { id: number; description: string; machine: string; meter_before: number; meter_after: number; created_at: string };

export default function PrintPage() {
  return <Shell allow={["printer", "owner"]}>{() => <Printing />}</Shell>;
}

function Printing() {
  const exams = useData<Exam[]>("exams");
  const runs = useData<Run[]>("prints");
  const others = useData<Other[]>("other-prints");
  const reload = () => { exams.reload(); runs.reload(); others.reload(); };
  const done = new Set((runs.data ?? []).filter((r) => r.done_at).map((r) => r.exam));
  const todo = (exams.data ?? []).filter((e) => !done.has(e.id));
  const recent: { key: string; at: string | null; text: React.ReactNode; act: React.ReactNode }[] = [
    ...(runs.data ?? []).filter((r) => r.done_at).map((r) => ({ key: "p" + r.id, at: r.done_at, text: <><b>{fmt(r.qty)}</b> copies · {r.exam_name} · meter {fmt(r.meter_before)} → {fmt(r.meter_after)} · by {r.by}</>, act: <CancelOrReport type="print" id={r.id} onDone={reload} /> })),
    ...(others.data ?? []).map((o) => ({ key: "o" + o.id, at: o.created_at, text: <>Other printing: {o.description} · meter {fmt(o.meter_before)} → {fmt(o.meter_after)}</>, act: <CancelOrReport type="other" id={o.id} onDone={reload} /> })),
  ].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 12);

  return (
    <>
      <ErrorNote error={exams.error || runs.error} />
      <div><h2>Printing</h2><p className="sub">For every job, read the copier meter and take a photo of it before you start and after you finish.</p></div>
      {todo.length ? todo.map((e) => <Ticket key={e.id} exam={e} run={(runs.data ?? []).find((r) => r.exam === e.id && !r.done_at)} onDone={reload} />)
        : <div className="panel"><p className="empty">Nothing to print. New orders from the owner appear here.</p></div>}
      <OtherPrinting onDone={reload} />
      <section className="panel"><h3>Recently printed</h3><Feed items={recent} empty="Nothing printed yet." /></section>
    </>
  );
}

function Ticket({ exam, run, onDone }: { exam: Exam; run?: Run; onDone: () => void }) {
  const [photo, setPhoto] = useState<Blob | null>(null);
  const { busy, run: act } = useAction();
  return (
    <div className="ticket">
      <div className="head">
        <div className="t">
          <div className="no">ORDERED {when(exam.created_at).toUpperCase()}</div>
          <h3>{exam.name}</h3>
          <p className="sub">{exam.pages} pages per copy · {exam.sides === 2 ? "both sides" : "one side"}{exam.numbered ? " · numbered copies" : ""}{exam.note ? " · " + exam.note : ""}</p>
        </div>
        <div style={{ textAlign: "right" }}><div className="big">{fmt(exam.ordered_qty)}</div><div className="mini">copies to print</div></div>
      </div>
      {!run ? (
        <form onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          if (!photo) return act(async () => { throw new Error("Take a photo of the meter first."); });
          const ok = await act(() => api("prints", { form: toForm({ exam: exam.id, machine: f.get("machine"), meter_before: f.get("meter_before"), photo_before: photo }) }), "Started. Post the count when you finish.");
          if (ok) { setPhoto(null); onDone(); }
        }}>
          <div className="grid2">
            <label>Copier<input name="machine" defaultValue="Main copier" required /></label>
            <label>Meter reading before printing<input name="meter_before" type="number" min={0} inputMode="numeric" required placeholder="Read it off the copier" /></label>
          </div>
          <PhotoInput id={`pb-${exam.id}`} label="Photo of the meter before" value={photo} onChange={setPhoto} />
          <div><button disabled={busy}>Start printing</button></div>
        </form>
      ) : (
        <form onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          if (!photo) return act(async () => { throw new Error("Take a photo of the meter first."); });
          const ok = await act(() => api(`prints/${run.id}/finish`, { form: toForm({ qty: f.get("qty"), spoilt: f.get("spoilt"), meter_after: f.get("meter_after"), photo_after: photo }) }), "Printed copies posted");
          if (ok) { setPhoto(null); onDone(); }
        }}>
          <p className="mini">Started {when(run.started_at)} on {run.machine} · meter before {fmt(run.meter_before)}</p>
          <div className="grid3">
            <label>Good copies printed<input name="qty" type="number" min={0} inputMode="numeric" required defaultValue={exam.ordered_qty} /></label>
            <label>Spoilt sheets<input name="spoilt" type="number" min={0} inputMode="numeric" defaultValue={0} /></label>
            <label>Meter reading after<input name="meter_after" type="number" min={0} inputMode="numeric" required /></label>
          </div>
          <PhotoInput id={`pa-${exam.id}`} label="Photo of the meter after" value={photo} onChange={setPhoto} />
          <div><button disabled={busy}>Post printed</button></div>
        </form>
      )}
    </div>
  );
}

function OtherPrinting({ onDone }: { onDone: () => void }) {
  const [before, setBefore] = useState<Blob | null>(null);
  const [after, setAfter] = useState<Blob | null>(null);
  const { busy, run } = useAction();
  return (
    <section className="panel">
      <div><h3>Other printing (not exams)</h3><p className="sub">Record any other work on the copier too, or the owner sees pages with no record.</p></div>
      <form onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = new FormData(form);
        const ok = await run(() => api("other-prints", { form: toForm({ description: f.get("description"), machine: f.get("machine"), meter_before: f.get("meter_before"), meter_after: f.get("meter_after"), photo_before: before, photo_after: after }) }), "Other printing recorded");
        if (ok) { form.reset(); setBefore(null); setAfter(null); onDone(); }
      }}>
        <div className="grid2">
          <label>What was printed<input name="description" required placeholder="e.g. 50 receipts for a customer" /></label>
          <label>Copier<input name="machine" defaultValue="Main copier" required /></label>
          <label>Meter before<input name="meter_before" type="number" min={0} inputMode="numeric" required /></label>
          <label>Meter after<input name="meter_after" type="number" min={0} inputMode="numeric" required /></label>
        </div>
        <div className="grid2">
          <PhotoInput id="ob" label="Photo of the meter before" value={before} onChange={setBefore} />
          <PhotoInput id="oa" label="Photo of the meter after" value={after} onChange={setAfter} />
        </div>
        <div><button disabled={busy}>Record other printing</button></div>
      </form>
    </section>
  );
}
