"use client";
import { useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { EmptyCard, PageHead, Pill, useAction } from "@/components/ui";
import { api } from "@/lib/api";
import { when } from "@/lib/format";

type Change = { field: string; old: string; new: string };
type Item = { at: string; kind: string; record_id: number; label: string; action: "created" | "changed" | "deleted" | "cancelled"; by: string; changes: Change[] };
type Data = { items: Item[]; kinds: string[]; people: { id: number; name: string }[]; next_before: string | null };

const ACTION: Record<Item["action"], [string, string]> = { created: ["p-ready", "Created"], changed: ["p-fold", "Changed"], cancelled: ["p-bad", "Cancelled"], deleted: ["p-bad", "Deleted"] };

export default function HistoryPage() {
  return <Shell allow={["owner"]}>{() => <History />}</Shell>;
}

function History() {
  const [person, setPerson] = useState("");
  const [kind, setKind] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [meta, setMeta] = useState<Omit<Data, "items"> | null>(null);
  const { busy, run } = useAction();
  const load = (before?: string | null) => run(async () => {
    const q = new URLSearchParams();
    if (person) q.set("person", person);
    if (kind) q.set("kind", kind);
    if (before) q.set("before", before);
    const d = await api<Data>(`history${q.size ? "?" + q : ""}`);
    setItems((cur) => (before ? [...cur, ...d.items] : d.items));
    setMeta(d);
  });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [person, kind]);

  return (
    <>
      <PageHead title="Change history" sub="Every record created, changed or cancelled: who did it, when, and what the old and new values were. Nothing here can be edited." />
      <div className="grid2">
        <label>Person<select value={person} onChange={(e) => setPerson(e.target.value)}><option value="">Everyone</option>{meta?.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>Kind of record<select value={kind} onChange={(e) => setKind(e.target.value)}><option value="">Everything</option>{meta?.kinds.map((k) => <option key={k}>{k}</option>)}</select></label>
      </div>
      {items.length ? (
        <section className="panel">
          <ul className="feed">
            {items.map((i, n) => (
              <li key={`${i.kind}-${i.record_id}-${n}`}>
                <time>{when(i.at)}</time>
                <span className="grow">
                  <Pill cls={ACTION[i.action][0]}>{ACTION[i.action][1]}</Pill> <b>{i.kind}</b>: {i.label}
                  <br /><span className="mini">by {i.by}</span>
                  {!!i.changes.length && (
                    <span className="changes">{i.changes.map((c) => (
                      <span key={c.field}><b>{c.field}:</b> <s>{c.old}</s> → {c.new}</span>
                    ))}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {meta?.next_before && <div><button type="button" className="ghost" disabled={busy} onClick={() => load(meta.next_before)}>Show older</button></div>}
        </section>
      ) : <EmptyCard icon="clock">{busy ? "Loading…" : "Nothing recorded for this choice yet."}</EmptyCard>}
    </>
  );
}
