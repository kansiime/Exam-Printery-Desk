"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { HOME, useSession } from "@/lib/session";

export default function Home() {
  const { me, loading } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (!loading) router.replace(me ? HOME[me.role] : "/login");
  }, [me, loading, router]);
  return <div className="wrap"><main><div className="banner info">Loading…</div></main></div>;
}
