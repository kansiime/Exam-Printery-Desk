"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAction, useToast } from "./ui";

type Info = { number: string; path: string; whatsapp_text: string; phone: string; school: string; title: string };

/** Share a sale or payment receipt: WhatsApp to the school, open the PDF, or copy the message. */
export function ReceiptDialog({ kind, id, onClose }: { kind: "sale" | "payment"; id: number; onClose: () => void }) {
  const [info, setInfo] = useState<Info | null>(null);
  const { run } = useAction();
  const toast = useToast();
  useEffect(() => { run(async () => setInfo(await api<Info>(`receipts/${kind}/${id}`))); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [kind, id]);
  const link = info ? window.location.origin + info.path : "";
  const text = info ? info.whatsapp_text.replace("{link}", link) : "";
  return (
    <div className="guide-backdrop" role="dialog" aria-modal="true" aria-label="Receipt">
      <div className="guide">
        {!info ? <p className="sub">Preparing the receipt…</p> : <>
          <div className="mini">{info.title}</div>
          <h2>Receipt {info.number}</h2>
          <p className="sub" style={{ margin: 0 }}>Send it to {info.school} now so they have a record of what they got, paid and still owe.</p>
          <div className="row">
            <a className="btnlink" href={`https://wa.me/${info.phone}?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener">Send on WhatsApp</a>
            <a className="ghostlink" href={info.path} target="_blank" rel="noopener">Open PDF</a>
            <button type="button" className="ghost" onClick={async () => { try { await navigator.clipboard.writeText(text); toast("Message copied"); } catch { toast("Copy didn't work. Use WhatsApp or Open PDF."); } }}>Copy message</button>
          </div>
          {!info.phone && <p className="mini" style={{ margin: 0 }}>No phone number saved for this school, so WhatsApp asks you to choose the contact.</p>}
        </>}
        <div className="row"><span className="grow" /><button type="button" onClick={onClose}>Done</button></div>
      </div>
    </div>
  );
}

/** A small "Receipt" button that opens the dialog. */
export function ReceiptButton({ kind, id, label = "Receipt" }: { kind: "sale" | "payment"; id: number; label?: string }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className="ghost" onClick={() => setOpen(true)}>{label}</button>
    {open && <ReceiptDialog kind={kind} id={id} onClose={() => setOpen(false)} />}
  </>;
}
