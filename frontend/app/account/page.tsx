"use client";
import { Shell } from "@/components/Shell";
import { PageHead, T, useAction, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { LanguagePicker } from "@/lib/i18n";
import { ROLE_LABEL } from "@/lib/format";
import { Me, useSession } from "@/lib/session";

export default function AccountPage() {
  return <Shell allow={["owner", "printer", "store", "sales"]}>{(me) => <Account me={me} />}</Shell>;
}

function Account({ me }: { me: Me }) {
  const { busy, run } = useAction();
  const toast = useToast();
  return (
    <>
      <PageHead title="My account" sub={`${me.name} · ${ROLE_LABEL[me.role]} · username ${me.username}`} />
      <Details me={me} />
      <section className="panel"><h2>Language</h2><p className="sub">Menus, buttons and the help guide can be shown in Luganda.</p><LanguagePicker /></section>
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
          <div><button disabled={busy}><T>Change password</T></button></div>
        </form>
      </section>
    </>
  );
}

function Details({ me }: { me: Me }) {
  const { setMe } = useSession();
  const { busy, run } = useAction();
  return (
    <section className="panel">
      <div><h2>Your details</h2><p className="sub">Your name shows at the top of the app and on everything you record. Your phone receives password reset codes.</p></div>
      <form onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        await run(async () => setMe(await api<Me>("auth/me", { method: "PATCH", body: { first_name: f.get("first_name"), last_name: f.get("last_name"), phone: f.get("phone") } })), "Details saved");
      }}>
        <div className="grid3">
          <label>First name<input name="first_name" required defaultValue={me.first_name.toLowerCase() === "owner" ? "" : me.first_name} placeholder="e.g. Noel" autoComplete="given-name" /></label>
          <label>Last name<input name="last_name" defaultValue={me.last_name} autoComplete="family-name" /></label>
          <label>Phone<input name="phone" type="tel" inputMode="tel" defaultValue={me.phone} placeholder="07…" autoComplete="tel" /></label>
        </div>
        <div><button disabled={busy}><T>Save details</T></button></div>
      </form>
    </section>
  );
}
