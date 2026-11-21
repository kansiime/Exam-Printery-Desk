"use client";
import { useCallback, useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { CancelOrReport, EmptyCard, ErrorNote, Feed, Kpi, PageHead, PhotoInput, useAction, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { fmt, today, ugx, when } from "@/lib/format";
import { discard, flush, listPending, submitVisit } from "@/lib/outbox";
import { useData } from "@/lib/session";
import { CloseMyDay } from "@/components/DayClose";

type Holding = { exam: number; name: string; qty: number; price: number; numbered: boolean };
type Issue = { id: number; exam_name: string; qty: number; created_at: string; by: string };
type Field = { holding: number; sold: number; cash_held: number; debt: number; momo: number; holding_by_exam: Holding[]; pending_issues: Issue[] };
type School = { id: number; name: string; district: string };
type Visit = { id: number; school_name: string; exam_name: string; copies: number; paid: number; debt: number; price_status: string; date: string; confirmation: string };

export default function FieldPage() {
  return <Shell allow={["sales"]}>{() => <FieldScreen />}</Shell>;
}

function FieldScreen() {
  const sum = useData<Field>("summary/field");
  const schools = useData<School[]>("schools");
  const visits = useData<Visit[]>("visits");
  const toast = useToast();
  const { busy, run } = useAction();
  const [pending, setPending] = useState<Awaited<ReturnType<typeof listPending>>>([]);
  const reload = useCallback(() => { sum.reload(); schools.reload(); visits.reload(); }, [sum, schools, visits]);

  const refreshOutbox = useCallback(async () => setPending(await listPending().catch(() => [])), []);
  const sendWaiting = useCallback(async () => {
    const r = await flush();
    if (r.sent) { toast(`${r.sent} saved visit${r.sent > 1 ? "s" : ""} sent`); reload(); }
    refreshOutbox();
  }, [toast, reload, refreshOutbox]);

  useEffect(() => {
    refreshOutbox();
    if (navigator.onLine) sendWaiting();
    window.addEventListener("online", sendWaiting);
    return () => window.removeEventListener("online", sendWaiting);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const s = sum.data;
  return (
    <>
      <ErrorNote error={sum.error} />
      <PageHead title="My field work" sub={<>Accept the copies the store gives you, then record every school you visit. With no network, visits save on your phone and send later.</>} />

      {!!s?.pending_issues.length && (
        <section className="block"><h3>Copies issued to you</h3>
          {s.pending_issues.map((x) => (
            <div className="ticket" key={x.id}>
              <div className="head"><div className="t"><div className="no">ISSUED {when(x.created_at).toUpperCase()} BY {x.by.toUpperCase()}</div><h3>{x.exam_name}</h3></div><div className="big">{fmt(x.qty)}</div></div>
              <div className="row">
                <button type="button" disabled={busy} onClick={() => run(() => api(`issues/${x.id}/accept`, { body: {} }), "Copies accepted").then(reload)}>I received {fmt(x.qty)} copies</button>
                <span className="mini">If the number is wrong, tell the store keeper before accepting.</span>
              </div>
            </div>
          ))}
        </section>
      )}

      <div className="kpis">
        <Kpi label="Copies with me" value={fmt(s?.holding)} />
        <Kpi label="Copies sold" value={fmt(s?.sold)} />
        <Kpi label="Cash to hand in" value={fmt(s?.cash_held)} bad={(s?.cash_held ?? 0) > 0} />
        <Kpi label="My schools owe" value={fmt(s?.debt)} />
      </div>

      {!!pending.length && (
        <section className="panel">
          <h3>Waiting to send ({pending.length})</h3>
          <Feed empty="" items={pending.map((p) => ({
            key: p.client_id, at: p.savedAt,
            text: <>{String(p.values.copies)} copies · {String(p.values["new_school.name"] || schools.data?.find((x) => String(x.id) === String(p.values.school))?.name || "school")}{p.error && <><br /><span style={{ color: "var(--bad)" }}>Not accepted: {p.error}</span></>}</>,
            act: p.error ? <button type="button" className="danger" onClick={async () => { await discard(p.client_id); refreshOutbox(); }}>Remove</button> : undefined,
          }))} />
          <div><button type="button" className="ghost" onClick={sendWaiting}>Send now</button></div>
        </section>
      )}

      <CloseMyDay onDone={reload} />

      {s && !s.holding_by_exam.length ? <EmptyCard icon="box">You hold no copies right now. Ask the store keeper to issue some, then accept them here to start recording school visits.</EmptyCard> :
      <VisitForm holding={s?.holding_by_exam ?? []} schools={schools.data ?? []} onSaved={(how) => { toast(how === "sent" ? "Visit saved" : "No network. Visit saved on your phone and will send later."); reload(); refreshOutbox(); }} />}

      <section className="panel"><h3>My recent visits</h3>
        <Feed empty="No visits recorded yet." items={(visits.data ?? []).slice(0, 15).map((v) => ({
          key: v.id, at: v.date,
          text: <><b>{v.school_name}</b> · {fmt(v.copies)} copies · paid {ugx(v.paid)}{v.debt > 0 && <> · <span style={{ color: "var(--bad)" }}>owes {ugx(v.debt)}</span></>}<br />
            <span className="mini">{v.exam_name}{v.price_status === "pending" ? " · discount waiting for owner" : v.price_status === "rejected" ? " · discount rejected, set price applies" : ""}{v.confirmation === "confirmed" ? " · school confirmed by SMS" : v.confirmation === "disputed" ? " · school disputed by SMS" : ""}</span></>,
          act: <CancelOrReport type="visit" id={v.id} onDone={reload} />,
        }))} />
      </section>
    </>
  );
}

function VisitForm({ holding, schools, onSaved }: { holding: Holding[]; schools: School[]; onSaved: (how: "sent" | "queued") => void }) {
  const { busy, run } = useAction();
  const [examId, setExamId] = useState<number | "">("");
  const [schoolId, setSchoolId] = useState("");
  const [copies, setCopies] = useState("");
  const [price, setPrice] = useState("");
  const [paid, setPaid] = useState("0");
  const [method, setMethod] = useState("cash");
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [formKey, setFormKey] = useState(0);
  const exam = holding.find((h) => h.exam === examId) ?? holding[0];
  useEffect(() => { if (exam && !price) setPrice(String(exam.price)); }, [exam, price]);
  const total = Number(copies || 0) * Number(price || 0);
  const owes = total - Number(paid || 0);
  const below = exam && Number(price) < exam.price;

  return (
    <section className="panel"><h3>Record a school visit</h3>
      <form key={formKey} onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        if (!exam) return;
        if (!photo) return run(async () => { throw new Error("Take a photo of the delivery note signed by the school."); });
        const values: Record<string, unknown> = {
          exam: exam.exam, date: f.get("date"), copies, price, paid, method, momo_id: f.get("momo_id"),
          note_no: f.get("note_no"), serials: f.get("serials"), due: f.get("due"), notes: f.get("notes"), price_reason: f.get("price_reason"),
        };
        if (schoolId === "__new") {
          Object.assign(values, { "new_school.name": f.get("ns_name"), "new_school.district": f.get("ns_district"), "new_school.contact": f.get("ns_contact"),
            "new_school.phone": f.get("ns_phone"), "new_school.candidates": f.get("ns_candidates") || 0 });
        } else values.school = schoolId;
        let how: "sent" | "queued" = "sent";
        const ok = await run(async () => {
          const pos = await where();
          if (pos) { values.latitude = pos.lat; values.longitude = pos.lng; }
          how = await submitVisit(values, photo);
        });
        if (ok) { setCopies(""); setPaid("0"); setPhoto(null); setSchoolId(""); setMethod("cash"); setFormKey((k) => k + 1); onSaved(how); }
      }}>
        <div className="grid2">
          <label>Exam<select value={exam?.exam ?? ""} onChange={(e) => { setExamId(Number(e.target.value)); setPrice(String(holding.find((h) => h.exam === Number(e.target.value))?.price ?? "")); }} required>
            {holding.length ? holding.map((h) => <option key={h.exam} value={h.exam}>{h.name} ({fmt(h.qty)} with you)</option>) : <option value="">You hold no copies</option>}
          </select></label>
          <label>Date<input name="date" type="date" required defaultValue={today()} /></label>
        </div>
        <label>School<select value={schoolId} onChange={(e) => setSchoolId(e.target.value)} required>
          <option value="">Choose the school…</option>
          {schools.map((s) => <option key={s.id} value={s.id}>{s.name}{s.district ? " · " + s.district : ""}</option>)}
          <option value="__new">+ Add a new school</option>
        </select></label>
        {schoolId === "__new" && (
          <div className="panel" style={{ background: "var(--paper)" }}>
            <p className="mini">Check the list first so the same school isn&apos;t added twice.</p>
            <div className="grid2">
              <label>School name<input name="ns_name" required placeholder="e.g. St. Mary's SS Kisubi" /></label>
              <label>District<input name="ns_district" placeholder="e.g. Wakiso" /></label>
            </div>
            <div className="grid3">
              <label>Contact person<input name="ns_contact" placeholder="e.g. Director of Studies" /></label>
              <label>Phone<input name="ns_phone" type="tel" inputMode="tel" placeholder="07…" /></label>
              <label>Number of candidates<input name="ns_candidates" type="number" min={0} inputMode="numeric" /></label>
            </div>
          </div>
        )}
        <div className="grid3">
          <label>Copies sold<input type="number" min={1} inputMode="numeric" required value={copies} onChange={(e) => setCopies(e.target.value)} /></label>
          <label>Price per copy (UGX)<input type="number" min={0} inputMode="numeric" required value={price} onChange={(e) => setPrice(e.target.value)} /></label>
          <label>Paid now (UGX)<input type="number" min={0} inputMode="numeric" required value={paid} onChange={(e) => setPaid(e.target.value)} /></label>
        </div>
        {exam?.numbered && <label>Serial numbers given to this school<input name="serials" required placeholder="e.g. 001-030" /></label>}
        <div className="grid2">
          <label>Paid by<select value={method} onChange={(e) => setMethod(e.target.value)}><option value="cash">Cash</option><option value="momo">Mobile money (to business number)</option><option value="unpaid">Not paid yet</option></select></label>
          <label>Promised to pay by (if owing)<input name="due" type="date" /></label>
        </div>
        {method === "momo" && <label>Mobile money transaction ID<input name="momo_id" required placeholder="From the payment SMS" /></label>}
        {below && <label>Reason for lower price<input name="price_reason" required placeholder="e.g. bought 200 copies" /></label>}
        <div className="grid2">
          <label>Delivery note number<input name="note_no" required placeholder="From the delivery note book" /></label>
          <PhotoInput id="note-photo" label="Photo of the delivery note signed by the school" value={photo} onChange={setPhoto} />
        </div>
        <label>Notes (optional)<textarea name="notes" placeholder="e.g. wants S.3 papers next term" /></label>
        <div className="calc">
          {below && <div style={{ gridColumn: "1/-1", color: "var(--warn)" }}>Below the set price of {fmt(exam.price)}. The owner must approve this discount.</div>}
          <div>Total<b>{fmt(total)}</b></div><div>Paid<b>{fmt(Number(paid || 0))}</b></div>
          <div>Owes<b style={{ color: owes > 0 ? "var(--bad)" : "var(--good)" }}>{fmt(Math.max(owes, 0))}</b></div>
        </div>
        <p className="mini" style={{ margin: 0 }}>Your location is saved with the visit. Allow location if your phone asks.</p>
        <div><button disabled={busy || !holding.length}>Save visit</button></div>
      </form>
    </section>
  );
}

/** The phone's location when the visit is saved, so the owner can see it was recorded at the school. */
function where(): Promise<{ lat: string; lng: string } | null> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude.toFixed(6), lng: p.coords.longitude.toFixed(6) }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 120000 },
    );
  });
}
