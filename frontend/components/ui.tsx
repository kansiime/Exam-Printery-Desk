"use client";
import { createContext, useContext, useRef, useState } from "react";
import { api } from "@/lib/api";
import { shrinkPhoto, when } from "@/lib/format";
import { useSession } from "@/lib/session";

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
