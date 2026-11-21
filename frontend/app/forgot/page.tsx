"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/icons";
import { api } from "@/lib/api";

export default function Forgot() {
  const router = useRouter();
  const [step, setStep] = useState<"ask" | "code" | "done">("ask");
  const [username, setUsername] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const go = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try { await fn(); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="loginpage">
      <div className="panel">
        <span className="logo"><Logo size={26} /></span>
        {step === "ask" && (
          <form onSubmit={(e) => { e.preventDefault(); go(async () => {
            const r = await api<{ detail: string }>("auth/password/forgot", { body: { username } });
            setNote(r.detail);
            setStep("code");
          }); }}>
            <div><h1 style={{ fontSize: "1.5rem" }}>Forgot your password?</h1><p className="sub">Enter your username. We&apos;ll send a 6-digit code by SMS to the phone number on your account.</p></div>
            {error && <div className="banner" role="alert">{error}</div>}
            <label>Username<input autoComplete="username" autoCapitalize="none" required value={username} onChange={(e) => setUsername(e.target.value)} /></label>
            <button disabled={busy}>{busy ? "Sending…" : "Send me a code"}</button>
          </form>
        )}
        {step === "code" && (
          <form onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            if (f.get("new_password") !== f.get("again")) { setError("The two new passwords are different."); return; }
            go(async () => {
              await api("auth/password/reset", { body: { username, code: f.get("code"), new_password: f.get("new_password") } });
              setStep("done");
            });
          }}>
            <div><h1 style={{ fontSize: "1.5rem" }}>Enter the code</h1><p className="sub">{note}</p></div>
            {error && <div className="banner" role="alert">{error}</div>}
            <label>6-digit code<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required placeholder="123456" /></label>
            <label>New password<input name="new_password" type="password" autoComplete="new-password" minLength={8} required placeholder="8+ characters" /></label>
            <label>New password again<input name="again" type="password" autoComplete="new-password" minLength={8} required /></label>
            <button disabled={busy}>{busy ? "Saving…" : "Set new password"}</button>
            <button type="button" className="ghost" onClick={() => { setStep("ask"); setError(""); }}>Send a new code</button>
          </form>
        )}
        {step === "done" && (
          <div style={{ display: "grid", gap: 14 }}>
            <div><h1 style={{ fontSize: "1.5rem" }}>Password changed</h1><p className="sub">Sign in with your new password.</p></div>
            <button type="button" onClick={() => router.replace("/login")}>Go to sign in</button>
          </div>
        )}
        {step !== "done" && <p className="mini" style={{ textAlign: "center", margin: 0 }}><Link href="/login">Back to sign in</Link></p>}
      </div>
    </div>
  );
}
