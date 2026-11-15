/* Factory Town OnSite: service worker for push notifications (v43, 11/15).
 * The server sends EMPTY pushes. When one arrives, this asks the OnSite server what to show for whoever is signed
 * in on this device (api_pushAlerts), so no show details pass through Apple's or Google's push servers.
 * It caches nothing: the app always loads from the network, as before.
 * The app writes { api, token } into the 'ftos-cfg' cache (a service worker cannot read the app's storage). */
const CFG_CACHE = 'ftos-cfg';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

async function readJson(key, fallback) {
  try { const c = await caches.open(CFG_CACHE); const r = await c.match(key); return r ? await r.json() : fallback; } catch (e) { return fallback; }
}
async function writeJson(key, value) {
  try { const c = await caches.open(CFG_CACHE); await c.put(key, new Response(JSON.stringify(value))); } catch (e) {}
}

async function onPush() {
  let alerts = [];
  try {
    const cfg = await readJson('cfg', {});
    if (cfg.api && cfg.token) {
      const r = await fetch(cfg.api, { method: 'POST', body: JSON.stringify({ fn: 'api_pushAlerts', args: [cfg.token] }), redirect: 'follow' }).then(x => x.json());
      if (r && r.ok) alerts = r.alerts || [];
    }
  } catch (e) {}
  // Show what has not been shown on this device yet; if nothing is new, show the newest again (iOS needs a
  // notification for every push, or it stops delivering them).
  const seen = await readJson('seen', {});
  const fresh = alerts.filter(a => !seen[a.id]);
  const list = fresh.length ? fresh.slice(0, 4) : alerts.slice(0, 1);
  if (!list.length) {
    await self.registration.showNotification('Factory Town OnSite', { body: 'Open Wristbands for the latest band requests.', tag: 'ftos', icon: 'icon-180.png', data: { n: -1 } });
  }
  for (const a of list.slice().reverse()) {
    await self.registration.showNotification(a.title, { body: a.body, tag: a.id, renotify: true, icon: 'icon-180.png', data: { n: a.n } });
    seen[a.id] = Date.now();
  }
  const cutoff = Date.now() - 3 * 86400000;
  Object.keys(seen).forEach(k => { if (seen[k] < cutoff) delete seen[k]; });
  await writeJson('seen', seen);
  // Open app windows refresh their Wristbands screen.
  const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  wins.forEach(w => w.postMessage({ bandsChanged: true }));
}
self.addEventListener('push', e => e.waitUntil(onPush()));

// Tapping a notification opens the app on that request (Wristbands > the request, with Acknowledge).
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const n = (e.notification.data || {}).n || -1;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      try { await w.focus(); } catch (err) {}
      w.postMessage({ band: n });
      return;
    }
    await self.clients.openWindow('./?band=' + n);
  })());
});
