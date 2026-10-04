// Money Plan Studio service worker.
// Caches only the app shell (public). All apps share one origin, so activate clears only this app's old caches. Premium content comes from the API on every launch and is never cached here.
var CACHE = "studio-shell-v2";
var SHELL = ["./", "./index.html", "./start-here.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];
self.addEventListener("install", function (e) { e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); })); });
self.addEventListener("activate", function (e) { e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== CACHE && k.indexOf(CACHE.split("-shell-")[0] + "-shell-") === 0; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); })); });
self.addEventListener("fetch", function (e) {
  var url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return; // API calls go straight to the network
  e.respondWith(fetch(e.request).then(function (r) { if (r.ok) { var copy = r.clone(); caches.open(CACHE).then(function (c) { c.put(e.request, copy); }); } return r; }).catch(function () { return caches.match(e.request, { ignoreSearch: true }).then(function (m) { return m || Response.error(); }); }));
});
