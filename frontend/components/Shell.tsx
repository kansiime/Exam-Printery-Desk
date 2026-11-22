"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { ROLE_LABEL } from "@/lib/format";
import { Me, useGuard, useSession } from "@/lib/session";
import { useT } from "@/lib/i18n";
import { Bell } from "./Bell";
import { Guide, useFirstTimeGuide } from "./Guide";
import { Icon, Logo } from "./icons";
import { useAction } from "./ui";

type Tab = { href: string; label: string; short: string; icon: string };

const TABS: Record<Me["role"], Tab[]> = {
  owner: [
    { href: "/owner", label: "Overview", short: "Home", icon: "home" },
    { href: "/owner/fraud", label: "Fraud checks", short: "Checks", icon: "shield" },
    { href: "/print", label: "Printing", short: "Print", icon: "printer" },
    { href: "/store", label: "Store", short: "Store", icon: "box" },
    { href: "/debts", label: "Debts", short: "Debts", icon: "receipt" },
    { href: "/cash", label: "Cash", short: "Cash", icon: "coins" },
    { href: "/owner/schools", label: "Schools", short: "Schools", icon: "school" },
    { href: "/owner/reports", label: "Reports", short: "Reports", icon: "chart" },
    { href: "/owner/team", label: "Team", short: "Team", icon: "users" },
    { href: "/owner/history", label: "Change history", short: "History", icon: "clock" },
    { href: "/owner/qr", label: "QR stickers", short: "QR", icon: "qr" },
    { href: "/owner/pilot", label: "Pilot week", short: "Pilot", icon: "check" },
  ],
  printer: [{ href: "/print", label: "Printing", short: "Printing", icon: "printer" }],
  store: [
    { href: "/store", label: "Store", short: "Store", icon: "box" },
    { href: "/cash", label: "Cash", short: "Cash", icon: "coins" },
  ],
  sales: [
    { href: "/field", label: "My field work", short: "Field", icon: "route" },
    { href: "/debts", label: "Debts", short: "Debts", icon: "receipt" },
  ],
};

// Phones have room for five tabs. With more screens than that, the fifth tab is "More",
// which opens a panel with every other screen.
const PHONE_TABS = 5;

/** Page frame: side menu on computers, bottom tabs on phones, and only the screens this role may use. */
export function Shell({ allow, children }: { allow: Me["role"][]; children: (me: Me) => React.ReactNode }) {
  const me = useGuard(allow);
  const path = usePathname();
  const { t } = useT();
  const guide = useFirstTimeGuide(me);
  const [feedback, setFeedback] = useState(false);
  const [more, setMore] = useState(false);
  useEffect(() => { setMore(false); }, [path]);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const up = () => setOnline(navigator.onLine);
    up();
    window.addEventListener("online", up);
    window.addEventListener("offline", up);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", up); };
  }, []);

  if (!me) return <div className="loading">Loading…</div>;
  const tabs = TABS[me.role];
  const current = tabs.find((t) => t.href === path) ?? (path === "/account" ? { label: "My account" } : undefined);
  const crowded = tabs.length > PHONE_TABS;
  const phoneTabs = crowded ? tabs.slice(0, PHONE_TABS - 1) : tabs;
  const extra = crowded ? tabs.slice(PHONE_TABS - 1) : [];
  const onExtra = extra.some((x) => x.href === path);

  return (
    <div className="app">
      <nav className="side" aria-label="Main menu">
        <div className="brandmark"><span className="logo"><Logo /></span><div><b>{me.business}</b><small>Exam Printery Desk</small></div></div>
        {tabs.map((tab) => (
          <Link key={tab.href} href={tab.href} aria-current={path === tab.href ? "page" : undefined}><Icon name={tab.icon} />{t(tab.label)}</Link>
        ))}
      </nav>

      <header className="topbar">
        <div className="brandmark"><span className="logo"><Logo /></span><div><b>{me.business}</b><small>{current ? t(current.label) : ""}</small></div></div>
        <span className="pagetitle">{current ? t(current.label) : ""}</span>
        <div className="topactions"><Bell /><AccountMenu me={me} extra={extra} onGuide={guide.show} onFeedback={() => setFeedback(true)} /></div>
      </header>

      {!online && <div className="offline">No network. You can keep working; changes that need the internet will wait.</div>}

      <main className="content">{children(me)}</main>
      <Guide me={me} open={guide.open} onClose={guide.close} />
      {more && (
        <div className="moresheet-backdrop" onClick={() => setMore(false)}>
          <nav className="moresheet" aria-label={t("More")} onClick={(e) => e.stopPropagation()}>
            <div className="grabber" />
            <div className="moregrid">
              {extra.map((tab) => (
                <Link key={tab.href} href={tab.href} aria-current={path === tab.href ? "page" : undefined} onClick={() => setMore(false)}>
                  <span className="mi"><Icon name={tab.icon} size={24} /></span><span>{t(tab.label)}</span>
                </Link>
              ))}
            </div>
            <div className="morelinks">
              <Link href="/account" onClick={() => setMore(false)}><Icon name="user" />{t("My account and password")}</Link>
              <button type="button" className="plain" onClick={() => { setMore(false); guide.show(); }}><Icon name="inbox" />{t("Help guide")}</button>
              <button type="button" className="plain" onClick={() => { setMore(false); setFeedback(true); }}><Icon name="alert" />{t("Report a problem or idea")}</button>
            </div>
          </nav>
        </div>
      )}
      {feedback && <FeedbackDialog page={path} onClose={() => setFeedback(false)} />}

      {tabs.length > 1 && (
        <nav className="bottomnav" aria-label="Main menu">
          {phoneTabs.map((tab) => (
            <Link key={tab.href} href={tab.href} aria-current={path === tab.href ? "page" : undefined}><Icon name={tab.icon} /><span>{t(tab.short)}</span></Link>
          ))}
          {crowded && (
            <button type="button" className="moretab" aria-current={onExtra || more ? "page" : undefined} aria-expanded={more} onClick={() => setMore((m) => !m)}>
              <Icon name="grid" /><span>{onExtra ? t(extra.find((x) => x.href === path)!.short) : t("More")}</span>
            </button>
          )}
        </nav>
      )}
    </div>
  );
}

function AccountMenu({ me, extra, onGuide, onFeedback }: { me: Me; extra: Tab[]; onGuide: () => void; onFeedback: () => void }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { setMe } = useSession();
  const router = useRouter();
  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);
  const initials = ((me.first_name?.[0] ?? "") + (me.last_name?.[0] ?? "") || me.username[0]).toUpperCase();
  return (
    <div className="account" ref={ref}>
      <button type="button" className="avatar" aria-label="Account menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{initials}</button>
      {open && (
        <div className="menu" role="menu">
          <div className="who-name">{me.name}</div>
          <div className="who-role">{ROLE_LABEL[me.role]}</div>
          {extra.map((tab) => (
            <button key={tab.href} type="button" className="plain extra-link" onClick={() => { setOpen(false); router.push(tab.href); }}><Icon name={tab.icon} />{t(tab.label)}</button>
          ))}
          <button type="button" className="plain" onClick={() => { setOpen(false); router.push("/account"); }}><Icon name="user" />{t("My account and password")}</button>
          <button type="button" className="plain" onClick={() => { setOpen(false); onGuide(); }}><Icon name="inbox" />{t("Help guide")}</button>
          <button type="button" className="plain" onClick={() => { setOpen(false); onFeedback(); }}><Icon name="alert" />{t("Report a problem or idea")}</button>
          <button type="button" className="plain" onClick={async () => {
            await api("auth/logout", { body: {} }).catch(() => undefined);
            setMe(null);
            router.replace("/login");
          }}><Icon name="logout" />{t("Sign out")}</button>
        </div>
      )}
    </div>
  );
}

function FeedbackDialog({ page, onClose }: { page: string; onClose: () => void }) {
  const { t } = useT();
  const { busy, run } = useAction();
  const [text, setText] = useState("");
  return (
    <div className="guide-backdrop" role="dialog" aria-modal="true" aria-label={t("Report a problem or idea")}>
      <form className="guide" onSubmit={async (e) => {
        e.preventDefault();
        if (await run(() => api("feedback", { body: { text, page } }), "Sent to the owner. Thank you!")) onClose();
      }}>
        <h2>{t("Report a problem or idea")}</h2>
        <p className="sub" style={{ margin: 0 }}>Tell the owner what went wrong or what is hard to use. Say what you were trying to do.</p>
        <textarea required value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. The photo button didn't work on my phone" autoFocus />
        <div className="row"><button type="button" className="ghost" onClick={onClose}>{t("Back")}</button><span className="grow" /><button disabled={busy}>{t("Send")}</button></div>
      </form>
    </div>
  );
}
