"use client";
import { Shell } from "@/components/Shell";
import { ErrorNote, useAction } from "@/components/ui";
import { api } from "@/lib/api";
import { ROLE_LABEL } from "@/lib/format";
import { Me, useData } from "@/lib/session";

type User = { id: number; username: string; first_name: string; last_name: string; name: string; role: string; phone: string; is_active: boolean };

export default function TeamPage() {
  return <Shell allow={["owner"]}>{(me) => <Team me={me} />}</Shell>;
}

const roleSelect = (value?: string) => (
  <select name="role" defaultValue={value ?? "sales"}>
    {["printer", "store", "sales", "owner"].map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
  </select>
);

function Team({ me }: { me: Me }) {
  const users = useData<User[]>("users");
  const { busy, run } = useAction();
  return (
    <>
      <ErrorNote error={users.error} />
      <div><h2>Team</h2><p className="sub">Create an account for each worker and give them a role. They sign in on their phone and see only their own screens. To stop someone, switch their account off; their records stay.</p></div>
      <section className="panel"><h3>Add a worker</h3>
        <form onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget, f = new FormData(form);
          const ok = await run(() => api("users", { body: { username: f.get("username"), first_name: f.get("first_name"), last_name: f.get("last_name"), phone: f.get("phone"), role: f.get("role"), password: f.get("password") } }), "Account created. Give them the username and password.");
          if (ok) { form.reset(); users.reload(); }
        }}>
          <div className="grid3">
            <label>First name<input name="first_name" required /></label>
            <label>Last name<input name="last_name" /></label>
            <label>Phone<input name="phone" type="tel" placeholder="07…" /></label>
            <label>Username<input name="username" required autoCapitalize="none" placeholder="e.g. musa" /></label>
            <label>Starting password<input name="password" required minLength={8} placeholder="8+ characters" /></label>
            <label>Role{roleSelect()}</label>
          </div>
          <div><button disabled={busy}>Create account</button></div>
        </form>
      </section>
      <section className="block"><h3>Your team</h3>
        {(users.data ?? []).filter((u) => u.id !== me.id).map((u) => (
          <div className="ticket" key={u.id}>
            <form onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const body: Record<string, unknown> = { first_name: f.get("first_name"), last_name: f.get("last_name"), phone: f.get("phone"), role: f.get("role"), is_active: f.get("active") === "1" };
              if (f.get("password")) body.password = f.get("password");
              if (await run(() => api(`users/${u.id}`, { method: "PATCH", body }), "Saved")) users.reload();
            }}>
              <p className="mini">Username: <b>{u.username}</b></p>
              <div className="grid3">
                <label>First name<input name="first_name" defaultValue={u.first_name} /></label>
                <label>Last name<input name="last_name" defaultValue={u.last_name} /></label>
                <label>Phone<input name="phone" defaultValue={u.phone} /></label>
                <label>Role{roleSelect(u.role)}</label>
                <label>Account<select name="active" defaultValue={u.is_active ? "1" : "0"}><option value="1">Active</option><option value="0">Switched off</option></select></label>
                <label>New password (optional)<input name="password" minLength={8} placeholder="Leave empty to keep" /></label>
              </div>
              <div><button className="ghost" disabled={busy}>Save</button></div>
            </form>
          </div>
        ))}
      </section>
    </>
  );
}
