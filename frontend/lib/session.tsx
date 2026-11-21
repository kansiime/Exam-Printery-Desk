"use client";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { OfflineError, api } from "./api";

export type Me = { id: number; username: string; name: string; first_name: string; last_name: string; phone: string; role: "owner" | "printer" | "store" | "sales"; business: string };

/** True while someone still shows as a username or the old "Owner" placeholder. */
export const needsName = (me: Me) => !me.first_name || me.first_name.toLowerCase() === "owner";

const Ctx = createContext<{ me: Me | null; loading: boolean; refresh: () => Promise<void>; setMe: (m: Me | null) => void }>({
  me: null, loading: true, refresh: async () => {}, setMe: () => {},
});

const CACHE_KEY = "printery-me";

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [me, setMeState] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const setMe = (m: Me | null) => {
    setMeState(m);
    try { m ? localStorage.setItem(CACHE_KEY, JSON.stringify(m)) : localStorage.removeItem(CACHE_KEY); } catch {}
  };

  const refresh = useCallback(async () => {
    try {
      setMe(await api<Me>("auth/me"));
    } catch (e: any) {
      // Offline: keep using who we last knew so the field screen still opens.
      if (e instanceof OfflineError) {
        try { const cached = localStorage.getItem(CACHE_KEY); if (cached) setMeState(JSON.parse(cached)); } catch {}
      } else setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  return <Ctx.Provider value={{ me, loading, refresh, setMe }}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);

export const HOME: Record<Me["role"], string> = { owner: "/owner", printer: "/print", store: "/store", sales: "/field" };

/** Sends people who aren't signed in to the login page, and people without the role to their own home. */
export function useGuard(allowed: Me["role"][]) {
  const { me, loading } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (loading) return;
    if (!me) router.replace("/login");
    else if (!allowed.includes(me.role)) router.replace(HOME[me.role]);
  }, [me, loading, router, allowed]);
  return me && allowed.includes(me.role) ? me : null;
}

/** Load data for a screen; reload() after a change. */
export function useData<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (!path) return;
    try {
      const d = await api<T>(path);
      setData(d);
      setError("");
      try { localStorage.setItem("cache:" + path, JSON.stringify(d)); } catch {}
    } catch (e: any) {
      setError(e.message);
      try { const c = localStorage.getItem("cache:" + path); if (c) setData((cur) => cur ?? JSON.parse(c)); } catch {}
    }
  }, [path]);
  useEffect(() => {
    load();
    // New notifications mean new figures: reload this screen's data too.
    window.addEventListener("printery:refresh", load);
    return () => window.removeEventListener("printery:refresh", load);
  }, [load]);
  return { data, error, reload: load };
}
