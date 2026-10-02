// The Systemized Year service worker.
// Caches only the app shell (public). Premium content comes from the API on every launch and is never cached here.
var CACHE = "year-shell-v1";
var SHELL = ["./", "./index.html", "./manifest.webmanifest", "./fonts/fraunces-600.woff2", "./fonts/inter-400.woff2", "./fonts/inter-600.woff2", "./fonts/inter-700.woff2"];
self.addEventListener("install", function (e) { e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); })); });
self.addEventListener("activate", function (e) { e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); })); });
self.addEventListener("fetch", function (e) {
  var url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return; // API calls go straight to the network
  e.respondWith(fetch(e.request).then(function (r) { var copy = r.clone(); caches.open(CACHE).then(function (c) { c.put(e.request, copy); }); return r; }).catch(function () { return caches.match(e.request); }));
});
