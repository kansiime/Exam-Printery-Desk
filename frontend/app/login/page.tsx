"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/icons";
import { api } from "@/lib/api";
import { HOME, Me, useSession } from "@/lib/session";

export default function Login() {
  const { me, setMe } = useSession();
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
        <div><h1 style={{ fontSize: "1.5rem" }}>Welcome back</h1><p className="sub">Sign in with the username and password the owner gave you.</p></div>
        {error && <div className="banner" role="alert">{error}</div>}
        <label>Username<input id="username" autoComplete="username" autoCapitalize="none" required value={username} onChange={(e) => setUsername(e.target.value)} /></label>
        <label>Password<input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <button disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        <p className="mini" style={{ textAlign: "center", margin: 0 }}>Forgot your password? Ask the owner to set a new one.</p>
      </form>
    </div>
  );
}
