// sw.js — AlertaRíos v2.1
// Service Worker: offline cache + push notifications

const CACHE_NAME    = 'alerta-rios-v2.1';
const CACHE_STATIC  = 'alerta-rios-static-v2.1';
const CACHE_DATA    = 'alerta-rios-data-v2.1';

// Archivos estáticos que siempre se cachean en la instalación
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=Space+Mono:wght@400;700&display=swap',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
];

// APIs cuyas respuestas se cachean con estrategia stale-while-revalidate
const DATA_ORIGINS = [
  'flood-api.open-meteo.com',
  'api.open-meteo.com',
];

// ─────────────────────────────────────────────
//  INSTALL — pre-cachear assets estáticos
// ─────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_STATIC).then(cache => {
      return Promise.allSettled(
        STATIC_ASSETS.map(url =>
          cache.add(url).catch(e => console.warn('[SW] No se pudo cachear:', url, e.message))
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// ─────────────────────────────────────────────
//  ACTIVATE — limpiar caches viejos
// ─────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_STATIC && k !== CACHE_DATA)
          .map(k => {
            console.log('[SW] Eliminando cache obsoleto:', k);
            return caches.delete(k);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// ─────────────────────────────────────────────
//  FETCH — estrategia por tipo de recurso
// ─────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // APIs de datos — stale-while-revalidate
  // Muestra datos cacheados inmediatamente, actualiza en segundo plano
  if (DATA_ORIGINS.some(origin => url.hostname.includes(origin))) {
    event.respondWith(staleWhileRevalidate(event.request, CACHE_DATA));
    return;
  }

  // Assets estáticos propios — cache first, red como fallback
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(event.request, CACHE_STATIC));
    return;
  }

  // Todo lo demás (Leaflet CDN, Google Fonts) — cache first
  if (event.request.method === 'GET') {
    event.respondWith(cacheFirst(event.request, CACHE_STATIC));
  }
});

// ─────────────────────────────────────────────
//  ESTRATEGIAS DE CACHÉ
// ─────────────────────────────────────────────

// Cache first: sirve desde caché, si no está va a red y guarda
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (e) {
    return offlineFallback(request);
  }
}

// Stale-while-revalidate: sirve caché mientras actualiza en segundo plano
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);

  // Si hay datos cacheados, los devuelve inmediatamente
  // Si no, espera la red
  return cached || fetchPromise || offlineFallback(request);
}

// Respuesta offline para la app principal
async function offlineFallback(request) {
  if (request.mode === 'navigate') {
    const cached = await caches.match('/index.html');
    if (cached) return cached;
  }
  return new Response(
    JSON.stringify({ error: 'Sin conexión', offline: true }),
    { headers: { 'Content-Type': 'application/json' } }
  );
}

// ─────────────────────────────────────────────
//  PUSH NOTIFICATIONS
// ─────────────────────────────────────────────
self.addEventListener('push', event => {
  let data = {};
  try {
    data = event.data?.json() || {};
  } catch (e) {
    data = { title: 'AlertaRíos', body: event.data?.text() || 'Nueva alerta.' };
  }

  const title   = data.title || 'AlertaRíos 🌊';
  const body    = data.body  || 'Revisa el estado de los ríos.';
  const level   = data.level || 'info';
  const type    = data.type  || 'river';

  // Color e ícono según nivel y tipo
  const isSlide   = type === 'landslide';
  const isDanger  = level === 'danger';

  const icon  = '/icons/icon-192.png';
  const badge = '/icons/icon-72.png';

  const vibrate = isDanger
    ? (isSlide ? [0, 500, 200, 500, 200, 500] : [0, 300, 150, 600, 150, 300])
    : [200, 100, 200];

  const tag = `alerta-${data.rio_id || data.zona_id || 'general'}`;

  const actions = isDanger
    ? [
        { action: 'call',  title: '📞 Llamar 123' },
        { action: 'open',  title: '🗺 Ver mapa'   },
      ]
    : [
        { action: 'open', title: '📱 Abrir app' },
      ];

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      badge,
      vibrate,
      tag,
      renotify: true,
      requireInteraction: isDanger,   // no desaparece sola si es peligro
      actions,
      data: { url: '/', level, type, rio_id: data.rio_id, zona_id: data.zona_id },
    })
  );
});

// ─────────────────────────────────────────────
//  NOTIFICATION CLICK
// ─────────────────────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();

  const action  = event.action;
  const notifData = event.notification.data || {};

  if (action === 'call') {
    event.waitUntil(clients.openWindow('tel:123'));
    return;
  }

  // Abrir o enfocar la app
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow('/');
    })
  );
});

// ─────────────────────────────────────────────
//  BACKGROUND SYNC (cuando vuelve la conexión)
// ─────────────────────────────────────────────
self.addEventListener('sync', event => {
  if (event.tag === 'sync-reports') {
    event.waitUntil(syncPendingReports());
  }
});

async function syncPendingReports() {
  try {
    // Lee reportes pendientes guardados en IndexedDB mientras no había conexión
    // (se implementa junto con la lógica de IndexedDB en index.html)
    const cache = await caches.open(CACHE_DATA);
    const pending = await cache.match('pending-reports');
    if (!pending) return;

    const reports = await pending.json();
    for (const report of reports) {
      await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(report),
      });
    }
    await cache.delete('pending-reports');
    console.log('[SW] Reportes pendientes sincronizados:', reports.length);
  } catch (e) {
    console.warn('[SW] Error sincronizando reportes:', e.message);
  }
}
