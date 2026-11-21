"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { ROLE_LABEL } from "@/lib/format";
import { Me, useGuard, useSession } from "@/lib/session";
import { Bell } from "./Bell";
import { Icon, Logo } from "./icons";

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
    { href: "/owner/team", label: "Team", short: "Team", icon: "users" },
    { href: "/owner/qr", label: "QR stickers", short: "QR", icon: "qr" },
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

// Phones have room for five tabs; the owner's other screens sit in the account menu.
const PHONE_TABS = 5;

/** Page frame: side menu on computers, bottom tabs on phones, and only the screens this role may use. */
export function Shell({ allow, children }: { allow: Me["role"][]; children: (me: Me) => React.ReactNode }) {
  const me = useGuard(allow);
  const path = usePathname();
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
  const phoneTabs = tabs.slice(0, PHONE_TABS);
  const extra = tabs.slice(PHONE_TABS);

  return (
    <div className="app">
      <nav className="side" aria-label="Main menu">
        <div className="brandmark"><span className="logo"><Logo /></span><div><b>{me.business}</b><small>Exam Printery Desk</small></div></div>
        {tabs.map((t) => (
          <Link key={t.href} href={t.href} aria-current={path === t.href ? "page" : undefined}><Icon name={t.icon} />{t.label}</Link>
        ))}
      </nav>

      <header className="topbar">
        <div className="brandmark"><span className="logo"><Logo /></span><div><b>{me.business}</b><small>{current?.label ?? ""}</small></div></div>
        <span className="pagetitle">{current?.label}</span>
        <div className="topactions"><Bell /><AccountMenu me={me} extra={extra} /></div>
      </header>

      {!online && <div className="offline">No network. You can keep working; changes that need the internet will wait.</div>}

      <main className="content">{children(me)}</main>

      {tabs.length > 1 && (
        <nav className="bottomnav" aria-label="Main menu">
          {phoneTabs.map((t) => (
            <Link key={t.href} href={t.href} aria-current={path === t.href ? "page" : undefined}><Icon name={t.icon} /><span>{t.short}</span></Link>
          ))}
        </nav>
      )}
    </div>
  );
}

function AccountMenu({ me, extra }: { me: Me; extra: Tab[] }) {
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
          {extra.map((t) => (
            <button key={t.href} type="button" className="plain extra-link" onClick={() => { setOpen(false); router.push(t.href); }}><Icon name={t.icon} />{t.label}</button>
          ))}
          <button type="button" className="plain" onClick={() => { setOpen(false); router.push("/account"); }}><Icon name="user" />My account and password</button>
          <button type="button" className="plain" onClick={async () => {
            await api("auth/logout", { body: {} }).catch(() => undefined);
            setMe(null);
            router.replace("/login");
          }}><Icon name="logout" />Sign out</button>
        </div>
      )}
    </div>
  );
}
