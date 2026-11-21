"use client";
import { createContext, useContext, useRef, useState } from "react";
import { api } from "@/lib/api";
import { shrinkPhoto, when } from "@/lib/format";
import { useSession } from "@/lib/session";
import { Icon } from "./icons";

// ---- toast ----
const ToastCtx = createContext<(msg: string) => void>(() => {});
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [msg, setMsg] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = (m: string) => {
    setMsg(m);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(""), 3200);
  };
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div className="toast" role="status" hidden={!msg}>{msg}</div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/** Runs a save, shows the result, and reports errors in plain words. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    if (busy) return false;
    setBusy(true);
    try {
      await fn();
      if (ok) toast(ok);
      return true;
    } catch (e: any) {
      toast(e?.message || "Could not save. Try again.");
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

// ---- small pieces ----
export const Pill = ({ cls, children }: { cls: string; children: React.ReactNode }) => <span className={`pill ${cls}`}>{children}</span>;

export function Kpi({ label, value, bad }: { label: string; value: React.ReactNode; bad?: boolean }) {
  return (
    <div className="kpi">
      <div className="l">{label}</div>
      <div className={`v ${bad ? "bad" : ""}`}>{value}</div>
    </div>
  );
}

export function Findings({ items, empty }: { items: { level: string; text: string }[]; empty?: string }) {
  if (!items.length) return empty ? <div className="panel"><p className="empty">{empty}</p></div> : null;
  return (
    <ul className="alerts">
      {items.map((f, i) => <li key={i} className={f.level === "bad" ? "bad" : ""}>{f.text}</li>)}
    </ul>
  );
}

export type FeedItem = { key: string | number; at?: string | null; text: React.ReactNode; act?: React.ReactNode };
export function Feed({ items, empty }: { items: FeedItem[]; empty: string }) {
  if (!items.length) return <p className="empty">{empty}</p>;
  return (
    <ul className="feed">
      {items.map((i) => (
        <li key={i.key}>
          <time>{when(i.at)}</time>
          <span className="grow">{i.text}</span>
          {i.act && <span className="act">{i.act}</span>}
        </li>
      ))}
    </ul>
  );
}

export function Thumb({ src }: { src?: string | null }) {
  if (!src) return <span className="mini" style={{ color: "var(--bad)" }}>none</span>;
  return <a href={src} target="_blank" rel="noopener"><img className="thumb" src={src} alt="Photo" /></a>;
}

/** Camera input that shrinks the photo and hands back a Blob. */
export function PhotoInput({ label, value, onChange, id }: { label: string; value: Blob | null; onChange: (b: Blob | null) => void; id: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <label>
      {label}
      <input id={id} type="file" accept="image/*" capture="environment"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return onChange(null);
          setBusy(true);
          onChange(await shrinkPhoto(f));
          setBusy(false);
        }} />
      {busy ? <span className="mini">Preparing photo…</span> : value ? <span className="mini" style={{ color: "var(--good)" }}>Photo attached ✓</span> : null}
    </label>
  );
}

/** Owner: cancel with a reason (kept in history). Everyone else: report a mistake to the owner. */
export function CancelOrReport({ type, id, onDone }: { type: string; id: number; onDone: () => void }) {
  const { me } = useSession();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const { busy, run } = useAction();
  const owner = me?.role === "owner";
  if (!open) return <button type="button" className={owner ? "danger" : "ghost"} onClick={() => setOpen(true)}>{owner ? "Cancel" : "Report mistake"}</button>;
  return (
    <form className="row" onSubmit={async (e) => {
      e.preventDefault();
      const ok = await run(() => owner
        ? api("cancel", { body: { type, id, reason } })
        : api("corrections", { body: { target_type: type, target_id: id, reason } }),
        owner ? "Cancelled. It stays in the cancelled records list." : "Sent to the owner");
      if (ok) { setOpen(false); onDone(); }
    }}>
      <input required value={reason} onChange={(e) => setReason(e.target.value)} placeholder={owner ? "Reason for cancelling" : "What is wrong?"} style={{ width: 170 }} autoFocus />
      <button disabled={busy}>{owner ? "Cancel it" : "Send"}</button>
      <button type="button" className="ghost" onClick={() => setOpen(false)}>Back</button>
    </form>
  );
}

export function ErrorNote({ error }: { error: string }) {
  return error ? <div className="banner">{error} Figures shown may be out of date.</div> : null;
}

// ---- layout helpers ----
export function PageHead({ title, sub, children }: { title: string; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="pagehead">
      <div className="grow"><h1>{title}</h1>{sub && <p className="sub">{sub}</p>}</div>
      {children}
    </div>
  );
}

/** A form or tool that stays folded until needed, so screens stay short on phones. */
export function Disclosure({ title, sub, icon = "plus", primary, defaultOpen, children }: {
  title: string; sub?: string; icon?: string; primary?: boolean; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <section className={`disclosure ${primary ? "primary" : ""}`} data-open={open}>
      <button type="button" className="dhead" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="dicon"><Icon name={icon} /></span>
        <span className="dtitle"><b>{title}</b>{sub && <span className="sub">{sub}</span>}</span>
        <span className="chev"><Icon name="chevron" /></span>
      </button>
      {open && <div className="dbody">{children}</div>}
    </section>
  );
}

export function EmptyCard({ icon = "inbox", children }: { icon?: string; children: React.ReactNode }) {
  return <div className="panel emptycard"><div><Icon name={icon} size={36} /></div><p className="empty">{children}</p></div>;
}

export type Column<T> = { label: string; cell: (row: T) => React.ReactNode; bad?: (row: T) => boolean };

/** A table on computers that becomes one card per row on phones. */
export function DataTable<T>({ columns, rows, rowKey, empty }: { columns: Column<T>[]; rows: T[]; rowKey: (r: T) => string | number; empty: string }) {
  if (!rows.length) return <EmptyCard>{empty}</EmptyCard>;
  return (
    <div className="tablewrap cards">
      <table>
        <thead><tr>{columns.map((c) => <th key={c.label}>{c.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)}>
              {columns.map((c) => <td key={c.label} data-label={c.label} className={c.bad?.(r) ? "bad" : ""}>{c.cell(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Owner: make a one-time password reset code and pass it on by WhatsApp, a call, or in person. */
export function GiveResetCode({ userId, label = "Create reset code", onDone }: { userId: number; label?: string; onDone?: () => void }) {
  const [given, setGiven] = useState<{ code: string; name: string; phone: string; message: string; hours: number } | null>(null);
  const { busy, run } = useAction();
  const toast = useToast();
  if (!given) {
    return <button type="button" className="ghost" disabled={busy} onClick={() => run(async () => { setGiven(await api(`users/${userId}/reset-code`, { body: {} })); onDone?.(); })}>{label}</button>;
  }
  const digits = given.phone.replace(/\D/g, "");
  const intl = digits.startsWith("0") && digits.length === 10 ? "256" + digits.slice(1) : digits;
  const wa = `https://wa.me/${intl}?text=${encodeURIComponent(given.message)}`;
  return (
    <div className="panel" style={{ background: "var(--surface-2)", gap: 10 }}>
      <p className="mini" style={{ margin: 0 }}>Reset code for {given.name}. It works once, within {given.hours} hours:</p>
      <div className="big" style={{ letterSpacing: ".15em" }}>{given.code}</div>
      <div className="row">
        <a className="btnlink" href={wa} target="_blank" rel="noopener">Send on WhatsApp</a>
        <button type="button" className="ghost" onClick={async () => {
          try { await navigator.clipboard.writeText(given.message); toast("Message copied"); } catch { toast("Copy didn't work. Read the code out instead."); }
        }}>Copy message</button>
      </div>
      <p className="mini" style={{ margin: 0 }}>{given.phone ? `WhatsApp opens a chat with ${given.phone}.` : "No phone number saved, so WhatsApp asks you to choose the contact."} Or read the code out to them.</p>
    </div>
  );
}
