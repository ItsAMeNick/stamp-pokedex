const CACHE = 'pdex-v7';
const ASSETS = ['./', './index.html', './app.js', './style.css', './manifest.json', './data/dex.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c =>
    Promise.all(ASSETS.map(url =>
      fetch(url, { cache: 'no-store' }).then(r => c.put(url, r))
    ))
  ));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
