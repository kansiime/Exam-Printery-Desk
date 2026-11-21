"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/icons";
import { api } from "@/lib/api";
import { Lang, useT } from "@/lib/i18n";
import { HOME, Me, useSession } from "@/lib/session";

export default function Login() {
  const { me, setMe } = useSession();
  const { t, lang, setLang } = useT();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (me) router.replace(HOME[me.role]); }, [me, router]);

  return (
    <div className="loginpage">
      <form className="panel" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          const m = await api<Me>("auth/login", { body: { username, password } });
          setMe(m);
          router.replace(HOME[m.role]);
        } catch (err: any) {
          setError(err.message);
        } finally {
          setBusy(false);
        }
      }}>
        <span className="logo"><Logo size={26} /></span>
        <div><h1 style={{ fontSize: "1.5rem" }}>{t("Welcome back")}</h1><p className="sub">{t("Sign in with the username and password the owner gave you.")}</p></div>
        {error && <div className="banner" role="alert">{error}</div>}
        <label>{t("Username")}<input id="username" autoComplete="username" autoCapitalize="none" required value={username} onChange={(e) => setUsername(e.target.value)} /></label>
        <label>{t("Password")}<input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <button disabled={busy}>{busy ? "…" : t("Sign in")}</button>
        <p className="mini" style={{ textAlign: "center", margin: 0 }}><Link href="/forgot">{t("Forgot your password?")}</Link> · <select aria-label="Language" value={lang} onChange={(e) => setLang(e.target.value as Lang)} style={{ display: "inline", width: "auto", minHeight: 0, padding: "2px 6px", fontSize: ".85rem" }}>
          <option value="en">English</option><option value="lg">Luganda</option><option value="nyn">Runyankore</option></select></p>
      </form>
    </div>
  );
}
