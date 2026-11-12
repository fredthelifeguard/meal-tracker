// Offline support: serve the app shell from cache, refresh it in the background.
const CACHE = 'meal-tracker-shell-v1';
const SHELL = [
  './', 'index.html', 'styles.css', 'app.js', 'nutrition.js', 'config.js',
  'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png'
];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('meal-tracker-shell-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  const ours = url.origin === self.location.origin;
  // Lookups and Google Drive calls always go straight to the network.
  if (e.request.method !== 'GET' || !(ours || FONT_HOSTS.includes(url.hostname))) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(e.request, { ignoreSearch: ours });
      const fresh = fetch(e.request)
        .then((res) => { if (res.ok || res.type === 'opaque') cache.put(e.request, res.clone()); return res; })
        .catch(() => cached);
      return cached || fresh;
    })
  );
});
