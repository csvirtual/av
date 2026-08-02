// Cache básico para permitir instalar como app e abrir mesmo sem internet.
const CACHE_NAME = 'win11-web-v19';
const ASSETS = [
  './',
  './index.html',
  './main.js',
  './manifest.json',
  './styles/tokens.css',
  './styles/base.css',
  './styles/motion.css',
  './styles/screens.css',
  './styles/components.css',
  './styles/windows.css',
  './styles/apps.css',
  './core/state/database.js',
  './core/state/kv-store.js',
  './core/state/filesystem.js',
  './core/services/auth.js',
  './core/services/sounds.js',
  './core/window-manager/window-manager.js',
  './core/window-manager/snap-zones.js',
  './core/window-manager/task-switcher.js',
  './core/motion/motion.js',
  './apps/explorer.js',
  './apps/notepad.js',
  './apps/photos.js',
  './apps/settings.js',
  './apps/browser.js',
  './apps/calculator.js',
  './apps/clock.js',
  './apps/terminal.js',
  './apps/task-manager.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
