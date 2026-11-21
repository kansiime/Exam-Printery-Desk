"use client";
import { useEffect, useState } from "react";
import { Logo } from "@/components/icons";

type Result = { result: "sold" | "unsold" | "extra" | "fake"; message: string; business?: string };
const STYLE: Record<Result["result"], [string, string]> = {
  sold: ["var(--good-soft)", "Genuine copy"],
  unsold: ["var(--warn-soft)", "Genuine, but not recorded as sold"],
  extra: ["var(--bad-soft)", "Warning: extra copy"],
  fake: ["var(--bad-soft)", "Not genuine"],
};

/** Public page opened by scanning the QR sticker on a copy. No sign-in needed. */
export default function Verify() {
  const [r, setR] = useState<Result | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const e = q.get("e"), s = q.get("s"), k = q.get("k");
    if (!e || !s || !k || !/^\d+$/.test(e) || !/^\d+$/.test(s) || !/^[0-9a-f]+$/i.test(k)) { setError("This link is incomplete. Scan the QR code on the copy again."); return; }
    fetch(`/api/verify/${e}/${s}/${k}/`).then((x) => x.json()).then(setR).catch(() => setError("Could not check right now. Try again in a minute."));
  }, []);
  return (
    <div className="loginpage">
      <div className="panel" style={{ background: r ? STYLE[r.result][0] : undefined }}>
        <span className="logo"><Logo size={26} /></span>
        {!r && !error && <p className="sub">Checking this copy…</p>}
        {error && <p className="sub">{error}</p>}
        {r && <>
          <h1 style={{ fontSize: "1.5rem" }}>{STYLE[r.result][1]}</h1>
          <p style={{ margin: 0 }}>{r.message}</p>
          {r.business && <p className="mini" style={{ margin: 0 }}>Checked by {r.business}</p>}
        </>}
      </div>
    </div>
  );
}
