const cacheName = "alm-book-v1";

const filesToCache = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./jszip.min.js",
  "./pdf.min.js",
  "./pdf.worker.min.js",
  "./jspdf.umd.min.js",
  "./docx.min.js",
  "./alm_vm.js",
  "./alm_programs.js",
  "./script.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(cacheName).then((cache) => cache.addAll(filesToCache))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== cacheName).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => response || fetch(event.request))
  );
});
