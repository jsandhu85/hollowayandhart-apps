window.HH_BUILD = {"id": "74", "version": "09Nov2026.1", "hosted": true};
/* Holloway & Hart app chassis (apps/core.js), 7 Nov 2026.
   Shared by every single-file offline app: calendar dates as day numbers (no time-zone drift), money in integer cents,
   localStorage with a schema version and a clear banner when the browser won't keep data, Backup / Restore as .json,
   a toast with Undo, a two-step confirm, and a tiny screen router. No network, no libraries. */
"use strict";
var HH = (function () {
  var WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // ── dates: a calendar date is a whole number of days since 1 Jan 1970, built from Y/M/D (Date.UTC), never parsed from a string
  function dn(y, m, d) { return Math.round(Date.UTC(y, m - 1, d) / 86400000); }
  function ymd(n) {
    var t = new Date(n * 86400000);
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
  }
  function today() { var t = new Date(); return dn(t.getFullYear(), t.getMonth() + 1, t.getDate()); }
  function pad(x) { return (x < 10 ? "0" : "") + x; }
  function iso(n) { var a = ymd(n); return a.y + "-" + pad(a.m) + "-" + pad(a.d); }
  function parseIso(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > lastDay(y, mo)) return null;
    return dn(y, mo, d);
  }
  function lastDay(y, m) { return ymd(dn(y, m + 1, 1) - 1).d; }
  function addMonths(n, k) {            // EDATE: same day of the month, clamped to a short month's last day
    var a = ymd(n), t = a.y * 12 + (a.m - 1) + k, y = Math.floor(t / 12), m = t - y * 12 + 1;
    return dn(y, m, Math.min(a.d, lastDay(y, m)));
  }
  function monthsBetween(a, b) { var x = ymd(a), y = ymd(b); return (y.y - x.y) * 12 + (y.m - x.m); }
  function weekday(n) { return ((n % 7) + 7 + 4) % 7; }       // 1 Jan 1970 was a Thursday
  function fmtDate(n, withYear) {
    var a = ymd(n);
    return WD[weekday(n)] + " " + a.d + " " + MO[a.m - 1] + (withYear ? " " + a.y : "");
  }
  function fmtShort(n) { var a = ymd(n); return a.d + " " + MO[a.m - 1]; }
  function fmtLong(n) { var a = ymd(n); return a.d + " " + MO[a.m - 1] + " " + a.y; }
  function mod(a, b) { return ((a % b) + b) % b; }

  // ── money: integer cents inside, two decimals and the buyer's symbol outside
  function parseMoney(s) {
    s = String(s == null ? "" : s).replace(/[\s,]/g, "").replace(/^[^\d.]+/, "");
    if (!/^(\d+(\.\d{0,2})?|\.\d{1,2})$/.test(s)) return null;
    var p = s.split(".");
    return parseInt(p[0] || "0", 10) * 100 + (p[1] ? parseInt((p[1] + "0").slice(0, 2), 10) : 0);
  }
  function money(c, cur) {
    var neg = c < 0, a = Math.abs(Math.round(c)), whole = String(Math.floor(a / 100)), cc = pad(a % 100);
    whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return (neg ? "-" : "") + (cur == null ? "$" : cur) + whole + "." + cc;
  }
  function plain(c) { var a = Math.abs(c); return Math.floor(a / 100) + "." + pad(a % 100); }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  // ── storage: one key per app, a schema number inside, every change saved at once
  function Store(prefix) {
    this.key = prefix + "data";
    this.probeKey = prefix + "probe";
    this.ok = this.probe();
  }
  Store.prototype.probe = function () {
    try {
      var s = window.localStorage;
      s.setItem(this.probeKey, "1");
      s.removeItem(this.probeKey);
      return true;
    } catch (e) { return false; }
  };
  Store.prototype.read = function () {
    if (!this.ok) return null;
    try {
      var raw = window.localStorage.getItem(this.key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  };
  Store.prototype.write = function (obj) {
    if (!this.ok) return false;
    try {
      window.localStorage.setItem(this.key, JSON.stringify(obj));
      persist();                      // on the first save, ask the browser to keep this site's data (hosted build, 9 Nov 2026)
      return true;
    } catch (e) {
      this.ok = false;
      return false;
    }
  };

  // ── files: Backup downloads a .json; Restore reads one the buyer picks
  function download(name, text) {
    var blob = new Blob([text], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.parentNode && a.parentNode.removeChild(a); }, 2000);
  }
  function readFile(file, done) {
    var r = new FileReader();
    r.onload = function () { done(null, String(r.result || "")); };
    r.onerror = function () { done(new Error("read")); };
    r.readAsText(file);
  }

  // ── toast with an optional Undo, gone after `ms`
  var toastTimer = null;
  function toast(text, undo, ms) {
    var el = $("#toast");
    clearTimeout(toastTimer);
    el.innerHTML = '<span class="toast-text">' + esc(text) + "</span>" +
      (undo ? '<button type="button" class="btn-link toast-undo">Undo</button>' : "");
    el.hidden = false;
    if (undo) {
      $(".toast-undo", el).addEventListener("click", function () { el.hidden = true; clearTimeout(toastTimer); undo(); });
    }
    toastTimer = setTimeout(function () { el.hidden = true; }, ms || 5000);
  }

  // ── a two-step confirm in a dialog of our own (no browser pop-ups)
  function confirmStep(opts) {
    var m = $("#modal");
    m.innerHTML = '<div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title">' +
      '<h2 id="modal-title">' + esc(opts.title) + "</h2>" +
      (opts.html || "<p>" + esc(opts.text) + "</p>") +
      '<div class="row-buttons"><button type="button" class="btn ' + (opts.danger ? "btn-danger" : "btn-primary") +
      '" data-act="yes">' + esc(opts.yes) + '</button><button type="button" class="btn btn-quiet" data-act="no">' +
      esc(opts.no || "Cancel") + "</button></div></div>";
    m.hidden = false;
    var yes = $('[data-act="yes"]', m), no = $('[data-act="no"]', m);
    function close() { m.hidden = true; m.innerHTML = ""; }
    yes.addEventListener("click", function () { close(); opts.onYes(); });
    no.addEventListener("click", function () { close(); if (opts.onNo) opts.onNo(); });
    no.focus();
  }

  // ── screens: one <section data-screen> visible at a time
  function show(id) {
    $$("[data-screen]").forEach(function (s) { s.hidden = s.getAttribute("data-screen") !== id; });
    $$("[data-nav]").forEach(function (b) {
      var on = b.getAttribute("data-nav") === id;
      b.classList.toggle("on", on);
      if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
    window.scrollTo(0, 0);
    var h = $('[data-screen="' + id + '"] h1');
    if (h) { h.setAttribute("tabindex", "-1"); h.focus({ preventScroll: true }); }
  }

  function applyTheme(choice) {
    document.documentElement.setAttribute("data-theme", choice === "light" || choice === "dark" ? choice : "auto");
  }

  // ── the hosted build (9 Nov 2026): the same app served from its own folder as a Home Screen web app. The build writes
  // window.HH_BUILD = { id, version, hosted } before this file; the computer copy has hosted: false and does none of this
  // beyond showing its version.
  var BUILD = window.HH_BUILD || { id: "", version: "", hosted: false };
  function standalone() {
    try {
      return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true;
    } catch (e) { return false; }
  }
  function applePhone() {
    var ua = navigator.userAgent || "";
    return /iP(hone|ad|od)/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }
  // ask the browser to keep this site's data (never blocks the app if it says no, or has no such call)
  var persistAsked = false;
  function persist() {
    if (persistAsked) return;
    persistAsked = true;
    try {
      if (navigator.storage && navigator.storage.persist) {
        navigator.storage.persist().then(function () {}, function () {});
      }
    } catch (e) {}
  }
  // Backup: on a phone or tablet that can share a file, the share sheet (Save to Files, email, a cloud drive); otherwise the
  // download as before. Returns "share" or "download" so the app can word its message. A share the buyer cancels is left alone;
  // a share that fails for any other reason falls back to the download.
  function mobile() {               // a phone or tablet (never a touch-screen laptop: a computer keeps the plain download)
    return applePhone() || /Android|Mobi/i.test(navigator.userAgent || "");
  }
  function saveFile(name, text) {
    if (mobile() && navigator.share && navigator.canShare && typeof File === "function") {
      try {
        var f = new File([text], name, { type: "application/json" });
        if (navigator.canShare({ files: [f] })) {
          navigator.share({ files: [f], title: name }).then(function () {}, function (err) {
            if (!err || err.name !== "AbortError") download(name, text);
          });
          return "share";
        }
      } catch (e) {}
    }
    download(name, text);
    return "download";
  }
  function savedMessage(mode, name) {
    return mode === "share" ? "Backup ready: " + name + ". Choose where to keep it (Files, email or a cloud drive)."
      : "Backup saved to your downloads: " + name;
  }
  // the first-run card: on a phone or tablet from Apple, how to add the app to the Home Screen (and that the browser tab keeps
  // its own data); elsewhere a one-line install hint. Dismissable; never shown once the app runs standalone.
  function installCard() {
    if (!BUILD.hosted || standalone()) return;
    var key = "hh_install_seen_" + BUILD.id;
    try { if (window.localStorage.getItem(key)) return; } catch (e) {}
    var main = $("main");
    if (!main || !main.parentNode) return;
    var box = document.createElement("div");
    box.className = "banner install";
    box.id = "install-card";
    box.setAttribute("role", "note");
    if (applePhone()) {
      box.innerHTML = "<strong>Add this app to your Home Screen first</strong>" +
        "<ol><li>Tap the Share button (the square with an arrow pointing up).</li>" +
        "<li>Choose <b>Add to Home Screen</b>, then <b>Add</b>.</li>" +
        "<li>Open the app from its new icon. That copy works offline and keeps your data.</li></ol>" +
        '<p class="small muted">Anything you type here, in the browser, stays in this browser tab and does not move to the Home Screen app.</p>';
    } else {
      box.innerHTML = "<strong>Tip: install it like an app.</strong> " +
        '<span class="small">Use your browser’s menu (Install app, or Add to Home screen) so it opens on its own and works offline.</span>';
    }
    box.innerHTML += '<div class="row-buttons"><button type="button" class="btn btn-quiet" id="install-dismiss">Got it</button></div>';
    main.parentNode.insertBefore(box, main);
    $("#install-dismiss").addEventListener("click", function () {
      box.parentNode && box.parentNode.removeChild(box);
      try { window.localStorage.setItem(key, "1"); } catch (e) {}
    });
  }
  function showVersion() {
    var el = $("#app-version");
    if (BUILD.version) document.documentElement.setAttribute("data-version", BUILD.version);
    if (el && BUILD.version) {
      el.textContent = "Version " + BUILD.version + (BUILD.hosted ? "" : " · computer copy");
    }
  }
  // the service worker caches every app file, so the app opens offline; a new build (a new sw.js version) installs the next
  // time the app is opened online, and the page reloads itself once the new worker has taken over. The <html> element records
  // the worker's state (data-sw, data-cache-files) and the version line says 'works offline' once every file is cached, so a
  // buyer (and the QA) can see the offline copy is ready without any script.
  function offlineReady() {
    var h = document.documentElement;
    if (!window.caches || !caches.keys) return;
    caches.keys().then(function (keys) {
      var own = keys.filter(function (k) { return k.indexOf("hh" + BUILD.id + "-") === 0; });
      if (!own.length) return null;
      return caches.open(own[own.length - 1]).then(function (c) { return c.keys(); }).then(function (reqs) {
        h.setAttribute("data-cache-files", String(reqs.length));
        var el = $("#app-version");
        if (el && reqs.length >= 8 && el.textContent.indexOf("works offline") < 0) el.textContent += " · works offline";
      });
    }).then(function () {}, function () {});
  }
  function startWorker() {
    if (!BUILD.hosted || !("serviceWorker" in navigator)) return;
    var h = document.documentElement;
    var had = !!navigator.serviceWorker.controller, reloaded = false;
    if (had) h.setAttribute("data-sw", "controlled");
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      h.setAttribute("data-sw", "controlled");
      if (had && !reloaded) { reloaded = true; window.location.reload(); }
    });
    try {
      navigator.serviceWorker.register("./sw.js").then(function (reg) {
        if (reg && reg.update) { reg.update().then(function () {}, function () {}); }
        return navigator.serviceWorker.ready;
      }).then(function () { offlineReady(); setTimeout(offlineReady, 1500); setTimeout(offlineReady, 4000); }, function () {});
    } catch (e) {}
  }
  function boot() { showVersion(); installCard(); startWorker(); }
  if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", boot); } else { boot(); }

  return {
    dn: dn, ymd: ymd, today: today, iso: iso, parseIso: parseIso, lastDay: lastDay, addMonths: addMonths,
    monthsBetween: monthsBetween, weekday: weekday, fmtDate: fmtDate, fmtShort: fmtShort, fmtLong: fmtLong, mod: mod,
    parseMoney: parseMoney, money: money, plain: plain, esc: esc, $: $, $$: $$, Store: Store, download: download,
    readFile: readFile, toast: toast, confirmStep: confirmStep, show: show, applyTheme: applyTheme,
    build: BUILD, standalone: standalone, persist: persist, saveFile: saveFile, savedMessage: savedMessage
  };
})();

/* Product 74: Book Tracker App (specs/health/74-book-tracker-app.yaml), 8 Nov 2026.
   A whole library in one file: books with status, rating, series, pages and dates; a to-read list in the buyer's order; series
   with the next unread and missing numbers; a yearly challenge with pace; stats per year; Goodreads / StoryGraph export CSV
   import (columns matched by header name, matches by title + author) and the app's own CSV export. Dates are day numbers
   from HH (apps/core.js); ratings are halves from 0.5 to 5. */
(function () {
  "use strict";
  var SCHEMA = 1;
  var APP_ID = "hollowayhart-books";
  var STATUS = ["To read", "Reading", "Finished", "Did not finish"];
  var FORMATS = ["", "Print", "Ebook", "Audio"];
  var DEFAULT_GENRES = ["Fiction", "Mystery & crime", "Fantasy", "Science fiction", "Romance", "Historical", "Non-fiction", "Memoir",
                        "Self-help", "Young adult", "Children's", "Poetry", "Other"];
  var MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var OWN_HEADERS = ["Title", "Author", "Series", "Series No", "Format", "Status", "Rating", "Pages", "Pages read", "Started", "Finished",
                     "Genre", "Tags", "Owned", "ISBN", "Notes"];
  var REMIND_DAYS = 30;
  var $ = HH.$, $$ = HH.$$, esc = HH.esc;
  var store = new HH.Store("hh74_");
  var D = null;
  var T = HH.today();
  var editingBook = null, bookReturn = "library", pendingRestore = null, pendingImport = null, statsYear = null;
  var filt = { q: "", status: "", genre: "", rating: "", year: "", sort: "title" };

  // ── data ──────────────────────────────────────────────────────────
  function blank() {
    return {
      schema: SCHEMA,
      settings: { theme: "auto", goals: {}, genres: DEFAULT_GENRES.slice() },
      books: [],
      meta: { created: HH.iso(HH.today()), lastBackup: null, reminderDismissed: null, sample: false, onboarded: false, nextId: 1 }
    };
  }
  function isInt(x) { return typeof x === "number" && isFinite(x) && Math.floor(x) === x; }
  function isDate(s) { return HH.parseIso(s) != null; }
  function isText(s, n) { return typeof s === "string" && s.length <= n; }
  function validRating(r) { return r === null || (typeof r === "number" && r >= 0.5 && r <= 5 && Math.round(r * 2) === r * 2); }
  function validate(d) {
    try {
      var s = d.settings, m = d.meta, k;
      if (d.schema !== SCHEMA || !s || !m || !Array.isArray(d.books)) return false;
      if (["auto", "light", "dark"].indexOf(s.theme) < 0 || !s.goals || typeof s.goals !== "object") return false;
      for (k in s.goals) if (!/^\d{4}$/.test(k) || !isInt(s.goals[k]) || s.goals[k] < 1) return false;
      if (!Array.isArray(s.genres) || !s.genres.every(function (g) { return isText(g, 40) && g; })) return false;
      for (var i = 0; i < d.books.length; i++) {
        var b = d.books[i];
        if (!isInt(b.id) || !isText(b.title, 200) || !b.title || !isText(b.author, 120)) return false;
        if (!isText(b.series, 80) || !(b.seriesNo === null || (typeof b.seriesNo === "number" && b.seriesNo >= 0))) return false;
        if (FORMATS.indexOf(b.format) < 0 || STATUS.indexOf(b.status) < 0 || !validRating(b.rating)) return false;
        if (!(b.pages === null || (isInt(b.pages) && b.pages >= 0)) || !(b.read === null || (isInt(b.read) && b.read >= 0))) return false;
        if (!(b.started === null || isDate(b.started)) || !(b.finished === null || isDate(b.finished))) return false;
        if (!isText(b.genre, 40) || !Array.isArray(b.tags) || !b.tags.every(function (t) { return isText(t, 40); })) return false;
        if (typeof b.owned !== "boolean" || !isText(b.notes, 5000) || !isText(b.isbn, 20) || !isInt(b.order) || !isDate(b.added)) return false;
      }
      if (!isDate(m.created) || !(m.lastBackup === null || isDate(m.lastBackup)) || !(m.reminderDismissed === null || isDate(m.reminderDismissed))) return false;
      if (typeof m.sample !== "boolean" || typeof m.onboarded !== "boolean" || !isInt(m.nextId)) return false;
      return true;
    } catch (e) { return false; }
  }
  function migrate(obj) {
    if (!obj || typeof obj !== "object") return { error: "broken" };
    var v = obj.schema;
    if (!isInt(v) || v < 1) return { error: "broken" };
    if (v > SCHEMA) return { error: "newer", version: v };
    var d = JSON.parse(JSON.stringify(obj));
    return validate(d) ? { data: d } : { error: "broken" };
  }
  function save() { if (!store.write(D)) renderBanners(); }
  function newId() { return D.meta.nextId++; }
  function hasOwn() { return D.books.some(function (b) { return !b.sample; }); }
  function byId(id) { return D.books.filter(function (b) { return b.id === id; })[0]; }
  function newBook(fields) {
    var b = { id: newId(), title: "", author: "", series: "", seriesNo: null, format: "", status: "To read", rating: null, pages: null, read: null,
              started: null, finished: null, genre: "", tags: [], owned: false, notes: "", isbn: "", order: 0, added: HH.iso(T) };
    for (var k in fields) b[k] = fields[k];
    b.order = nextOrder();
    if (D.meta.sample) b.sample = false;
    return b;
  }
  function nextOrder() { var mx = 0; D.books.forEach(function (b) { if (b.order > mx) mx = b.order; }); return mx + 1; }
  function key(title, author) { return (String(title) + "|" + String(author)).toLowerCase().replace(/\s+/g, ""); }

  // ── the year, the challenge, the stats ───────────────────────────
  function yearOf(iso) { var d = HH.parseIso(iso); return d == null ? null : HH.ymd(d).y; }
  function finishedIn(y) { return D.books.filter(function (b) { return b.status === "Finished" && yearOf(b.finished) === y; }); }
  function challenge(t) {
    var a = HH.ymd(t), y = a.y, goal = D.settings.goals[String(y)] || null, n = finishedIn(y).length;
    if (!goal) return { year: y, goal: null, n: n };
    var doy = t - HH.dn(y, 1, 1) + 1, days = HH.dn(y + 1, 1, 1) - HH.dn(y, 1, 1);
    var target = goal * doy / days, behind = Math.ceil(target - n);
    return { year: y, goal: goal, n: n, target: target, onPace: n >= target, behind: behind > 0 ? behind : 0, doy: doy, days: days };
  }
  function stats(y) {
    var fin = finishedIn(y), months = [], i;
    for (i = 0; i < 12; i++) months.push({ books: 0, pages: 0 });
    var rated = [], genres = {}, authors = {}, formats = {}, pages = 0, longest = null, shortest = null;
    fin.forEach(function (b) {
      var m = HH.ymd(HH.parseIso(b.finished)).m - 1;
      months[m].books++;
      if (b.pages) { months[m].pages += b.pages; pages += b.pages; if (!longest || b.pages > longest.pages) longest = b; if (!shortest || b.pages < shortest.pages) shortest = b; }
      if (b.rating) rated.push(b.rating);
      if (b.genre) genres[b.genre] = (genres[b.genre] || 0) + 1;
      if (b.author) authors[b.author] = (authors[b.author] || 0) + 1;
      formats[b.format || "Not set"] = (formats[b.format || "Not set"] || 0) + 1;
    });
    var top = function (o) { return Object.keys(o).map(function (k) { return [k, o[k]]; }).sort(function (a, b) { return b[1] - a[1] || (a[0] < b[0] ? -1 : 1); }).slice(0, 5); };
    var dnf = D.books.filter(function (b) { return b.status === "Did not finish" && (yearOf(b.finished) === y || (b.finished === null && yearOf(b.added) === y)); }).length;
    return { year: y, books: fin.length, pages: pages, months: months, avg: rated.length ? rated.reduce(function (a, b) { return a + b; }, 0) / rated.length : null,
             genres: top(genres), authors: top(authors), formats: top(formats), dnf: dnf, longest: longest, shortest: shortest };
  }

  // ── series ───────────────────────────────────────────────────────
  function seriesList() {
    var groups = {};
    D.books.forEach(function (b) { if (b.series) (groups[b.series] = groups[b.series] || []).push(b); });
    return Object.keys(groups).sort(function (a, b) { return a.toLowerCase() < b.toLowerCase() ? -1 : 1; }).map(function (name) {
      var bs = groups[name], nums = bs.map(function (b) { return b.seriesNo; }).filter(function (n) { return n !== null; });
      var read = bs.filter(function (b) { return b.status === "Finished"; }).length, owned = bs.filter(function (b) { return b.owned; }).length;
      var unread = bs.filter(function (b) { return b.status !== "Finished" && b.status !== "Did not finish" && b.seriesNo !== null; })
        .sort(function (a, b) { return a.seriesNo - b.seriesNo; })[0];
      var missing = [];
      if (nums.length) {
        var lo = Math.ceil(Math.min.apply(null, nums)), hi = Math.floor(Math.max.apply(null, nums));
        for (var n = lo; n <= hi; n++) if (nums.indexOf(n) < 0) missing.push(n);
      }
      return { name: name, books: bs.sort(function (a, b) { return (a.seriesNo === null) - (b.seriesNo === null) || a.seriesNo - b.seriesNo; }),
               read: read, owned: owned, next: unread || null, missing: missing };
    });
  }

  // ── CSV ──────────────────────────────────────────────────────────
  function parseCsv(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    var rows = [], row = [], cell = "", i = 0, q = false, ch;
    while (i < text.length) {
      ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === ",") { row.push(cell); cell = ""; }
      else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
      else cell += ch;
      i++;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (c) { return c.trim() !== ""; }); });
  }
  function csvCell(v) {
    v = String(v == null ? "" : v);
    return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  function parseDate(s) {
    s = String(s || "").trim();
    var m = /^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/.exec(s);
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > HH.lastDay(y, mo)) return null;
    return HH.iso(HH.dn(y, mo, d));
  }
  function cleanIsbn(s) { return String(s || "").replace(/^="?|"?$/g, "").replace(/"/g, "").trim().slice(0, 20); }
  function halfUp(x) { x = +x; if (!(x > 0)) return null; var h = Math.ceil(x * 2 - 1e-9) / 2; return Math.min(5, Math.max(0.5, h)); }
  function fmtFrom(s) {
    s = String(s || "").toLowerCase();
    if (/audio/.test(s)) return "Audio";
    if (/kindle|ebook|e-book|digital|epub/.test(s)) return "Ebook";
    if (/paper|hard|print|physical|book/.test(s)) return "Print";
    return "";
  }
  function splitTags(s, drop) {
    return String(s || "").split(/[,;]/).map(function (t) { return t.trim().slice(0, 40); }).filter(function (t) { return t && (!drop || drop.indexOf(t) < 0); });
  }
  function readCsv(text) {
    var rows = parseCsv(text);
    if (rows.length < 2) return { error: "This file has no rows to import." };
    var head = rows[0].map(function (h) { return h.trim(); }), idx = {};
    head.forEach(function (h, i) { idx[h.toLowerCase()] = i; });
    var col = function (r, name) { var i = idx[name.toLowerCase()]; return i == null ? "" : (r[i] || ""); };
    var kind = null;
    if (idx.title != null && idx.status != null && idx["series no"] != null) kind = "own";
    else if (idx.title != null && idx.author != null && (idx["exclusive shelf"] != null || idx["my rating"] != null || idx["book id"] != null)) kind = "goodreads";
    else if (idx.title != null && idx.authors != null && idx["read status"] != null) kind = "storygraph";
    else if (idx.title != null && idx.author != null) kind = "goodreads";
    else if (idx.title != null && idx.authors != null) kind = "storygraph";
    if (!kind) return { error: "This doesn't look like a Goodreads or StoryGraph export, or this app's own CSV. It needs a Title column and an Author (or Authors) column." };
    var books = [];
    rows.slice(1).forEach(function (r) {
      var b = { title: String(col(r, "Title")).trim().slice(0, 200), author: "", series: "", seriesNo: null, format: "", status: "To read", rating: null, pages: null, read: null,
                started: null, finished: null, genre: "", tags: [], owned: false, notes: "", isbn: "" };
      if (!b.title) return;
      if (kind === "goodreads") {
        b.author = String(col(r, "Author")).trim().slice(0, 120);
        var shelf = String(col(r, "Exclusive Shelf")).trim().toLowerCase();
        b.status = shelf === "read" ? "Finished" : shelf === "currently-reading" ? "Reading" : "To read";
        var mr = parseInt(col(r, "My Rating"), 10);
        b.rating = mr > 0 ? Math.min(5, mr) : null;
        b.finished = parseDate(col(r, "Date Read"));
        var np = parseInt(col(r, "Number of Pages"), 10);
        b.pages = np > 0 ? np : null;
        b.tags = splitTags(col(r, "Bookshelves"), ["read", "currently-reading", "to-read"]);
        b.isbn = cleanIsbn(col(r, "ISBN13")) || cleanIsbn(col(r, "ISBN"));
        b.notes = String(col(r, "My Review")).slice(0, 5000);
        b.format = fmtFrom(col(r, "Binding"));
        b.owned = parseInt(col(r, "Owned Copies"), 10) > 0;
        b.added = parseDate(col(r, "Date Added"));
      } else if (kind === "storygraph") {
        b.author = String(col(r, "Authors")).trim().slice(0, 120);
        var rs = String(col(r, "Read Status")).trim().toLowerCase();
        b.status = rs === "read" ? "Finished" : rs === "currently-reading" ? "Reading" : rs === "did-not-finish" ? "Did not finish" : "To read";
        b.rating = halfUp(col(r, "Star Rating"));
        b.finished = parseDate(col(r, "Last Date Read"));
        b.format = fmtFrom(col(r, "Format"));
        b.tags = splitTags(col(r, "Tags"));
        b.isbn = cleanIsbn(col(r, "ISBN/UID"));
        b.notes = String(col(r, "Review")).slice(0, 5000);
        b.owned = /^(yes|true|1)$/i.test(String(col(r, "Owned?")).trim());
        b.added = parseDate(col(r, "Date Added"));
      } else {
        b.author = String(col(r, "Author")).trim().slice(0, 120);
        b.series = String(col(r, "Series")).trim().slice(0, 80);
        var sn = parseFloat(col(r, "Series No"));
        b.seriesNo = isFinite(sn) && sn >= 0 ? sn : null;
        b.format = FORMATS.indexOf(col(r, "Format")) >= 0 ? col(r, "Format") : fmtFrom(col(r, "Format"));
        b.status = STATUS.indexOf(col(r, "Status")) >= 0 ? col(r, "Status") : "To read";
        b.rating = halfUp(col(r, "Rating"));
        var pg = parseInt(col(r, "Pages"), 10), rd = parseInt(col(r, "Pages read"), 10);
        b.pages = pg > 0 ? pg : null; b.read = rd >= 0 ? rd : null;
        b.started = parseDate(col(r, "Started")); b.finished = parseDate(col(r, "Finished"));
        b.genre = String(col(r, "Genre")).trim().slice(0, 40);
        b.tags = splitTags(col(r, "Tags"));
        b.owned = /^(yes|true|1)$/i.test(String(col(r, "Owned")).trim());
        b.isbn = cleanIsbn(col(r, "ISBN"));
        b.notes = String(col(r, "Notes")).slice(0, 5000);
      }
      books.push(b);
    });
    return { kind: kind, books: books };
  }
  function previewImport(parsed) {
    var have = {};
    D.books.forEach(function (b) { have[key(b.title, b.author)] = b; });
    var fresh = 0, matched = 0;
    parsed.books.forEach(function (b) { if (have[key(b.title, b.author)]) matched++; else fresh++; });
    return { total: parsed.books.length, fresh: fresh, matched: matched };
  }
  function doImport(parsed, updateMatches) {
    var have = {};
    D.books.forEach(function (b) { have[key(b.title, b.author)] = b; });
    var added = 0, updated = 0;
    parsed.books.forEach(function (b) {
      var m = have[key(b.title, b.author)];
      if (m) {
        if (updateMatches) {
          m.status = b.status;
          if (b.rating !== null) m.rating = b.rating;
          if (b.finished) m.finished = b.finished;
          if (b.started) m.started = b.started;
          updated++;
        }
        return;
      }
      var nb = newBook({ title: b.title, author: b.author, series: b.series, seriesNo: b.seriesNo, format: b.format, status: b.status, rating: b.rating,
                         pages: b.pages, read: b.read, started: b.started, finished: b.finished, genre: b.genre, tags: b.tags, owned: b.owned,
                         notes: b.notes, isbn: b.isbn });
      if (b.added) nb.added = b.added;
      D.books.push(nb);
      have[key(b.title, b.author)] = nb;
      added++;
    });
    save();
    return { added: added, updated: updated };
  }
  function exportCsv() {
    var lines = [OWN_HEADERS.map(csvCell).join(",")];
    D.books.forEach(function (b) {
      lines.push([b.title, b.author, b.series, b.seriesNo === null ? "" : b.seriesNo, b.format, b.status, b.rating === null ? "" : b.rating,
                  b.pages === null ? "" : b.pages, b.read === null ? "" : b.read, b.started || "", b.finished || "", b.genre, b.tags.join("; "),
                  b.owned ? "Yes" : "No", b.isbn, b.notes].map(csvCell).join(","));
    });
    var name = "hollowayhart-books-" + HH.iso(T) + ".csv";
    HH.download(name, "﻿" + lines.join("\r\n"));
    HH.toast("Library saved to your downloads: " + name, null, 6000);
  }

  // ── wording helpers ──────────────────────────────────────────────
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
  function stars(r) {
    if (r === null) return "";
    var full = Math.floor(r), half = r - full >= 0.5, s = "";
    for (var i = 0; i < full; i++) s += "★";
    if (half) s += "½";
    return s;
  }
  function ratingText(r) { return r === null ? "" : (r % 1 ? r.toFixed(1) : String(r)) + " stars"; }
  function blocks(frac) {
    var on = Math.max(0, Math.min(20, Math.round(frac * 20))), h = '<span class="blocks" aria-hidden="true">';
    for (var i = 0; i < 20; i++) h += '<i class="' + (i < on ? "on" : "") + '"></i>';
    return h + "</span>";
  }
  function bookLine(b) {
    var bits = [];
    if (b.author) bits.push(b.author);
    if (b.series) bits.push(b.series + (b.seriesNo !== null ? " #" + b.seriesNo : ""));
    if (b.format) bits.push(b.format);
    return bits.join(" · ");
  }
  function bookRow(b, extra) {
    var sub = bookLine(b), st = b.status + (b.status === "Finished" && b.finished ? " " + HH.fmtLong(HH.parseIso(b.finished)) : "");
    return '<li data-book="' + b.id + '"><button type="button" class="rowbtn" data-edit-book="' + b.id + '" aria-label="Change ' + esc(b.title) + '"><span class="what"><b>' +
      esc(b.title) + "</b>" + (sub ? '<br><span class="small muted">' + esc(sub) + "</span>" : "") + '<br><span class="tag">' + esc(st) + "</span>" +
      (b.rating !== null ? ' <span class="small">' + stars(b.rating) + "</span>" : "") + (extra || "") +
      '</span><span class="chev" aria-hidden="true">›</span></button></li>';
  }

  // ── rendering ────────────────────────────────────────────────────
  function render() {
    T = HH.today();
    HH.applyTheme(D.settings.theme);
    renderBanners();
    renderHome();
    renderLibrary();
    renderTbr();
    renderSeries();
    renderStats();
    renderImport();
    renderSettings();
  }
  function renderBanners() {
    var h = "";
    if (!store.ok) {
      h += '<div class="banner" id="storage-banner" role="alert"><strong>Your browser isn\'t saving data in this window. ' +
        "Use Backup before you close it.</strong>This happens in private windows, or when the browser is set to block site data. " +
        "The app still works until you close it.</div>";
    }
    if (D && D.meta.sample) {
      h += '<div class="banner slim" id="sample-banner"><span><span class="sample-flag">SAMPLE</span> · made-up books</span>' +
        '<button type="button" class="btn btn-quiet" data-clear-sample>Clear sample</button></div>';
    } else if (D && D.meta.onboarded && hasOwn() && store.ok) {
      var since = HH.parseIso(D.meta.lastBackup || D.meta.created), dis = HH.parseIso(D.meta.reminderDismissed);
      if (T - since >= REMIND_DAYS && (dis == null || T - dis >= REMIND_DAYS)) {
        h += '<div class="banner" id="backup-banner"><strong>' + (D.meta.lastBackup ? "Your last backup was " +
          HH.fmtLong(since) + "." : "You haven't made a backup yet.") + "</strong>A backup is a small file with everything in the app, " +
          'in case the browser\'s data is ever cleared.<div class="row-buttons"><button type="button" class="btn btn-primary" data-backup>' +
          'Back up now</button><button type="button" class="btn btn-quiet" data-dismiss-backup>Not now</button></div></div>';
      }
    }
    $("#banners").innerHTML = h;
  }
  function renderHome() {
    var reading = D.books.filter(function (b) { return b.status === "Reading"; });
    $("#now-list").innerHTML = reading.map(function (b) {
      var frac = b.pages && b.read ? Math.min(1, b.read / b.pages) : 0;
      var prog = b.pages ? (b.read || 0) + " of " + b.pages + " pages · " + Math.round(frac * 100) + "%" : "pages not set";
      return bookRow(b, '<br><span class="small muted prog">' + esc(prog) + "</span><br>" + blocks(frac));
    }).join("");
    $("#now-none").hidden = reading.length > 0;
    var c = challenge(T);
    $("#ch-title").textContent = c.year + " reading challenge";
    if (c.goal) {
      $("#ch-num").textContent = c.n + " of " + c.goal;
      $("#ch-cap").textContent = c.onPace ? "on pace" : plural(c.behind, "book", "books") + " behind pace";
      $("#ch-note").textContent = "To finish " + c.goal + " this year you'd be at " + c.target.toFixed(1) + " by today (day " + c.doy + " of " + c.days + ").";
    } else {
      $("#ch-num").textContent = String(c.n);
      $("#ch-cap").textContent = "finished this year";
      $("#ch-note").textContent = "Set a goal for " + c.year + " in Settings to see your pace.";
    }
    var fin = D.books.filter(function (b) { return b.status === "Finished" && b.finished; }).sort(function (a, b) { return HH.parseIso(b.finished) - HH.parseIso(a.finished) || b.id - a.id; }).slice(0, 5);
    $("#last-list").innerHTML = fin.map(function (b) { return bookRow(b); }).join("");
    $("#last-none").hidden = fin.length > 0;
  }
  function filtered() {
    var q = filt.q.toLowerCase().replace(/\s+/g, " ").trim();
    var out = D.books.filter(function (b) {
      if (filt.status && b.status !== filt.status) return false;
      if (filt.genre && b.genre !== filt.genre) return false;
      if (filt.rating && !(b.rating !== null && b.rating >= +filt.rating)) return false;
      if (filt.year && String(yearOf(b.finished)) !== filt.year) return false;
      if (q) {
        var hay = (b.title + " " + b.author + " " + b.series + " " + b.tags.join(" ") + " " + b.genre).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    var cmp = { title: function (a, b) { return a.title.toLowerCase() < b.title.toLowerCase() ? -1 : a.title.toLowerCase() > b.title.toLowerCase() ? 1 : a.id - b.id; },
                author: function (a, b) { return a.author.toLowerCase() < b.author.toLowerCase() ? -1 : a.author.toLowerCase() > b.author.toLowerCase() ? 1 : cmp.title(a, b); },
                finished: function (a, b) { return (HH.parseIso(b.finished) || -1e9) - (HH.parseIso(a.finished) || -1e9) || cmp.title(a, b); },
                rating: function (a, b) { return (b.rating || 0) - (a.rating || 0) || cmp.title(a, b); } };
    return out.sort(cmp[filt.sort] || cmp.title);
  }
  function renderLibrary() {
    var years = {};
    D.books.forEach(function (b) { var y = yearOf(b.finished); if (y) years[y] = 1; });
    $("#lf-genre").innerHTML = '<option value="">Any genre</option>' + D.settings.genres.map(function (g) { return "<option" + (g === filt.genre ? " selected" : "") + ">" + esc(g) + "</option>"; }).join("");
    $("#lf-year").innerHTML = '<option value="">Any year finished</option>' + Object.keys(years).sort().reverse().map(function (y) { return "<option" + (y === filt.year ? " selected" : "") + ">" + y + "</option>"; }).join("");
    $("#lf-status").value = filt.status; $("#lf-rating").value = filt.rating; $("#lf-sort").value = filt.sort; $("#lf-q").value = filt.q;
    var list = filtered();
    $("#lib-list").innerHTML = list.map(function (b) { return bookRow(b); }).join("");
    $("#lib-none").hidden = list.length > 0;
    $("#lib-count").textContent = plural(list.length, "book", "books") + (list.length !== D.books.length ? " of " + D.books.length : "");
  }
  function tbrBooks() { return D.books.filter(function (b) { return b.status === "To read"; }).sort(function (a, b) { return a.order - b.order || a.id - b.id; }); }
  function renderTbr() {
    var list = tbrBooks();
    $("#tbr-list").innerHTML = list.map(function (b, i) {
      return '<li data-book="' + b.id + '"><span class="what"><b>' + esc(b.title) + "</b>" + (bookLine(b) ? '<br><span class="small muted">' + esc(bookLine(b)) + "</span>" : "") +
        '</span><span class="row-buttons mini"><button type="button" class="btn btn-quiet" data-tbr-up="' + b.id + '" aria-label="Move up"' + (i === 0 ? " disabled" : "") + '>↑</button>' +
        '<button type="button" class="btn btn-quiet" data-tbr-down="' + b.id + '" aria-label="Move down"' + (i === list.length - 1 ? " disabled" : "") + '>↓</button>' +
        '<button type="button" class="btn btn-quiet" data-edit-book="' + b.id + '">Open</button></span></li>';
    }).join("");
    $("#tbr-none").hidden = list.length > 0;
    $("#tbr-genre").innerHTML = '<option value="">Any genre</option>' + D.settings.genres.map(function (g) { return "<option>" + esc(g) + "</option>"; }).join("");
  }
  function renderSeries() {
    var ss = seriesList();
    $("#series-list").innerHTML = ss.map(function (s) {
      return '<li data-series="' + esc(s.name) + '"><span class="what"><b>' + esc(s.name) + '</b><br><span class="small muted">' + plural(s.books.length, "book", "books") +
        " · " + s.read + " read · " + s.owned + " owned" + (s.next ? " · next unread #" + s.next.seriesNo + " " + esc(s.next.title) : " · all read") +
        (s.missing.length ? " · missing #" + s.missing.join(", #") : "") + '</span><br><span class="small">' +
        s.books.map(function (b) { return '<span class="tag' + (b.status === "Finished" ? " done" : "") + '">' + (b.seriesNo !== null ? "#" + b.seriesNo + " " : "") + esc(b.title) + "</span>"; }).join(" ") +
        "</span></span></li>";
    }).join("");
    $("#series-none").hidden = ss.length > 0;
  }
  function renderStats() {
    var years = {}, cur = HH.ymd(T).y;
    D.books.forEach(function (b) { var y = yearOf(b.finished); if (y) years[y] = 1; });
    years[cur] = 1;
    var keys = Object.keys(years).sort().reverse();
    if (!statsYear || keys.indexOf(String(statsYear)) < 0) statsYear = cur;
    $("#st-year").innerHTML = keys.map(function (y) { return '<option value="' + y + '"' + (+y === statsYear ? " selected" : "") + ">" + y + "</option>"; }).join("");
    var s = stats(statsYear), mx = 1;
    s.months.forEach(function (m) { if (m.books > mx) mx = m.books; });
    $("#st-months").innerHTML = s.months.map(function (m, i) {
      return '<li class="plain"><span class="mo">' + MO[i] + '</span><span class="bar"><i style="width:' + Math.round(m.books / mx * 100) + '%"></i></span><span class="small"><b>' +
        plural(m.books, "book", "books") + "</b> · " + m.pages.toLocaleString("en-AU") + " pages</span></li>";
    }).join("");
    $("#st-books").textContent = plural(s.books, "book", "books") + " · " + s.pages.toLocaleString("en-AU") + " pages";
    $("#st-avg").textContent = s.avg === null ? "No ratings yet" : s.avg.toFixed(2) + " stars";
    $("#st-genres").textContent = s.genres.length ? s.genres.map(function (g) { return g[0] + " (" + g[1] + ")"; }).join(", ") : "—";
    $("#st-authors").textContent = s.authors.length ? s.authors.map(function (g) { return g[0] + " (" + g[1] + ")"; }).join(", ") : "—";
    $("#st-formats").textContent = s.formats.length ? s.formats.map(function (g) { return g[0] + " (" + g[1] + ")"; }).join(", ") : "—";
    $("#st-dnf").textContent = String(s.dnf);
    $("#st-longest").textContent = s.longest ? s.longest.title + " · " + s.longest.pages + " pages" : "—";
    $("#st-shortest").textContent = s.shortest ? s.shortest.title + " · " + s.shortest.pages + " pages" : "—";
  }
  function renderImport() {
    $("#lib-size").textContent = plural(D.books.length, "book", "books") + " in your library";
  }
  function renderSettings() {
    var y = HH.ymd(T).y;
    $("#s-goal-year").textContent = y;
    $("#s-goal").value = D.settings.goals[String(y)] || "";
    $("#s-genres").value = D.settings.genres.join("\n");
    $$('input[name="theme"]').forEach(function (r) { r.checked = r.value === D.settings.theme; });
    $("#last-backup").textContent = D.meta.lastBackup ? "Last backup: " + HH.fmtLong(HH.parseIso(D.meta.lastBackup)) : "No backup made yet.";
    $("#sample-state").textContent = D.meta.sample ? "Sample books are on: everything in the app is made up." :
      "Sample books are off. You can load made-up books to look around while the app is empty.";
    $("#sample-btn").textContent = D.meta.sample ? "Clear the sample books" : "Load sample books";
  }
  function go(id) {
    render();
    HH.show(id);
    $("#tabs").hidden = id === "welcome";
  }

  // ── first run ────────────────────────────────────────────────────
  function welcomeStep(k) {
    [1, 2, 3].forEach(function (i) { $("#welcome-" + i).hidden = i !== k; $("#st" + i).classList.toggle("on", i <= k); });
    var h1 = $("#welcome-" + k + " h1");
    if (h1) { h1.setAttribute("tabindex", "-1"); h1.focus(); }
  }
  function startWelcome() {
    go("welcome");
    $("#w-goal").value = "";
    $("#w-goal-year").textContent = HH.ymd(T).y;
    welcomeStep(1);
  }

  // ── sample (invented titles and authors) ─────────────────────────
  function loadSample() {
    var t = HH.today(), y = HH.ymd(t).y, d = blank(), id = 1;
    d.settings.theme = D ? D.settings.theme : "auto";
    d.settings.goals[String(y)] = 24;
    var rows = [
      ["The Lamplighter's Daughter", "Rosalind Ferrier", "", null, "Print", "Reading", null, 412, 180, -6, null, "Historical", ["library"], true],
      ["Salt Over Harbour Street", "Teodor Marsh", "", null, "Audio", "Reading", null, 298, 61, -2, null, "Mystery & crime", [], false],
      ["A Garden of Quiet Hours", "Imogen Vale", "", null, "Print", "Finished", 5, 336, 336, -40, -27, "Fiction", ["favourite"], true],
      ["Nine Keys of Marrowgate", "Caspian Holt", "Marrowgate", 1, "Ebook", "Finished", 4, 455, 455, -70, -52, "Fantasy", [], true],
      ["The Marrowgate Tide", "Caspian Holt", "Marrowgate", 2, "Ebook", "Finished", 4.5, 480, 480, -50, -33, "Fantasy", [], true],
      ["Winter at Marrowgate", "Caspian Holt", "Marrowgate", 4, "Ebook", "To read", null, 470, null, null, null, "Fantasy", [], true],
      ["Small Engines of Hope", "Priya Lindqvist", "", null, "Print", "Finished", 3.5, 221, 221, -95, -88, "Non-fiction", ["book club"], false],
      ["The Orchard Ledger", "Hamish Orrell", "", null, "Print", "Did not finish", null, 390, 90, -120, -110, "Fiction", [], false],
      ["Letters from a Cold Coast", "Wren Delacroix", "", null, "Audio", "Finished", 4, 310, 310, -150, -131, "Memoir", [], false],
      ["The Second Door", "Mira Castellane", "Harlow Street", 1, "Print", "Finished", 4, 352, 352, -200, -186, "Mystery & crime", [], true],
      ["Harlow Street After Dark", "Mira Castellane", "Harlow Street", 2, "Print", "To read", null, 368, null, null, null, "Mystery & crime", [], true],
      ["Maps for Lost Weather", "Oskar Benning", "", null, "Ebook", "To read", null, 288, null, null, null, "Science fiction", ["gift"], false],
      ["Thread, Needle, Sky", "Lucia Fairweather", "", null, "Print", "To read", null, 256, null, null, null, "Romance", [], true],
      ["Everyday Astronomy for Tired People", "Dev Ramanathan", "", null, "Print", "Finished", 3, 180, 180, -260, -250, "Non-fiction", [], false],
      ["The Last Ferry to Ellis Reach", "Juno Hartigan", "", null, "Audio", "Finished", 4.5, 402, 402, -300, -281, "Fiction", ["favourite"], false]
    ];
    d.books = rows.map(function (r, i) {
      return { id: id++, title: r[0], author: r[1], series: r[2], seriesNo: r[3], format: r[4], status: r[5], rating: r[6], pages: r[7], read: r[8],
               started: r[9] == null ? null : HH.iso(t + r[9]), finished: r[10] == null ? null : HH.iso(t + r[10]), genre: r[11], tags: r[12], owned: r[13],
               notes: i === 2 ? "Slow, warm and exactly what I needed. The ending made me cry on the train." : "", isbn: "", order: i + 1,
               added: HH.iso(t - 320 + i * 20), sample: true };
    });
    d.meta.sample = true; d.meta.onboarded = true; d.meta.nextId = id;
    D = d;
    save();
    go("home");
    HH.toast("Sample books loaded. Clear them any time.", null, 4000);
  }
  function clearSample() {
    var theme = D.settings.theme, next = D.meta.nextId, keep = D.books.filter(function (b) { return !b.sample; });
    D = blank(); D.settings.theme = theme; D.books = keep; D.meta.nextId = next;
    save();
    startWelcome();
  }

  // ── books ────────────────────────────────────────────────────────
  function openBook(b, from) {
    editingBook = b || null;
    bookReturn = from || "library";
    $("#bk-title-h").textContent = b ? "Change book" : "Add a book";
    $("#bk-title").value = b ? b.title : "";
    $("#bk-author").value = b ? b.author : "";
    $("#bk-series").value = b ? b.series : "";
    $("#bk-no").value = b && b.seriesNo !== null ? String(b.seriesNo) : "";
    $("#bk-format").value = b ? b.format : "";
    $("#bk-status").value = b ? b.status : "To read";
    $("#bk-rating").value = b && b.rating !== null ? String(b.rating) : "";
    $("#bk-pages").value = b && b.pages !== null ? String(b.pages) : "";
    $("#bk-read").value = b && b.read !== null ? String(b.read) : "";
    $("#bk-started").value = b && b.started ? b.started : "";
    $("#bk-finished").value = b && b.finished ? b.finished : "";
    $("#bk-genre").innerHTML = '<option value="">Not set</option>' + D.settings.genres.map(function (g) { return "<option>" + esc(g) + "</option>"; }).join("");
    $("#bk-genre").value = b && D.settings.genres.indexOf(b.genre) >= 0 ? b.genre : "";
    $("#bk-tags").value = b ? b.tags.join(", ") : "";
    $("#bk-owned").checked = b ? b.owned : false;
    $("#bk-isbn").value = b ? b.isbn : "";
    $("#bk-notes").value = b ? b.notes : "";
    $("#bk-err").hidden = true;
    $("#bk-delete").hidden = !b;
    go("book-edit");
    $("#bk-title").focus();
  }
  function saveBook(ev) {
    ev.preventDefault();
    var title = $("#bk-title").value.trim().slice(0, 200), author = $("#bk-author").value.trim().slice(0, 120);
    var no = $("#bk-no").value.trim(), pages = $("#bk-pages").value.trim(), read = $("#bk-read").value.trim();
    var started = $("#bk-started").value, finished = $("#bk-finished").value, status = $("#bk-status").value;
    var err = !title ? "Give the book a title." : (no && !(parseFloat(no) >= 0)) ? "The series number should be a number, such as 2." :
      (pages && !(parseInt(pages, 10) >= 0)) ? "Pages should be a whole number." : (read && !(parseInt(read, 10) >= 0)) ? "Pages read should be a whole number." :
      (started && !HH.parseIso(started)) ? "Pick a start date, or leave it blank." : (finished && !HH.parseIso(finished)) ? "Pick a finish date, or leave it blank." : "";
    if (err) { $("#bk-err").textContent = err; $("#bk-err").hidden = false; return; }
    var b = editingBook || newBook({});
    b.title = title; b.author = author; b.series = $("#bk-series").value.trim().slice(0, 80); b.seriesNo = no ? parseFloat(no) : null;
    b.format = $("#bk-format").value; b.status = status; b.rating = $("#bk-rating").value ? +$("#bk-rating").value : null;
    b.pages = pages ? parseInt(pages, 10) : null; b.read = read ? parseInt(read, 10) : null;
    b.started = started || null; b.finished = finished || null;
    if (status === "Finished" && !b.finished) b.finished = HH.iso(T);
    b.genre = $("#bk-genre").value; b.tags = splitTags($("#bk-tags").value); b.owned = $("#bk-owned").checked;
    b.isbn = cleanIsbn($("#bk-isbn").value); b.notes = $("#bk-notes").value.slice(0, 5000);
    if (!editingBook) D.books.push(b);
    save();
    go(bookReturn);
    HH.toast((editingBook ? "Changed " : "Added ") + title);
  }
  function deleteBook() {
    var b = editingBook, i = D.books.indexOf(b);
    if (i < 0) return;
    D.books.splice(i, 1);
    save();
    go(bookReturn);
    HH.toast("Removed " + b.title, function () { D.books.splice(i, 0, b); save(); render(); });
  }
  function quickAdd(ev) {
    ev.preventDefault();
    var title = $("#qa-title").value.trim().slice(0, 200), author = $("#qa-author").value.trim().slice(0, 120);
    if (!title) { $("#qa-title").focus(); return; }
    D.books.push(newBook({ title: title, author: author }));
    save();
    $("#qa-title").value = ""; $("#qa-author").value = "";
    render();
    HH.toast("Added " + title + " to your To read list");
  }
  function moveTbr(b, dir) {
    var list = tbrBooks(), i = list.indexOf(b), j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    list.forEach(function (x, k) { x.order = k + 1; });
    var o = list[i].order; list[i].order = list[j].order; list[j].order = o;
    save();
    renderTbr();
  }
  function pickNext() {
    var g = $("#tbr-genre").value, pool = tbrBooks().filter(function (b) { return !g || b.genre === g; });
    $("#tbr-pick").hidden = false;
    if (!pool.length) { $("#tbr-pick").textContent = g ? "Nothing in " + g + " on your list yet." : "Your To read list is empty."; return; }
    var b = pool[Math.floor(Math.random() * pool.length)];
    $("#tbr-pick").textContent = b.title + (b.author ? " by " + b.author : "");
  }

  // ── import ───────────────────────────────────────────────────────
  function onImportFile() {
    var f = $("#import-file").files[0];
    if (!f) return;
    HH.readFile(f, function (err, text) {
      $("#import-file").value = "";
      pendingImport = null;
      var r = err ? { error: "The file couldn't be read." } : readCsv(text);
      if (r.error) { $("#import-preview").innerHTML = '<p class="err" id="import-refused">' + esc(r.error) + " Nothing was changed.</p>"; return; }
      pendingImport = r;
      var pv = previewImport(r), src = r.kind === "goodreads" ? "Goodreads" : r.kind === "storygraph" ? "StoryGraph" : "this app";
      $("#import-preview").innerHTML = '<div class="banner" id="import-summary"><strong>' + plural(pv.total, "book", "books") + ", " + pv.fresh + " new" +
        (pv.matched ? ", " + pv.matched + " already in your library" : "") + "</strong>A " + src + " export. New books are added to your library; nothing is removed." +
        '<label class="check"><input id="import-update" type="checkbox"> Update matches: let the file change the status, rating and dates of books already in your library</label>' +
        '<div class="row-buttons"><button type="button" class="btn btn-primary" id="import-yes">Import</button><button type="button" class="btn btn-quiet" id="import-no">Cancel</button></div></div>';
      $("#import-yes").addEventListener("click", function () {
        var res = doImport(pendingImport, $("#import-update").checked);
        pendingImport = null;
        $("#import-preview").innerHTML = '<p class="small" id="import-done">Imported: ' + plural(res.added, "book", "books") + " added" + (res.updated ? ", " + res.updated + " updated" : "") + ".</p>";
        render();
        HH.toast(plural(res.added, "book", "books") + " added");
      });
      $("#import-no").addEventListener("click", function () { pendingImport = null; $("#import-preview").innerHTML = ""; });
    });
  }

  // ── settings, backup, restore ────────────────────────────────────
  function saveGoal() {
    var v = $("#s-goal").value.trim(), y = String(HH.ymd(T).y);
    if (v === "") { delete D.settings.goals[y]; }
    else { var n = parseInt(v, 10); if (!(n >= 1)) { $("#s-goal-err").hidden = false; return; } D.settings.goals[y] = n; }
    $("#s-goal-err").hidden = true;
    save(); renderHome();
  }
  function saveGenres() {
    var lines = $("#s-genres").value.split("\n").map(function (x) { return x.trim().slice(0, 40); }).filter(Boolean), seen = {}, out = [];
    lines.forEach(function (g) { if (!seen[g.toLowerCase()]) { seen[g.toLowerCase()] = 1; out.push(g); } });
    D.settings.genres = out.length ? out : DEFAULT_GENRES.slice();
    save(); render();
  }
  function backup() {
    T = HH.today();
    D.meta.lastBackup = HH.iso(T);
    D.meta.reminderDismissed = null;
    save();
    var name = "hollowayhart-books-backup-" + HH.iso(T) + ".json";
    var mode = HH.saveFile(name, JSON.stringify({ app: APP_ID, schema: SCHEMA, made: HH.iso(T), data: D }, null, 2));
    render();
    HH.toast(HH.savedMessage(mode, name), null, 6000);
  }
  function readBackup(text) {
    var o;
    try { o = JSON.parse(text); } catch (e) { return { error: "broken" }; }
    if (!o || typeof o !== "object" || o.app !== APP_ID || !o.data) return { error: "broken" };
    var r = migrate(o.data);
    if (r.data) r.made = HH.parseIso(o.made);
    return r;
  }
  function restoreMsg(html) { $("#restore-msg").innerHTML = html; }
  function onRestoreFile() {
    var f = $("#restore-file").files[0];
    if (!f) return;
    HH.readFile(f, function (err, text) {
      $("#restore-file").value = "";
      var r = err ? { error: "broken" } : readBackup(text);
      if (r.error === "newer") { restoreMsg('<p class="err" id="restore-refused">This backup was made by a newer version of the app, so this copy can\'t read it. Nothing was changed.</p>'); return; }
      if (r.error) { restoreMsg('<p class="err" id="restore-refused">This file isn\'t a backup from this app, or it is damaged. Nothing was changed.</p>'); return; }
      pendingRestore = r.data;
      restoreMsg('<div class="banner" id="restore-summary"><strong>This backup has</strong>' + plural(r.data.books.length, "book", "books") +
        (r.made != null ? " · made " + HH.fmtLong(r.made) : "") + '<p class="small" style="margin-top:6px">Restoring replaces everything in the app now.</p>' +
        '<div class="row-buttons"><button type="button" class="btn btn-primary" id="restore-yes">Replace with this backup</button>' +
        '<button type="button" class="btn btn-quiet" id="restore-no">Cancel</button></div></div>');
      $("#restore-yes").addEventListener("click", function () {
        D = pendingRestore; pendingRestore = null;
        save();
        restoreMsg("");
        if (!D.meta.onboarded) startWelcome(); else go("home");
        HH.toast("Backup restored.");
      });
      $("#restore-no").addEventListener("click", function () { pendingRestore = null; restoreMsg(""); });
    });
  }
  function startFresh() {
    HH.confirmStep({
      title: "Start fresh?", yes: "Next", no: "Keep my library",
      text: "This deletes every book, your goals and your genres from this browser. If you might want them again, cancel and use Back up now first.",
      onYes: function () {
        HH.confirmStep({
          title: "Delete everything now?", yes: "Yes, delete everything", no: "Cancel", danger: true, text: "This can't be undone without a backup.",
          onYes: function () { var theme = D.settings.theme; D = blank(); D.settings.theme = theme; save(); startWelcome(); HH.toast("Everything was deleted. Starting fresh."); }
        });
      }
    });
  }

  // ── wiring ───────────────────────────────────────────────────────
  function wire() {
    $$("[data-nav]").forEach(function (b) { b.addEventListener("click", function () { go(b.getAttribute("data-nav")); }); });
    $("#qa-form").addEventListener("submit", quickAdd);
    $("#add-book-btn").addEventListener("click", function () { openBook(null, "library"); });
    $("#bk-form").addEventListener("submit", saveBook);
    $("#bk-cancel").addEventListener("click", function () { go(bookReturn); });
    $("#bk-delete").addEventListener("click", deleteBook);
    ["#lf-status", "#lf-genre", "#lf-rating", "#lf-year", "#lf-sort"].forEach(function (id) {
      $(id).addEventListener("change", function () { filt[id.slice(4)] = $(id).value; renderLibrary(); });
    });
    $("#lf-q").addEventListener("input", function () { filt.q = $("#lf-q").value; var list = filtered();
      $("#lib-list").innerHTML = list.map(function (b) { return bookRow(b); }).join(""); $("#lib-none").hidden = list.length > 0;
      $("#lib-count").textContent = plural(list.length, "book", "books") + (list.length !== D.books.length ? " of " + D.books.length : ""); });
    $("#lf-clear").addEventListener("click", function () { filt = { q: "", status: "", genre: "", rating: "", year: "", sort: "title" }; renderLibrary(); });
    $("#tbr-pick-btn").addEventListener("click", pickNext);
    $("#st-year").addEventListener("change", function () { statsYear = +$("#st-year").value; renderStats(); });
    $("#import-file").addEventListener("change", onImportFile);
    $("#export-btn").addEventListener("click", exportCsv);
    document.addEventListener("click", function (ev) {
      var t = ev.target.closest ? ev.target.closest("[data-edit-book],[data-tbr-up],[data-tbr-down],[data-clear-sample],[data-backup],[data-dismiss-backup]") : null;
      if (!t) return;
      if (t.hasAttribute("data-edit-book")) {
        var screen = $$("[data-screen]").filter(function (s) { return !s.hidden; })[0];
        openBook(byId(+t.getAttribute("data-edit-book")), screen ? screen.getAttribute("data-screen") : "library");
      } else if (t.hasAttribute("data-tbr-up")) moveTbr(byId(+t.getAttribute("data-tbr-up")), -1);
      else if (t.hasAttribute("data-tbr-down")) moveTbr(byId(+t.getAttribute("data-tbr-down")), 1);
      else if (t.hasAttribute("data-clear-sample")) clearSample();
      else if (t.hasAttribute("data-backup")) backup();
      else if (t.hasAttribute("data-dismiss-backup")) { D.meta.reminderDismissed = HH.iso(T); save(); renderBanners(); }
    });
    $("#s-goal").addEventListener("change", saveGoal);
    $("#s-goal-form").addEventListener("submit", function (ev) { ev.preventDefault(); saveGoal(); });
    $("#s-genres").addEventListener("change", saveGenres);
    $$('input[name="theme"]').forEach(function (r) { r.addEventListener("change", function () { D.settings.theme = r.value; save(); HH.applyTheme(r.value); }); });
    $("#backup-btn").addEventListener("click", backup);
    $("#restore-file").addEventListener("change", onRestoreFile);
    $("#sample-btn").addEventListener("click", function () {
      if (D.meta.sample) { clearSample(); return; }
      if (hasOwn()) { $("#sample-state").textContent = "Sample books only load into an empty app. Back up, then Start fresh, if you want to look at them."; return; }
      loadSample();
    });
    $("#fresh-btn").addEventListener("click", startFresh);
    $("#help-btn").addEventListener("click", function () { go("help"); });
    $("#help-back").addEventListener("click", function () { go("settings"); });
    // first run
    $("#w-form1").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var v = $("#w-goal").value.trim();
      if (v) { var n = parseInt(v, 10); if (!(n >= 1)) { $("#w-err1").hidden = false; return; } D.settings.goals[String(HH.ymd(T).y)] = n; save(); }
      $("#w-err1").hidden = true;
      welcomeStep(2);
    });
    $("#w-goal-skip").addEventListener("click", function () { welcomeStep(2); });
    $("#w-sample").addEventListener("click", loadSample);
    $("#w-add").addEventListener("click", function () { D.meta.onboarded = true; save(); openBook(null, "library"); });
    $("#w-import").addEventListener("click", function () { D.meta.onboarded = true; save(); go("import"); });
    $("#w-skip2").addEventListener("click", function () { welcomeStep(3); });
    $("#w-finish").addEventListener("click", function () { D.meta.onboarded = true; save(); go("home"); });
    document.addEventListener("visibilitychange", function () { if (!document.hidden && D.meta.onboarded) render(); });
  }

  // ── start ────────────────────────────────────────────────────────
  function start() {
    var raw = store.read();
    if (raw) {
      var r = migrate(raw);
      if (r.data) D = r.data;
      else { try { window.localStorage.setItem("hh74_unreadable_" + HH.iso(HH.today()), JSON.stringify(raw)); } catch (e) { /* nothing more to do */ } D = blank(); }
    } else D = blank();
    wire();
    if (D.meta.onboarded) go("home"); else startWelcome();
  }

  // for the QA runner (qa/app_qa74.py)
  window.HH74 = { challenge: challenge, stats: stats, seriesList: seriesList, parseCsv: parseCsv, readCsv: readCsv, previewImport: previewImport,
    halfUp: halfUp, migrate: migrate, SCHEMA: SCHEMA, APP_ID: APP_ID, data: function () { return D; } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
