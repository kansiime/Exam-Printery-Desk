"use client";
import { useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { EmptyCard, ErrorNote, PageHead, useAction } from "@/components/ui";
import { api } from "@/lib/api";
import { fmt, when } from "@/lib/format";
import { useData } from "@/lib/session";

const DAYS: { day: string; tasks: string[] }[] = [
  { day: "Before day 1", tasks: ["Create every worker's account on Team (with phone numbers)", "Each worker signs in on their own phone and reads the guide",
    "Everyone taps the bell and turns on alerts", "Set commission rates for sales people on Team", "Have sticker paper ready if you will use QR codes"] },
  { day: "Day 1: printing and counting", tasks: ["Post one real print order", "Printer records meter before and after, with photos", "Store keeper counts and records the serial range",
    "Write the same figures on paper as you normally do", "Compare on this page: printed and counted"] },
  { day: "Day 2–4: selling", tasks: ["Store issues copies to sales people; they accept on their phones", "Sales people record every school with delivery note photos",
    "Each evening: sales people close their day, store keeper confirms", "Cash goes to the store keeper, then to you; confirm it in the app"] },
  { day: "Day 5: check everything", tasks: ["Compare paper and system figures below for the exam", "Call 3 schools from Fraud checks and record what they say",
    "Do one surprise stock count", "Read the problems and ideas your team sent", "Download the Excel report and check it"] },
  { day: "After the pilot", tasks: ["Fix or ask about anything that didn't match", "Decide on: cloud photo storage, paid plan, SMS", "Stop the paper copy once figures match for a full batch"] },
];

type Fig = { key: string; label: string; system: number };

export default function PilotPage() {
  return <Shell allow={["owner"]}>{() => <Pilot />}</Shell>;
}

function Pilot() {
  const [done, setDone] = useState<Record<string, boolean>>({});
  useEffect(() => { try { setDone(JSON.parse(localStorage.getItem("pilot-checklist") || "{}")); } catch {} }, []);
  const toggle = (k: string) => setDone((d) => { const n = { ...d, [k]: !d[k] }; try { localStorage.setItem("pilot-checklist", JSON.stringify(n)); } catch {} return n; });
  const total = DAYS.reduce((a, d) => a + d.tasks.length, 0), ticked = Object.values(done).filter(Boolean).length;

  return (
    <>
      <PageHead title="Pilot week" sub="Run one real exam batch through the system while still keeping your paper records. Tick each step, compare the figures, and read what your team reports." />
      <section className="panel">
        <div className="sectiontitle"><h2>Checklist</h2><span className="count">{ticked} / {total}</span></div>
        {DAYS.map((d) => (
          <div key={d.day} style={{ display: "grid", gap: 6 }}>
            <h3>{d.day}</h3>
            {d.tasks.map((task) => {
              const k = d.day + ":" + task;
              return <label key={k} className="check"><input type="checkbox" checked={!!done[k]} onChange={() => toggle(k)} /><span style={{ textDecoration: done[k] ? "line-through" : "none" }}>{task}</span></label>;
            })}
          </div>
        ))}
        <p className="mini" style={{ margin: 0 }}>Ticks are saved on this phone or computer.</p>
      </section>
      <Compare />
      <FeedbackInbox />
    </>
  );
}

function Compare() {
  const exams = useData<{ id: number; name: string }[]>("exams");
  const [examId, setExamId] = useState("");
  const [figs, setFigs] = useState<Fig[] | null>(null);
  const [paper, setPaper] = useState<Record<string, string>>({});
  const { run } = useAction();
  useEffect(() => { if (!examId && exams.data?.length) setExamId(String(exams.data[0].id)); }, [exams.data, examId]);
  useEffect(() => {
    if (!examId) return;
    run(async () => setFigs((await api<{ figures: Fig[] }>(`pilot/compare?exam=${examId}`)).figures));
    try { setPaper(JSON.parse(localStorage.getItem("pilot-paper-" + examId) || "{}")); } catch { setPaper({}); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examId]);
  const setP = (k: string, v: string) => setPaper((p) => { const n = { ...p, [k]: v }; try { localStorage.setItem("pilot-paper-" + examId, JSON.stringify(n)); } catch {} return n; });
  return (
    <section className="panel">
      <div><h2>Paper vs system</h2><p className="sub">Type the figures from your paper records. Any difference shows in red; find out why before you stop using paper.</p></div>
      <label>Exam<select value={examId} onChange={(e) => setExamId(e.target.value)}>{(exams.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      {figs && (
        <div className="tablewrap cards"><table>
          <thead><tr><th>Figure</th><th>System</th><th>Paper</th><th>Difference</th></tr></thead>
          <tbody>{figs.map((f) => {
            const p = paper[f.key];
            const diff = p === undefined || p === "" ? null : Number(p) - f.system;
            return (
              <tr key={f.key}>
                <td data-label="Figure"><b>{f.label}</b></td>
                <td data-label="System">{fmt(f.system)}</td>
                <td data-label="Paper"><input type="number" inputMode="numeric" value={p ?? ""} onChange={(e) => setP(f.key, e.target.value)} style={{ maxWidth: 140, minHeight: 38, padding: "6px 10px" }} /></td>
                <td data-label="Difference" className={diff ? "bad" : ""}>{diff === null ? "–" : diff === 0 ? "✓ same" : (diff > 0 ? "+" : "") + fmt(diff)}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}
    </section>
  );
}

type FB = { id: number; text: string; page: string; created_at: string; resolved_at: string | null; by: string };

function FeedbackInbox() {
  const fb = useData<FB[]>("feedback");
  const { run } = useAction();
  const open = (fb.data ?? []).filter((f) => !f.resolved_at);
  return (
    <section className="block">
      <div className="sectiontitle"><h2>Problems and ideas from your team</h2>{!!open.length && <span className="count">{open.length}</span>}</div>
      <p className="sub" style={{ margin: 0 }}>Anyone can send these from their account menu → “Report a problem or idea”. Forward the ones you want changed.</p>
      <ErrorNote error={fb.error} />
      {open.length ? open.map((f) => (
        <div className="ticket" key={f.id}>
          <p style={{ margin: 0 }}>{f.text}</p>
          <div className="row"><span className="mini grow">{f.by} · {when(f.created_at)}{f.page ? ` · on ${f.page}` : ""}</span>
            <button type="button" className="ghost" onClick={() => run(() => api(`feedback/${f.id}/resolve`, { body: {} }), "Marked as dealt with").then(fb.reload)}>Dealt with</button></div>
        </div>
      )) : <EmptyCard icon="check">Nothing reported yet.</EmptyCard>}
    </section>
  );
}
