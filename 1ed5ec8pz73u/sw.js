/* Holloway & Hart app service worker (apps/chassis.py, 9 Nov 2026). It caches every file of this app when it installs, so the
   app opens with no internet. VERSION changes with every build: the next time the app is opened online the new worker installs,
   clears this app's older caches and takes over, and the page reloads itself once. Nothing is fetched from anywhere but the app's
   own folder. */
"use strict";
var VERSION = "09Nov2026.1";
var PREFIX = "hh72-";
var CACHE = PREFIX + VERSION;
var FILES = ["./", "./index.html", "./app.js", "./sw.js", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./maskable-512.png", "./apple-touch-icon.png"];

self.addEventListener("install", function (e) {
  // every file straight from the server (cache: "reload"), never the browser's HTTP cache, so a new build caches new files
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return c.addAll(FILES.map(function (f) { return new Request(f, { cache: "reload" }); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf(PREFIX) === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var scope = self.registration.scope;
  if (req.url.indexOf(scope) !== 0) return;
  e.respondWith(caches.open(CACHE).then(function (c) {
    return c.match(req, { ignoreSearch: true }).then(function (hit) {
      if (hit) return hit;
      if (req.mode === "navigate") {
        return c.match(scope).then(function (home) { return home || fetch(req); });
      }
      return fetch(req).then(function (res) {
        if (res && res.ok && res.type === "basic") { c.put(req, res.clone()); }
        return res;
      });
    });
  }));
});
