"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { fmt, ugx, when } from "@/lib/format";
import { useData } from "@/lib/session";
import { Disclosure, Pill, useAction } from "./ui";

type CloseRow = { id: number; date: string; sales: string; copies: { exam: string; declared: number; expected: number }[]; cash_declared: number; cash_expected: number;
  cash_gap: number; copy_gaps: number; note: string; created_at: string; confirmed_at: string | null; confirmed_by: string; store_result: string; store_note: string };
type Data = { closes: CloseRow[]; mine: { holding: { exam: number; name: string; qty: number }[]; today: CloseRow | null } | null };

function Status({ c }: { c: CloseRow }) {
  if (c.confirmed_at) return c.store_result === "match" ? <Pill cls="p-ready">Confirmed</Pill> : <Pill cls="p-bad">Store: not matching</Pill>;
  return c.copy_gaps || c.cash_gap ? <Pill cls="p-bad">Gap</Pill> : <Pill cls="p-fold">Waiting for store</Pill>;
}

function Gaps({ c }: { c: CloseRow }) {
  return (
    <ul className="feed">
      {c.copies.map((x) => (
        <li key={x.exam}><span className="grow">{x.exam}: says <b>{fmt(x.declared)}</b>, records {fmt(x.expected)}</span>
          {x.declared !== x.expected && <b style={{ color: "var(--bad)" }}>{x.declared - x.expected > 0 ? "+" : ""}{fmt(x.declared - x.expected)}</b>}</li>
      ))}
      <li><span className="grow">Cash: says <b>{ugx(c.cash_declared)}</b>, records {ugx(c.cash_expected)}</span>
        {!!c.cash_gap && <b style={{ color: "var(--bad)" }}>{c.cash_gap > 0 ? "+" : ""}{fmt(c.cash_gap)}</b>}</li>
    </ul>
  );
}

/** Sales person: count copies and cash at the end of the day. */
export function CloseMyDay({ onDone }: { onDone?: () => void }) {
  const d = useData<Data>("day-close");
  const { busy, run } = useAction();
  const mine = d.data?.mine;
  const today = mine?.today;
  return (
    <Disclosure title={today ? "Today is closed" : "Close my day"} sub={today ? "You can correct it until the store keeper confirms" : "Count the copies and cash you have now"}
      icon="check" primary={!today}>
      {today && <div className="row"><Status c={today} />{today.store_note && <span className="mini">{today.store_note}</span>}</div>}
      {today && <Gaps c={today} />}
      {!today?.confirmed_at && (
        <form onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const copies: Record<string, number> = {};
          (mine?.holding ?? []).forEach((h) => { copies[h.exam] = Number(f.get("c" + h.exam) || 0); });
          const ok = await run(() => api("day-close", { body: { copies, cash: Number(f.get("cash") || 0), note: f.get("note") || "" } }), "Day closed. The store keeper will confirm.");
          if (ok) { d.reload(); onDone?.(); }
        }}>
          <p className="sub" style={{ margin: 0 }}>Count what you physically have. Don&apos;t copy the system&apos;s figures: the owner compares the two.</p>
          {(mine?.holding ?? []).map((h) => (
            <label key={h.exam}>{h.name}: copies in my hands<input name={"c" + h.exam} type="number" min={0} inputMode="numeric" required /></label>
          ))}
          {!mine?.holding.length && <p className="mini" style={{ margin: 0 }}>The system says you hold no copies. If you have some, tell the store keeper.</p>}
          <label>Cash in my hands (UGX)<input name="cash" type="number" min={0} inputMode="numeric" required /></label>
          <label>Note (optional)<input name="note" placeholder="e.g. one copy torn, returned tomorrow" /></label>
          <div><button disabled={busy}>{today ? "Correct my close" : "Close my day"}</button></div>
        </form>
      )}
    </Disclosure>
  );
}

/** Store keeper / owner: confirm the day closes of sales people. */
export function DayClosesToConfirm() {
  const d = useData<Data>("day-close");
  const { busy, run } = useAction();
  const [notes, setNotes] = useState<Record<number, string>>({});
  const open = (d.data?.closes ?? []).filter((c) => !c.confirmed_at);
  const done = (d.data?.closes ?? []).filter((c) => c.confirmed_at).slice(0, 6);
  const confirm = (c: CloseRow, result: "match" | "mismatch") =>
    run(() => api(`day-close/${c.id}/confirm`, { body: { result, note: notes[c.id] || "" } }), result === "match" ? "Confirmed" : "Marked as not matching. The owner is told.").then(d.reload);
  return (
    <section className="block">
      <div className="sectiontitle"><h3>Day closes to confirm</h3>{!!open.length && <span className="count">{open.length}</span>}</div>
      {open.length ? open.map((c) => (
        <div className="ticket" key={c.id}>
          <div className="head"><div className="t"><h3>{c.sales}</h3><p className="sub">{when(c.date)} · closed {when(c.created_at)}{c.note ? ` · “${c.note}”` : ""}</p></div><Status c={c} /></div>
          <Gaps c={c} />
          <p className="mini" style={{ margin: 0 }}>Check the returned copies and cash you received match what they say.</p>
          <label>Your note (optional)<input value={notes[c.id] ?? ""} onChange={(e) => setNotes({ ...notes, [c.id]: e.target.value })} placeholder="e.g. counted 9 copies, not 10" /></label>
          <div className="row">
            <button type="button" disabled={busy} onClick={() => confirm(c, "match")}>It matches</button>
            <button type="button" className="danger" disabled={busy} onClick={() => confirm(c, "mismatch")}>Doesn&apos;t match</button>
          </div>
        </div>
      )) : <p className="empty">No day closes waiting.</p>}
      {!!done.length && (
        <div className="panel"><h3>Recently confirmed</h3>
          <ul className="feed">{done.map((c) => <li key={c.id}><time>{when(c.date)}</time><span className="grow">{c.sales} · confirmed by {c.confirmed_by}</span><Status c={c} /></li>)}</ul>
        </div>
      )}
    </section>
  );
}
