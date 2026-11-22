"use client";
import { Shell } from "@/components/Shell";
import { DataTable, Disclosure, EmptyCard, ErrorNote, Feed, Findings, PageHead, Pill, Thumb, useAction } from "@/components/ui";
import { ReceiptButton } from "@/components/Receipt";
import { api } from "@/lib/api";
import { fmt, ugx, when } from "@/lib/format";
import { useData } from "@/lib/session";

type MeterRow = { exam: string; exam_id: number; machine: string; qty: number; pages: number; meter_before: number; meter_after: number | null; meter_pages: number | null; expected: number; extra: number | null; photo_before: string | null; photo_after: string | null };
type Weekly = { id: number; name: string; contact: string; copies: number; value: number; paid: number; sellers: string; serials: string };
type Sale = { latitude: string | null; longitude: string | null; id: number; school_name: string; exam_name: string; note_no: string; copies: number; paid: number; method: string; momo_id: string; sales_name: string; note_photo: string | null; date: string };
type Audit = { findings: { level: string; text: string }[]; meter: MeterRow[]; gaps: { machine: string; pages: number; after: string; before: string }[];
  paper: { issued: number; used: number; left: number }; momo: { statement_count: number; recorded_count: number; unmatched_statement: { id: number; tx_id: string; amount: number }[] };
  weekly_schools: Weekly[]; recent_sales: Sale[] };
type Count = { id: number; created_at: string; paper_counted: number | null; paper_expected: number | null; items: { exam: string; counted: number; expected: number }[] };
type Check = { id: number; kind: string; name: string; result: string; note: string; created_at: string };
type Cancelled = { type: string; id: number; label: string; reason: string; cancelled_at: string; by: string };
type StoreExam = { id: number; name: string; counted: number | null };

const RESULT: Record<string, [string, string]> = { match: ["p-ready", "Matches"], mismatch: ["p-bad", "Does not match"], noreach: ["p-done", "Not reached"] };

export default function FraudPage() {
  return <Shell allow={["owner"]}>{() => <Fraud />}</Shell>;
}

function Fraud() {
  const a = useData<Audit>("summary/audit");
  const counts = useData<Count[]>("counts");
  const checks = useData<Check[]>("checks");
  const cancelled = useData<Cancelled[]>("cancelled");
  const store = useData<{ exams: StoreExam[] }>("summary/store");
  const { busy, run } = useAction();
  const reload = () => { a.reload(); counts.reload(); checks.reload(); store.reload(); };
  const d = a.data;

  return (
    <>
      <ErrorNote error={a.error} />
      <PageHead title="Fraud checks" sub={<>These checks compare records the printer and store keeper can&apos;t both control: the copier meter, paper, serial numbers, surprise counts, mobile money and the schools themselves.</>} />
      <section className="block"><h3>Findings</h3><Findings items={d?.findings ?? []} empty="No problems found in the records so far." /></section>

      <section className="block"><div><h3>Copier meter vs copies posted</h3><p className="sub">Expected pages = copies × pages per copy + spoilt sheets. Tap a photo to check it matches the typed reading.</p></div>
        <DataTable<MeterRow> rows={d?.meter ?? []} rowKey={(r) => r.exam_id} empty="No finished print jobs yet."
          columns={[
            { label: "Exam", cell: (r) => <><b>{r.exam}</b><br /><span className="mini">{r.machine} · meter {fmt(r.meter_before)} → {fmt(r.meter_after)}</span></> },
            { label: "Copies", cell: (r) => fmt(r.qty) },
            { label: "Pages per copy", cell: (r) => fmt(r.pages) },
            { label: "Expected pages", cell: (r) => fmt(r.expected) },
            { label: "Copier pages", cell: (r) => fmt(r.meter_pages) },
            { label: "Extra pages", cell: (r) => (r.extra == null ? "–" : (r.extra > 0 ? "+" : "") + fmt(r.extra)), bad: (r) => (r.extra ?? 0) > Math.max(r.pages, 1) },
            { label: "Meter before", cell: (r) => <Thumb src={r.photo_before} /> },
            { label: "Meter after", cell: (r) => <Thumb src={r.photo_after} /> },
          ]} />
        {!!d?.gaps.length && <div className="panel"><h3>Pages with no record</h3><Feed empty="" items={d.gaps.map((g, i) => ({ key: i, text: <><b>{fmt(g.pages)} pages</b> on {g.machine} between “{g.after}” and “{g.before}”</> }))} /></div>}
      </section>

      <Disclosure title="Mobile money statement" sub="Paste payments from your statement to check every mobile money sale" icon="coins">
        <p className="sub" style={{ margin: 0 }}>Paste payments from your mobile money statement or SMS list, one per line: transaction ID, then amount. Every mobile money sale your team records must appear here. Payment providers can also send these automatically (see the setup guide).</p>
        <form onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget, f = new FormData(form);
          let msg = "";
          const ok = await run(async () => { const r = await api<{ added: number; already_there: number }>("momo/paste", { body: { text: f.get("text") } }); msg = `${r.added} added, ${r.already_there} already there`; });
          if (ok) { form.reset(); reload(); run(async () => {}, msg); }
        }}>
          <label>Payments received<textarea name="text" required placeholder={"e.g.\n12345678901, 60000\n12345678902 40,000"} /></label>
          <div><button disabled={busy}>Add to statement</button></div>
        </form>
        <p className="mini">{fmt(d?.momo.statement_count)} statement payments entered · {fmt(d?.momo.recorded_count)} mobile money payments recorded by the team
          {!!d?.momo.unmatched_statement.length && <> · on your statement with no sale recorded: {d.momo.unmatched_statement.slice(0, 8).map((m) => `${m.tx_id} ${fmt(m.amount)}`).join(", ")}</>}</p>
      </Disclosure>

      <section className="block"><div><h3>Recent sales and delivery notes</h3><p className="sub">Tap a photo to check the school&apos;s signature, copies and amount.</p></div>
        <DataTable<Sale> rows={d?.recent_sales ?? []} rowKey={(v) => v.id} empty="No sales yet."
          columns={[
            { label: "School", cell: (v) => <><b>{v.school_name}</b><br /><span className="mini">{when(v.date)} · {v.exam_name}</span></> },
            { label: "Delivery note", cell: (v) => v.note_no },
            { label: "Copies", cell: (v) => fmt(v.copies) },
            { label: "Paid", cell: (v) => fmt(v.paid) },
            { label: "How", cell: (v) => (v.method === "momo" ? <>Mobile money<br /><span className="mini">{v.momo_id}</span></> : v.method === "cash" ? "Cash" : "Not paid") },
            { label: "Sold by", cell: (v) => v.sales_name },
            { label: "Where", cell: (v) => v.latitude ? <a href={`https://maps.google.com/?q=${v.latitude},${v.longitude}`} target="_blank" rel="noopener">Map</a> : <span className="mini" style={{ color: "var(--bad)" }}>No location</span> },
            { label: "Photo", cell: (v) => <Thumb src={v.note_photo} /> },
            { label: "Receipt", cell: (v) => <ReceiptButton kind="sale" id={v.id} /> },
          ]} />
      </section>

      <Disclosure title="Paper" sub="Record reams you give the printer" icon="box">
        <p className="sub" style={{ margin: 0 }}>Record every ream you give the printer. Sheets used is worked out from the copier meter.</p>
        <div className="calc"><div>Sheets given<b>{fmt(d?.paper.issued)}</b></div><div>Used (meter)<b>{fmt(d?.paper.used)}</b></div><div>Should be left<b>{fmt(d?.paper.left)}</b></div></div>
        <form className="grid3" onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget, f = new FormData(form);
          if (await run(() => api("paper", { body: { reams: Number(f.get("reams")), sheets_per_ream: Number(f.get("per")) } }), "Paper recorded")) { form.reset(); reload(); }
        }}>
          <label>Reams given<input name="reams" type="number" min={1} inputMode="numeric" required /></label>
          <label>Sheets per ream<input name="per" type="number" min={1} inputMode="numeric" required defaultValue={500} /></label>
          <label>&nbsp;<button disabled={busy}>Record paper given</button></label>
        </form>
      </Disclosure>

      <Disclosure title="Surprise stock count" sub="Count when nobody expects it" icon="check">
        <p className="sub" style={{ margin: 0 }}>Count when nobody expects it. The expected figures stay hidden until you save, so the count is honest.</p>
        <form onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget, f = new FormData(form);
          const items = (store.data?.exams ?? []).filter((x) => x.counted != null).map((x) => ({ exam: x.id, counted: f.get("c" + x.id) as string }));
          if (await run(() => api("counts", { body: { items, paper_counted: f.get("paper") || null } }), "Count saved. Compare it below.")) { form.reset(); reload(); }
        }}>
          <div className="grid2">{(store.data?.exams ?? []).filter((x) => x.counted != null).map((x) => <label key={x.id}>{x.name}: copies in store<input name={"c" + x.id} type="number" min={0} inputMode="numeric" /></label>)}</div>
          <label>Blank paper sheets at the printer<input name="paper" type="number" min={0} inputMode="numeric" placeholder="Leave empty if not counted" /></label>
          <div><button disabled={busy}>Save count</button></div>
        </form>
        <Feed empty="No counts yet." items={(counts.data ?? []).map((c) => ({
          key: c.id, at: c.created_at,
          text: <>{c.items.map((i, k) => <div key={k}>{i.exam}: counted {fmt(i.counted)}, records {fmt(i.expected)} {i.counted !== i.expected ? <b style={{ color: "var(--bad)" }}>({i.counted - i.expected > 0 ? "+" : ""}{fmt(i.counted - i.expected)})</b> : "✓"}</div>)}
            {c.paper_counted != null && <div>Paper: counted {fmt(c.paper_counted)}, expected {fmt(c.paper_expected)}</div>}</>,
        }))} />
      </Disclosure>

      <section className="block"><div><h3>This week&apos;s school calls</h3><p className="sub">Ask each school how many copies it received, from whom, and what it paid. The list changes each week and skips schools checked in the last 30 days. Schools with a phone number are also asked by SMS after every sale.</p></div>
        {(d?.weekly_schools ?? []).map((s) => (
          <div className="ticket" key={s.id}>
            <div className="head"><div className="t"><h3>{s.name}</h3><p className="sub">{s.contact || "No contact recorded"}</p></div></div>
            <p className="mini">Records say: <b>{fmt(s.copies)} copies</b> for {ugx(s.value)}, paid {ugx(s.paid)}, sold by {s.sellers}{s.serials ? ` · serials ${s.serials}` : ""}</p>
            <form className="grid3" onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              if (await run(() => api("checks", { body: { kind: "call", school: s.id, result: f.get("result"), note: f.get("note") || "" } }), "Call saved")) reload();
            }}>
              <label>Result<select name="result"><option value="match">Matches records</option><option value="mismatch">Does not match</option><option value="noreach">Could not reach</option></select></label>
              <label>What they said<input name="note" placeholder="e.g. got 40, paid 80,000" /></label>
              <label>&nbsp;<button disabled={busy}>Save call</button></label>
            </form>
          </div>
        ))}
        {!d?.weekly_schools.length && <EmptyCard icon="school">No schools to call yet. Schools appear once sales are recorded.</EmptyCard>}
        <div className="panel"><h3>Found a school using our exams that isn&apos;t in the records?</h3>
          <form className="grid3" onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget, f = new FormData(form);
            if (await run(() => api("checks", { body: { kind: "leak", school_name: f.get("school"), note: f.get("note") || "" } }), "Reported")) { form.reset(); reload(); }
          }}>
            <label>School<input name="school" required /></label>
            <label>Details<input name="note" placeholder="e.g. has S.4 Maths serial 112, got it from …" /></label>
            <label>&nbsp;<button disabled={busy}>Report</button></label>
          </form>
        </div>
        <div className="panel"><h3>Recent checks</h3>
          <Feed empty="No checks yet." items={(checks.data ?? []).slice(0, 12).map((c) => ({ key: c.id, at: c.created_at,
            text: <>{c.kind === "leak" ? <Pill cls="p-bad">Not in records</Pill> : RESULT[c.result] ? <Pill cls={RESULT[c.result][0]}>{RESULT[c.result][1]}</Pill> : null} <b>{c.name}</b> {c.kind === "sms" ? "(SMS reply) " : ""}{c.note}</> }))} />
        </div>
      </section>

      <section className="panel"><div><h3>Cancelled records</h3><p className="sub">Nothing is deleted. Cancelled records are kept with the reason, and every change is in the history.</p></div>
        <Feed empty="Nothing cancelled." items={(cancelled.data ?? []).map((c) => ({ key: c.type + c.id, at: c.cancelled_at, text: <>{c.label} · cancelled by {c.by}: “{c.reason}”</> }))} />
      </section>
    </>
  );
}
