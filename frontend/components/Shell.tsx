"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { ROLE_LABEL } from "@/lib/format";
import { Me, useGuard, useSession } from "@/lib/session";

const TABS: Record<Me["role"], [string, string][]> = {
  owner: [["/owner", "Overview"], ["/owner/fraud", "Fraud checks"], ["/print", "Printing"], ["/store", "Store"],
          ["/debts", "Debts"], ["/owner/schools", "Schools"], ["/cash", "Cash"], ["/owner/team", "Team"]],
  printer: [["/print", "Printing"]],
  store: [["/store", "Store"], ["/cash", "Cash"]],
  sales: [["/field", "My field"], ["/debts", "Debts"]],
};

/** Page frame: brand, the signed-in person, and only the tabs their role may use. */
export function Shell({ allow, children }: { allow: Me["role"][]; children: (me: Me) => React.ReactNode }) {
  const me = useGuard(allow);
  const { setMe } = useSession();
  const path = usePathname();
  const router = useRouter();
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const up = () => setOnline(navigator.onLine);
    up();
    window.addEventListener("online", up);
    window.addEventListener("offline", up);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", up); };
  }, []);

  if (!me) return <div className="wrap"><main><div className="banner info">Loading…</div></main></div>;
  const tabs = TABS[me.role];
  return (
    <>
      <header className="top">
        <div className="wrap">
          <div className="brand">
            <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><circle cx="11" cy="11" r="6" fill="none" stroke="var(--accent)" strokeWidth="2" /><path d="M11 1v20M1 11h20" stroke="var(--ink)" strokeWidth="1.5" /></svg>
            <h1>{me.business}</h1>
            <span className="who">
              {me.name}<span className="rolechip">{ROLE_LABEL[me.role]}</span>
              <button type="button" className="ghost" onClick={async () => {
                await api("auth/logout", { body: {} }).catch(() => undefined);
                setMe(null);
                router.replace("/login");
              }}>Sign out</button>
            </span>
          </div>
          {tabs.length > 1 && (
            <nav className="tabs" aria-label="Sections">
              {tabs.map(([href, label]) => <Link key={href} href={href} aria-current={path === href ? "page" : undefined}>{label}</Link>)}
            </nav>
          )}
        </div>
      </header>
      {!online && <div className="offline">No network. You can keep working; changes that need the internet will wait.</div>}
      <div className="wrap"><main>{children(me)}</main></div>
    </>
  );
}
