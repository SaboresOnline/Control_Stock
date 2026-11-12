// Guarda la app en el teléfono para que abra sin señal. Al publicar una versión nueva, cambiar VERSION.
const VERSION = 'spc-deposito-0.1.0';
const ARCHIVOS = ['./', 'index.html', 'manifest.webmanifest', 'css/app.css', 'iconos/logo.png', 'iconos/icono-192.png', 'iconos/icono-512.png',
  'js/app.js', 'js/db.js', 'js/util.js', 'js/catalogo.js', 'js/normalizar.js', 'js/sesion.js', 'js/recepcion.js', 'js/leer.js', 'js/salidas.js', 'js/xlsx.js', 'js/escaner.js',
  'vendor/jspdf.umd.min.js', 'vendor/jspdf.plugin.autotable.min.js', 'vendor/pdf.min.mjs', 'vendor/pdf.worker.min.mjs'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;   // la API de lectura va directo a la red
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((r) => r || fetch(e.request)));
});
