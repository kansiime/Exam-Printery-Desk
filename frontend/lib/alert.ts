// Loud in-app alerts: a generated alarm sound (no audio files), vibration, and a
// system notification when the app is in the background. Phones only allow sound
// after the person has tapped the page once, so unlock() runs on the first tap.
let ctx: AudioContext | null = null;

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

export function unlockSound() {
  const a = audio();
  if (a && a.state === "suspended") a.resume().catch(() => undefined);
}

export const soundOn = () => { try { return localStorage.getItem("alert-sound") !== "off"; } catch { return true; } };
export const setSoundOn = (on: boolean) => { try { localStorage.setItem("alert-sound", on ? "on" : "off"); } catch {} };

/** Play the alarm. Urgent warnings ring longer, like a siren. */
export function ring(level: "info" | "action" | "urgent") {
  if (!soundOn()) return;
  const a = audio();
  if (!a) return;
  unlockSound();
  const out = a.createDynamicsCompressor();
  out.connect(a.destination);
  const master = a.createGain();
  master.gain.value = 0.9;
  master.connect(out);
  const t0 = a.currentTime + 0.02;
  const beeps = level === "urgent" ? 10 : level === "action" ? 4 : 3;
  for (let i = 0; i < beeps; i++) {
    const osc = a.createOscillator();
    const g = a.createGain();
    osc.type = "square";
    const start = t0 + i * (level === "urgent" ? 0.32 : 0.22);
    if (level === "urgent") {
      osc.frequency.setValueAtTime(700, start);
      osc.frequency.linearRampToValueAtTime(1300, start + 0.28);
    } else {
      osc.frequency.setValueAtTime(i % 2 ? 660 : 990, start);
    }
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(0.8, start + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, start + (level === "urgent" ? 0.3 : 0.18));
    osc.connect(g).connect(master);
    osc.start(start);
    osc.stop(start + 0.32);
  }
  try { navigator.vibrate?.(level === "urgent" ? [400, 150, 400, 150, 400, 150, 600] : [250, 120, 250]); } catch {}
}

export async function askSystemNotifications() {
  try {
    if ("Notification" in window && Notification.permission === "default") await Notification.requestPermission();
  } catch {}
}

export function systemNotify(title: string, body: string, link: string) {
  try {
    if (!("Notification" in window) || Notification.permission !== "granted" || document.visibilityState === "visible") return;
    const n = new Notification(title, { body, icon: "/icon.svg", tag: title });
    n.onclick = () => { window.focus(); location.href = link || "/"; };
  } catch {}
}
