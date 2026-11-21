// Keeps the app opening without network. Pages: network first, fall back to the
// last copy. Static files: cache first. API calls are never cached here; the
// field screen keeps its own offline outbox.
const CACHE = "printery-v2";
self.addEventListener("install", (e) => { self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(self.clients.claim()); });
self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/admin/") || url.pathname.startsWith("/media/")) return;
  if (url.pathname.startsWith("/_next/static/") || url.pathname.endsWith(".svg")) {
    e.respondWith(caches.open(CACHE).then(async (c) => (await c.match(req)) || fetch(req).then((r) => { c.put(req, r.clone()); return r; })));
    return;
  }
  e.respondWith(
    fetch(req).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return r; })
      .catch(() => caches.match(req).then((m) => m || caches.match("/")))
  );
});

// Alerts while the app is closed (Web Push). Urgent ones stay on screen until tapped.
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: "Exam Printery Desk", body: e.data && e.data.text() }; }
  const urgent = d.level === "urgent";
  e.waitUntil(self.registration.showNotification(d.title || "Exam Printery Desk", {
    body: d.body || "", icon: "/icon.svg", badge: "/icon.svg", tag: (d.title || "") + (d.link || ""),
    data: { link: d.link || "/" }, requireInteraction: urgent, renotify: true,
    vibrate: urgent ? [400, 150, 400, 150, 400, 150, 600] : [250, 120, 250],
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const link = (e.notification.data && e.notification.data.link) || "/";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ("focus" in c) { c.navigate(link); return c.focus(); } }
    return self.clients.openWindow(link);
  }));
});
