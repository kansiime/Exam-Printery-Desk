"use client";
import { Shell } from "@/components/Shell";
import { PageHead, useAction, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { ROLE_LABEL } from "@/lib/format";
import { Me } from "@/lib/session";

export default function AccountPage() {
  return <Shell allow={["owner", "printer", "store", "sales"]}>{(me) => <Account me={me} />}</Shell>;
}

function Account({ me }: { me: Me }) {
  const { busy, run } = useAction();
  const toast = useToast();
  return (
    <>
      <PageHead title="My account" sub={`${me.name} · ${ROLE_LABEL[me.role]} · username ${me.username}`} />
      <section className="panel">
        <div><h2>Change password</h2><p className="sub">Choose something only you know, at least 8 characters. Other phones signed in to your account will be signed out.</p></div>
        <form onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget, f = new FormData(form);
          if (f.get("new_password") !== f.get("again")) { toast("The two new passwords are different."); return; }
          if (await run(() => api("auth/password/change", { body: { current_password: f.get("current_password"), new_password: f.get("new_password") } }), "Password changed")) form.reset();
        }}>
          <label>Current password<input name="current_password" type="password" autoComplete="current-password" required /></label>
          <div className="grid2">
            <label>New password<input name="new_password" type="password" autoComplete="new-password" minLength={8} required placeholder="8+ characters" /></label>
            <label>New password again<input name="again" type="password" autoComplete="new-password" minLength={8} required /></label>
          </div>
          <div><button disabled={busy}>Change password</button></div>
        </form>
      </section>
    </>
  );
}
