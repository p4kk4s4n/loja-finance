const APP_VERSION = '2.0.5';
const CACHE_NAME = `loja-finance-v${APP_VERSION}`;

const APP_SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './css/tokens.css',
  './css/layout.css',
  './css/components.css',
  './js/firebase-config.js',
  './js/state.js',
  './js/utils.js',
  './js/i18n.js',
  './js/auth.js',
  './js/db.js',
  './js/ai-ocr.js',
  './js/updater.js',
  './js/sheets-export.js',
  './js/ui-sales.js',
  './js/ui-expenses.js',
  './js/ui-dashboard.js',
  './js/ui-settings.js',
  './js/app.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL_ASSETS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith('loja-finance-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Never cache version.json, GitHub API, Firebase, or Google APIs
  if (
    url.pathname.endsWith('/version.json') ||
    url.hostname.includes('api.github.com') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('firebase')
  ) {
    event.respondWith(fetch(req));
    return;
  }

  // Only handle same-origin app shell assets in cache; external CDNs pass through network-first
  if (url.origin !== self.location.origin) {
    event.respondWith(
      fetch(req).catch(() => caches.match(req))
    );
    return;
  }

  // Network-first for HTML/CSS/JS so GitHub Pages updates propagate quickly, falling back to cache offline
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
