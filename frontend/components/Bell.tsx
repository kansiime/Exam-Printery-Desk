"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { askSystemNotifications, ring, setSoundOn, soundOn, systemNotify, unlockSound } from "@/lib/alert";
import { when } from "@/lib/format";
import { Icon } from "./icons";

type Note = { id: number; level: "info" | "action" | "urgent"; title: string; body: string; link: string; photos: string[]; created_at: string; read: boolean };

const POLL_MS = 20_000;
const LEVEL_CLS = { urgent: "n-urgent", action: "n-action", info: "n-info" } as const;

/** Bell with unread count. New notifications ring loudly, vibrate and pop up on screen. */
export function Bell() {
  const router = useRouter();
  const [items, setItems] = useState<Note[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [popup, setPopup] = useState<Note[]>([]);
  const [sound, setSound] = useState(true);
  const [needsTap, setNeedsTap] = useState(false);
  const lastId = useRef<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const d = await api<{ unread: number; items: Note[] }>("notifications");
      setItems(d.items);
      setUnread(d.unread);
      const newest = d.items[0]?.id ?? 0;
      if (lastId.current === null) {
        // First load: remember where we are; ring only for unread ones from the last 10 minutes.
        const fresh = d.items.filter((n) => !n.read && Date.now() - new Date(n.created_at).getTime() < 10 * 60_000);
        if (fresh.length) announce(fresh);
      } else if (newest > lastId.current) {
        announce(d.items.filter((n) => n.id > (lastId.current ?? 0) && !n.read));
      }
      lastId.current = Math.max(newest, lastId.current ?? 0);
    } catch { /* offline: try again next time */ }
  }, []);

  function announce(fresh: Note[]) {
    if (!fresh.length) return;
    const worst = fresh.some((n) => n.level === "urgent") ? "urgent" : fresh.some((n) => n.level === "action") ? "action" : "info";
    ring(worst);
    const order = { urgent: 0, action: 1, info: 2 } as const;
    setPopup([...fresh].sort((a, b) => order[a.level] - order[b.level] || b.id - a.id));
    fresh.forEach((n) => systemNotify(n.title, n.body, n.link));
    // Let the screen underneath reload its figures.
    window.dispatchEvent(new Event("printery:refresh"));
  }

  useEffect(() => {
    setSound(soundOn());
    const tap = () => { unlockSound(); setNeedsTap(false); };
    document.addEventListener("pointerdown", tap, { once: true });
    setNeedsTap(true);
    load();
    const t = setInterval(load, POLL_MS);
    const vis = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", vis);
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("click", close);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", vis); document.removeEventListener("click", close); document.removeEventListener("pointerdown", tap); };
  }, [load]);

  const markRead = async (ids?: number[]) => {
    await api("notifications/read", { body: ids ? { ids } : {} }).catch(() => undefined);
    load();
  };
  const go = (n: Note) => { setOpen(false); setPopup([]); if (!n.read) markRead([n.id]); if (n.link) router.push(n.link); };

  return (
    <div className="bellwrap" ref={ref}>
      <button type="button" className="bell" aria-label={`Notifications, ${unread} unread`} onClick={() => { setOpen((o) => !o); unlockSound(); askSystemNotifications(); }}>
        <Icon name="bell" size={22} />
        {unread > 0 && <span className="badge">{unread > 99 ? "99+" : unread}</span>}
      </button>

      {open && (
        <div className="npanel" role="dialog" aria-label="Notifications">
          <div className="nhead">
            <b>Notifications</b>
            <button type="button" className="plain" onClick={() => { const v = !sound; setSound(v); setSoundOn(v); if (v) ring("info"); }}>
              <Icon name={sound ? "volume" : "mute"} />{sound ? "Sound on" : "Sound off"}
            </button>
            {unread > 0 && <button type="button" className="plain" onClick={() => markRead()}>Mark all read</button>}
          </div>
          {needsTap && sound && <p className="mini" style={{ padding: "0 14px" }}>Tap anywhere once so your phone allows the alert sound.</p>}
          <div className="nlist">
            {items.length ? items.map((n) => (
              <button type="button" key={n.id} className={`nitem ${LEVEL_CLS[n.level]} ${n.read ? "" : "unread"}`} onClick={() => go(n)}>
                <span className="ntitle">{n.title}</span>
                {n.body && <span className="nbody">{n.body}</span>}
                {!!n.photos.length && <span className="nphotos">{n.photos.map((p) => <img key={p} src={p} alt="" />)}</span>}
                <span className="ntime">{when(n.created_at)}</span>
              </button>
            )) : <p className="empty" style={{ padding: 14 }}>No notifications yet.</p>}
          </div>
        </div>
      )}

      {!!popup.length && (
        <div className={`npopup ${LEVEL_CLS[popup[0].level]}`} role="alert">
          {popup.slice(0, 3).map((n) => (
            <div key={n.id} className="npop-item">
              <div className="ntitle">{n.level === "urgent" && <Icon name="alert" />} {n.title}</div>
              {n.body && <div className="nbody">{n.body}</div>}
              {!!n.photos.length && <div className="nphotos">{n.photos.map((p) => <a key={p} href={p} target="_blank" rel="noopener"><img src={p} alt="Photo" /></a>)}</div>}
              {n.link && <button type="button" className="ghost" onClick={() => go(n)}>Open</button>}
            </div>
          ))}
          {popup.length > 3 && <p className="mini" style={{ margin: 0 }}>and {popup.length - 3} more in the bell.</p>}
          <button type="button" onClick={() => { markRead(popup.map((n) => n.id)); setPopup([]); }}>OK, got it</button>
        </div>
      )}
    </div>
  );
}
