"use client";
import { useState } from "react";
import { Shell } from "@/components/Shell";
import { Disclosure, EmptyCard, ErrorNote, GiveResetCode, PageHead, Pill, useAction } from "@/components/ui";
import { api } from "@/lib/api";
import { ROLE_LABEL } from "@/lib/format";
import { Me, useData } from "@/lib/session";

type User = { id: number; username: string; first_name: string; last_name: string; name: string; role: string; phone: string; is_active: boolean };

export default function TeamPage() {
  return <Shell allow={["owner"]}>{(me) => <Team me={me} />}</Shell>;
}

const roleSelect = (value?: string) => (
  <select name="role" defaultValue={value ?? "sales"}>
    {["sales", "printer", "store", "owner"].map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
  </select>
);

function Team({ me }: { me: Me }) {
  const users = useData<User[]>("users");
  const { busy, run } = useAction();
  const team = (users.data ?? []).filter((u) => u.id !== me.id);
  return (
    <>
      <ErrorNote error={users.error} />
      <PageHead title="Team" sub="Each worker gets their own login and sees only the screens for their job. Switch an account off to stop someone; their records stay." />

      <Disclosure title="Add a worker" sub="Create a login for a printer, store keeper or sales person" icon="plus" primary defaultOpen={!team.length}>
        <form onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget, f = new FormData(form);
          const ok = await run(() => api("users", { body: { username: f.get("username"), first_name: f.get("first_name"), last_name: f.get("last_name"), phone: f.get("phone"), role: f.get("role"), password: f.get("password") } }), "Account created. Give them the username and password.");
          if (ok) { form.reset(); users.reload(); }
        }}>
          <div className="grid2">
            <label>First name<input name="first_name" required /></label>
            <label>Last name<input name="last_name" /></label>
            <label>Job<span>{roleSelect()}</span></label>
            <label>Phone<input name="phone" type="tel" inputMode="tel" placeholder="07…" /></label>
            <label>Username<input name="username" required autoCapitalize="none" placeholder="e.g. musa" /></label>
            <label>Starting password<input name="password" required minLength={8} placeholder="8+ characters" /></label>
          </div>
          <div><button disabled={busy}>Create account</button></div>
        </form>
      </Disclosure>

      <section className="block">
        <div className="sectiontitle"><h2>Your team</h2><span className="count">{team.length}</span></div>
        {team.length ? team.map((u) => <Member key={u.id} user={u} onSaved={users.reload} />) : <EmptyCard icon="users">No workers yet. Use “Add a worker” above.</EmptyCard>}
      </section>
    </>
  );
}

function Member({ user: u, onSaved }: { user: User; onSaved: () => void }) {
  const [edit, setEdit] = useState(false);
  const { busy, run } = useAction();
  const initials = (u.first_name[0] ?? u.username[0] ?? "?") + (u.last_name[0] ?? "");
  return (
    <div className="ticket">
      <div className="head" style={{ alignItems: "center" }}>
        <span className="avatar" aria-hidden="true">{initials.toUpperCase()}</span>
        <div className="t"><h3>{u.name}</h3><p className="sub">{ROLE_LABEL[u.role]} · username <b>{u.username}</b>{u.phone ? ` · ${u.phone}` : ""}</p></div>
        {!u.is_active && <Pill cls="p-done">Switched off</Pill>}
        <button type="button" className="ghost" onClick={() => setEdit((x) => !x)}>{edit ? "Close" : "Edit"}</button>
      </div>
      {edit && <GiveResetCode userId={u.id} label="Create a password reset code" />}
      {edit && (
        <form onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const body: Record<string, unknown> = { first_name: f.get("first_name"), last_name: f.get("last_name"), phone: f.get("phone"), role: f.get("role"), is_active: f.get("active") === "1" };
          if (f.get("password")) body.password = f.get("password");
          if (await run(() => api(`users/${u.id}`, { method: "PATCH", body }), "Saved")) { setEdit(false); onSaved(); }
        }}>
          <div className="grid2">
            <label>First name<input name="first_name" defaultValue={u.first_name} /></label>
            <label>Last name<input name="last_name" defaultValue={u.last_name} /></label>
            <label>Job<span>{roleSelect(u.role)}</span></label>
            <label>Phone<input name="phone" type="tel" defaultValue={u.phone} /></label>
            <label>Account<select name="active" defaultValue={u.is_active ? "1" : "0"}><option value="1">Active</option><option value="0">Switched off</option></select></label>
            <label>New password (optional)<input name="password" minLength={8} placeholder="Leave empty to keep" /></label>
          </div>
          <div><button disabled={busy}>Save changes</button></div>
        </form>
      )}
    </div>
  );
}
