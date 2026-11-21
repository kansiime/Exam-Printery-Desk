"use client";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { ErrorNote, PageHead, useAction } from "@/components/ui";
import { api } from "@/lib/api";
import { useData } from "@/lib/session";

type Exam = { id: number; name: string; numbered: boolean; closed_at: string | null };
type Code = { serial: number; svg: string };

export default function QrPage() {
  return <Shell allow={["owner", "printer"]}>{() => <Stickers />}</Shell>;
}

function Stickers() {
  const exams = useData<Exam[]>("exams");
  const { busy, run } = useAction();
  const [sheet, setSheet] = useState<{ exam: string; codes: Code[] } | null>(null);
  const [examId, setExamId] = useState("");
  useEffect(() => { if (!examId && exams.data?.length) setExamId(String(exams.data.find((e) => e.numbered)?.id ?? exams.data[0].id)); }, [exams.data, examId]);

  return (
    <>
      <ErrorNote error={exams.error} />
      <div className="noprint">
        <PageHead title="QR code stickers" sub="Print these on sticker paper and put one on each copy, matching its serial number. Anyone can scan a copy with a phone camera to see if it is genuine and which school it was sold to. Unsold, extra or fake copies alert the owner." />
        <section className="panel">
          <form onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            await run(async () => {
              const q = new URLSearchParams();
              if (f.get("from")) q.set("from", String(f.get("from")));
              if (f.get("to")) q.set("to", String(f.get("to")));
              const r = await api<{ exam: string; codes: { serial: number; sig: string }[] }>(`exams/${examId}/qr-codes${q.size ? "?" + q : ""}`);
              const origin = window.location.origin;
              const codes = await Promise.all(r.codes.map(async (c) => ({
                serial: c.serial,
                svg: await QRCode.toString(`${origin}/verify?e=${examId}&s=${c.serial}&k=${c.sig}`, { type: "svg", margin: 0, errorCorrectionLevel: "M" }),
              })));
              setSheet({ exam: r.exam, codes });
            });
          }}>
            <div className="grid3">
              <label>Exam<select value={examId} onChange={(e) => setExamId(e.target.value)}>{(exams.data ?? []).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
              <label>From serial (optional)<input name="from" type="number" min={1} inputMode="numeric" placeholder="Counted range" /></label>
              <label>To serial (optional)<input name="to" type="number" min={1} inputMode="numeric" placeholder="Counted range" /></label>
            </div>
            <div className="row"><button disabled={busy || !examId}>Make stickers</button>
              {sheet && <button type="button" className="ghost" onClick={() => window.print()}>Print sheet</button>}</div>
          </form>
        </section>
      </div>
      {sheet && (
        <div className="qrsheet">
          {sheet.codes.map((c) => (
            <div className="qrcell" key={c.serial}>
              <div className="qrimg" dangerouslySetInnerHTML={{ __html: c.svg }} />
              <div className="qrlabel"><b>#{String(c.serial).padStart(3, "0")}</b><span>{sheet.exam}</span><span>Scan to check</span></div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
