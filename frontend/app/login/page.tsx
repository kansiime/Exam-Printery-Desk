"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
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
    <div className="wrap center">
      <form className="panel login" onSubmit={async (e) => {
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
        <div><h2>Exam Printery Desk</h2><p className="sub">Sign in with the username and password the owner gave you.</p></div>
        {error && <div className="banner">{error}</div>}
        <label>Username<input id="username" autoComplete="username" required value={username} onChange={(e) => setUsername(e.target.value)} /></label>
        <label>Password<input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <button disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </div>
  );
}
