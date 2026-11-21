// Phone alerts while the app is closed (Web Push). Needs the server's VAPID key,
// a service worker, and the person's permission. On iPhone it only works after
// "Add to Home Screen".
import { api } from "./api";

function keyBytes(b64: string) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export const pushSupported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

export async function pushStatus(): Promise<"unsupported" | "off" | "on" | "blocked" | "not-set-up"> {
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  const { key } = await api<{ key: string | null }>("push/key");
  if (!key) return "not-set-up";
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub ? "on" : "off";
}

export async function turnOnPush() {
  const { key } = await api<{ key: string | null }>("push/key");
  if (!key) throw new Error("Phone alerts are not set up on the server yet. Ask the owner.");
  if ((await Notification.requestPermission()) !== "granted") throw new Error("Notifications are blocked. Allow them in your phone's browser settings.");
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
  await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  await api("push/subscribe", { body: { subscription: sub.toJSON() } });
}

export async function turnOffPush() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await api("push/unsubscribe", { body: { endpoint: sub.endpoint } }).catch(() => undefined);
    await sub.unsubscribe();
  }
}
