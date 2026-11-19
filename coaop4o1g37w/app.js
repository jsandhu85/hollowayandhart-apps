window.HH_BUILD = {"id": "139", "version": "18Nov2026.7", "hosted": true};
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
  // ── big figures (19 Nov 2026, Cowork's real-phone test of 137: the 'You're set' card showed 'AU$4,400.0' and '0' on the next
  // line). A .hero-num stays on one line (core.css) and its font steps down here until the figure fits its card: when its text
  // changes (MutationObserver), when it first shows or the screen turns (ResizeObserver, width changes only, in the next frame so
  // the observer never loops). HH.hero(el, "AU$12.00 over") puts the words after a figure on their own line beneath it.
  var FIT_MIN = 16;
  function fitHero(el) {
    var w = el.clientWidth;
    if (!w) return;                          // hidden: fitted when it shows
    el.style.fontSize = "";
    var size = parseFloat(window.getComputedStyle(el).fontSize) || 0;
    for (var i = 0; i < 8 && el.scrollWidth > w && size > FIT_MIN; i++) {
      size = Math.max(FIT_MIN, Math.floor(size * (w - 2) / el.scrollWidth * 10) / 10);
      el.style.fontSize = size + "px";
    }
  }
  function hero(el, text) {
    var t = String(text == null ? "" : text), m = /^(\S*\d\S*) (.+)$/.exec(t);
    if (!m) { el.textContent = t; return; }
    el.innerHTML = esc(m[1]) + '<span class="hero-words"> ' + esc(m[2]) + "</span>";
  }
  function watchHeroes() {
    var els = $$(".hero-num");
    if (!els.length) return;
    if (window.MutationObserver) {
      var mo = new MutationObserver(function (recs) {
        var todo = [];
        recs.forEach(function (r) {
          var n = r.target.nodeType === 1 ? r.target : r.target.parentNode, el = n && n.closest ? n.closest(".hero-num") : null;
          if (el && todo.indexOf(el) < 0) todo.push(el);
        });
        todo.forEach(fitHero);
      });
      els.forEach(function (el) { mo.observe(el, { childList: true, characterData: true, subtree: true }); });
    }
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(function (entries) {
        var todo = [];
        entries.forEach(function (en) {
          var w = Math.round(en.contentRect.width);
          if (w !== en.target.hhFitW) { en.target.hhFitW = w; todo.push(en.target); }
        });
        if (todo.length) window.requestAnimationFrame(function () { todo.forEach(fitHero); });
      });
      els.forEach(function (el) { ro.observe(el); });
    } else {
      window.addEventListener("resize", function () { els.forEach(fitHero); });
    }
    els.forEach(fitHero);
  }

  // ── a date the app needs (19 Nov 2026, Cowork's real-phone test of 137: the date picker's Reset button emptied the box and the form
  // said 'Day: ?'). A date box marked data-keep is never left empty: it goes back to the day the form opened with (HH.setDate),
  // or today when it opened empty, kept inside the box's min and max. On a phone or tablet that happens the moment it empties
  // (Reset / Clear in the picker), before the app's own change handler reads it; on a computer when the box loses focus, so typing
  // a date part by part is never fought. Optional dates (no data-keep) can still be cleared.
  function setDate(el, text) {
    el.value = text || "";
    el.setAttribute("data-open", el.value);
  }
  function keepDate(el) {
    // the attribute, not el.type: a browser with no date picker reports type 'text' for the same box
    if (!el || !el.getAttribute || el.getAttribute("type") !== "date" || !el.hasAttribute("data-keep") || el.value !== "") return false;
    var v = el.getAttribute("data-open") || iso(today());
    if (el.min && v < el.min) v = el.min;
    if (el.max && v > el.max) v = el.max;
    el.value = v;
    return el.value !== "";
  }
  function watchDates() {
    var now = function (e) { if (mobile()) keepDate(e.target); };
    document.addEventListener("input", now, true);
    document.addEventListener("change", now, true);
    document.addEventListener("focusout", function (e) {
      if (keepDate(e.target)) e.target.dispatchEvent(new Event("change", { bubbles: true }));
    }, true);
  }

  function boot() { showVersion(); installCard(); startWorker(); watchHeroes(); }
  watchDates();
  if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", boot); } else { boot(); }

  return {
    dn: dn, ymd: ymd, today: today, iso: iso, parseIso: parseIso, lastDay: lastDay, addMonths: addMonths,
    monthsBetween: monthsBetween, weekday: weekday, fmtDate: fmtDate, fmtShort: fmtShort, fmtLong: fmtLong, mod: mod,
    parseMoney: parseMoney, money: money, plain: plain, esc: esc, $: $, $$: $$, Store: Store, download: download,
    readFile: readFile, toast: toast, confirmStep: confirmStep, show: show, applyTheme: applyTheme,
    build: BUILD, standalone: standalone, persist: persist, saveFile: saveFile, savedMessage: savedMessage,
    hero: hero, fitHero: fitHero, setDate: setDate, keepDate: keepDate
  };
})();

/* Product 139: Reseller Inventory & Profit App (specs/business/139-reseller-inventory-profit-app.yaml), 18 Nov 2026.
   Items in, listed and sold; platform fee presets (example rates the buyer changes); profit per item, per month and per year;
   ageing stock; mileage; a CSV of every item. Money is integer cents; fee rates are hundredths of a percent (13.25% = 1325);
   mileage rates are thousandths of the currency unit (0.85 = 850); distances are tenths (24.6 km = 246); dates are day numbers
   from HH (apps/core.js). Rounding is half-up, in whole integers only. */
(function () {
  "use strict";
  var SCHEMA = 1;
  var APP_ID = "hollowayhart-reseller-inventory";
  var STATUSES = ["stock", "listed", "sold"];
  var STATUS_TEXT = { stock: "In stock", listed: "Listed", sold: "Sold" };
  var UNITS = ["km", "mi"];
  var CURRENCIES = ["$", "AU$", "US$", "£", "€"];
  // example rates only (the app says so everywhere they show): name, % (hundredths), fixed fee (cents), the % includes shipping
  var DEFAULT_PLATFORMS = [["eBay", 1325, 30, true], ["Poshmark", 2000, 0, false], ["Mercari", 1000, 50, false], ["Etsy", 950, 45, true],
                           ["Depop", 330, 45, true], ["Facebook", 1000, 0, true], ["In person", 0, 0, false]];
  var AGE_GROUPS = [{ key: "0-30", label: "0–30 days", hi: 30 }, { key: "31-90", label: "31–90 days", hi: 90 }, { key: "91+", label: "Over 90 days", hi: Infinity }];
  var REMIND_DAYS = 30;
  var MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var $ = HH.$, $$ = HH.$$, esc = HH.esc;
  var store = new HH.Store("hh139_");
  var D = null;
  var T = HH.today();
  var editingItem = null, itemReturn = "items", feeTouched = false, editingTrip = null, editingPlat = null, platReturn = "settings";
  var pendingRestore = null, filter = "all", search = "", sellSearch = "", profitYear = null, monthYm = null, mileYm = null;

  // ── data ──────────────────────────────────────────────────────────
  function defaultPlatforms(firstId) {
    return DEFAULT_PLATFORMS.map(function (r, i) { return { id: firstId + i, name: r[0], rateBp: r[1], fixedCents: r[2], onShip: r[3] }; });
  }
  function blank() {
    return {
      schema: SCHEMA,
      settings: { currency: "$", unit: "km", rateMills: 0, theme: "auto" },
      platforms: defaultPlatforms(1), items: [], trips: [],
      meta: { created: HH.iso(HH.today()), lastBackup: null, reminderDismissed: null, sample: false, onboarded: false, nextId: DEFAULT_PLATFORMS.length + 1 }
    };
  }
  function isInt(x) { return typeof x === "number" && isFinite(x) && Math.floor(x) === x; }
  function isCents(x) { return isInt(x) && x >= 0; }
  function isDate(s) { return HH.parseIso(s) != null; }
  function isName(s, n) { return typeof s === "string" && s.length > 0 && s.length <= n; }
  function isText(s, n) { return typeof s === "string" && s.length <= n; }
  function validItem(x) {
    if (!isInt(x.id) || !isName(x.name, 60) || !isText(x.notes, 200) || !isCents(x.costCents) || !isDate(x.bought)) return false;
    if (STATUSES.indexOf(x.status) < 0 || !isText(x.platform, 30) || typeof x.feeAuto !== "boolean") return false;
    if (!(x.listed === null || isDate(x.listed)) || !(x.listCents === null || isCents(x.listCents))) return false;
    if (x.status === "listed" && x.listed === null) return false;
    if (x.status === "sold") {
      if (!isDate(x.sold) || !isCents(x.saleCents) || !isCents(x.shipInCents) || !isCents(x.shipOutCents) || !isCents(x.feeCents)) return false;
    } else if (x.sold !== null || x.saleCents !== null || x.feeCents !== null) return false;
    return true;
  }
  function validate(d) {
    try {
      var s = d.settings, m = d.meta, i, x;
      if (d.schema !== SCHEMA || !s || !m) return false;
      if (!Array.isArray(d.platforms) || !Array.isArray(d.items) || !Array.isArray(d.trips)) return false;
      if (!isName(s.currency, 4) || /[<>&"']/.test(s.currency) || UNITS.indexOf(s.unit) < 0 || !isCents(s.rateMills) || ["auto", "light", "dark"].indexOf(s.theme) < 0) return false;
      if (!isDate(m.created) || !(m.lastBackup === null || isDate(m.lastBackup))) return false;
      if (!(m.reminderDismissed === null || isDate(m.reminderDismissed))) return false;
      if (typeof m.sample !== "boolean" || typeof m.onboarded !== "boolean" || !isInt(m.nextId)) return false;
      for (i = 0; i < d.platforms.length; i++) {
        x = d.platforms[i];
        if (!isInt(x.id) || !isName(x.name, 30) || !isInt(x.rateBp) || x.rateBp < 0 || x.rateBp > 10000 || !isCents(x.fixedCents) || typeof x.onShip !== "boolean") return false;
      }
      for (i = 0; i < d.items.length; i++) if (!validItem(d.items[i])) return false;
      for (i = 0; i < d.trips.length; i++) {
        x = d.trips[i];
        if (!isInt(x.id) || !isDate(x.date) || !isInt(x.tenths) || x.tenths <= 0 || !isCents(x.rateMills) || !isText(x.note, 60)) return false;
      }
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
  function own(list) { return list.some(function (x) { return !x.sample; }); }
  function hasOwn() { return own(D.items) || own(D.trips); }
  function byId(list, id) { return list.filter(function (x) { return x.id === id; })[0]; }
  function platByName(name) {
    var k = String(name || "").toLowerCase();
    return D.platforms.filter(function (p) { return p.name.toLowerCase() === k; })[0] || null;
  }

  // ── the maths (spec 139 'maths', integer cents, half-up) ─────────
  function feeFor(plat, saleCents, shipInCents) {
    if (!plat) return 0;
    var base = saleCents + (plat.onShip ? shipInCents : 0);
    return Math.floor((base * plat.rateBp * 2 + 10000) / 20000) + plat.fixedCents;
  }
  function profitOf(it) { return it.saleCents + it.shipInCents - it.feeCents - it.shipOutCents - it.costCents; }
  function tripCents(t) { return Math.floor((t.tenths * t.rateMills * 2 + 100) / 200); }
  function stats(first, last) {
    var r = { sold: 0, sales: 0, fees: 0, shipOut: 0, cost: 0, profit: 0, tenths: 0, mileage: 0, items: [], trips: [] };
    D.items.forEach(function (it) {
      if (it.status !== "sold") return;
      var d = HH.parseIso(it.sold);
      if (d < first || d > last) return;
      r.sold++; r.sales += it.saleCents + it.shipInCents; r.fees += it.feeCents; r.shipOut += it.shipOutCents; r.cost += it.costCents;
      r.profit += profitOf(it); r.items.push(it);
    });
    D.trips.forEach(function (t) {
      var d = HH.parseIso(t.date);
      if (d < first || d > last) return;
      r.tenths += t.tenths; r.mileage += tripCents(t); r.trips.push(t);
    });
    r.after = r.profit - r.mileage;
    r.items.sort(function (a, b) { return HH.parseIso(b.sold) - HH.parseIso(a.sold) || b.id - a.id; });
    r.trips.sort(function (a, b) { return HH.parseIso(b.date) - HH.parseIso(a.date) || b.id - a.id; });
    return r;
  }
  function monthStats(ym) { var g = ymRange(ym); return stats(g.first, g.last); }
  function yearStats(y) { return stats(HH.dn(y, 1, 1), HH.dn(y, 12, 31)); }
  function ageing(t) {
    var groups = AGE_GROUPS.map(function (g) { return { key: g.key, label: g.label, n: 0, cost: 0, asking: 0 }; });
    var listed = [], stock = { n: 0, cost: 0, oldest: null }, atCost = 0, asking = 0;
    D.items.forEach(function (it) {
      if (it.status === "sold") return;
      atCost += it.costCents;
      if (it.status === "stock") {
        var bd = t - HH.parseIso(it.bought);
        stock.n++; stock.cost += it.costCents;
        if (stock.oldest === null || bd > stock.oldest) stock.oldest = bd;
        return;
      }
      var days = Math.max(0, t - HH.parseIso(it.listed)), gi = days <= 30 ? 0 : days <= 90 ? 1 : 2;
      groups[gi].n++; groups[gi].cost += it.costCents; groups[gi].asking += it.listCents || 0;
      asking += it.listCents || 0;
      listed.push({ it: it, days: days });
    });
    listed.sort(function (a, b) { return b.days - a.days || a.it.id - b.it.id; });
    return { groups: groups, listed: listed, stock: stock, atCost: atCost, asking: asking };
  }

  // ── months ───────────────────────────────────────────────────────
  function ymOf(dayNo) { var a = HH.ymd(dayNo); return a.y + "-" + (a.m < 10 ? "0" : "") + a.m; }
  function ymParts(ym) { return { y: +ym.slice(0, 4), m: +ym.slice(5, 7) }; }
  function ymLabel(ym) { var a = ymParts(ym); return MO[a.m - 1] + " " + a.y; }
  function ymRange(ym) { var a = ymParts(ym); return { first: HH.dn(a.y, a.m, 1), last: HH.dn(a.y, a.m, HH.lastDay(a.y, a.m)) }; }
  function years() {
    var seen = {};
    seen[HH.ymd(T).y] = 1;
    D.items.forEach(function (it) { if (it.status === "sold") seen[HH.ymd(HH.parseIso(it.sold)).y] = 1; });
    D.trips.forEach(function (t) { seen[HH.ymd(HH.parseIso(t.date)).y] = 1; });
    return Object.keys(seen).map(Number).sort(function (a, b) { return b - a; });
  }
  function tripMonths() {
    var seen = {};
    seen[ymOf(T)] = 1;
    D.trips.forEach(function (t) { seen[ymOf(HH.parseIso(t.date))] = 1; });
    return Object.keys(seen).sort().reverse();
  }

  // ── wording helpers ──────────────────────────────────────────────
  function m(c) { return HH.money(c, D.settings.currency); }
  function pm(c) { return c < 0 ? m(-c) + " loss" : m(c); }       // a profit: a loss is said calmly, in words
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
  function pct(bp) { return (bp / 100).toFixed(2).replace(/\.?0+$/, "") + "%"; }
  function unitWord() { return D.settings.unit === "mi" ? "mile" : "km"; }
  function unitShort() { return D.settings.unit === "mi" ? "mi" : "km"; }
  function dist(tenths) {
    var w = String(Math.floor(tenths / 10)).replace(/\B(?=(\d{3})+(?!\d))/g, ","), f = tenths % 10;
    return w + (f ? "." + f : "") + " " + unitShort();
  }
  function rateText(mills) {
    var w = Math.floor(mills / 1000), r = mills % 1000, s = r % 10 ? String(1000 + r).slice(1) : String(100 + r / 10).slice(1);
    return D.settings.currency + w + "." + s;
  }
  function rateInput(mills) { var t = rateText(mills); return t.slice(D.settings.currency.length); }
  function num(c) { return (c < 0 ? "-" : "") + HH.plain(c); }      // a plain number for the CSV and the inputs
  function dayText(n) { return HH.fmtDate(n, HH.ymd(n).y !== HH.ymd(T).y); }
  function daysText(k) { return k === 0 ? "today" : plural(k, "day", "days"); }
  function parseRate(s) {                      // a % with up to 2 decimals → hundredths of a percent
    s = String(s == null ? "" : s).replace(/[\s%,]/g, "");
    if (!/^(\d+(\.\d{0,2})?|\.\d{1,2})$/.test(s)) return null;
    var p = s.split(".");
    return parseInt(p[0] || "0", 10) * 100 + (p[1] ? parseInt((p[1] + "0").slice(0, 2), 10) : 0);
  }
  function parseMills(s) {                     // a money rate with up to 3 decimals → thousandths
    s = String(s == null ? "" : s).replace(/[\s,]/g, "").replace(/^[^\d.]+/, "");
    if (s === "") return 0;
    if (!/^(\d+(\.\d{0,3})?|\.\d{1,3})$/.test(s)) return null;
    var p = s.split(".");
    return parseInt(p[0] || "0", 10) * 1000 + (p[1] ? parseInt((p[1] + "00").slice(0, 3), 10) : 0);
  }
  function parseTenths(s) {                    // a distance with up to 1 decimal → tenths
    s = String(s == null ? "" : s).replace(/[\s,]/g, "");
    if (!/^(\d+(\.\d?)?|\.\d)$/.test(s)) return null;
    var p = s.split(".");
    return parseInt(p[0] || "0", 10) * 10 + (p[1] ? parseInt(p[1], 10) : 0);
  }
  function money0(s) { return String(s).trim() === "" ? 0 : HH.parseMoney(s); }
  function blocks(frac) {
    var on = Math.max(0, Math.min(20, Math.round(frac * 20))), h = '<span class="blocks" aria-hidden="true">';
    for (var i = 0; i < 20; i++) h += '<i class="' + (i < on ? "on" : "") + '"></i>';
    return h + "</span>";
  }
  function feeSum(plat, sale, shipIn) {
    if (!plat) return "No platform picked, so no fee is worked out.";
    var base = sale + (plat.onShip ? shipIn : 0);
    return pct(plat.rateBp) + " of " + m(base) + (plat.onShip && shipIn ? " (sale + shipping charged)" : "") + " + " + m(plat.fixedCents) +
      " = " + m(feeFor(plat, sale, shipIn));
  }

  // ── rendering ────────────────────────────────────────────────────
  function render() {
    T = HH.today();
    HH.applyTheme(D.settings.theme);
    renderBanners();
    renderHome();
    renderItems();
    renderAgeing();
    renderProfit();
    renderMileage();
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
      h += '<div class="banner slim" id="sample-banner"><span><span class="sample-flag">SAMPLE</span> · made-up items</span>' +
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
  function saleRow(it) {
    return '<li data-item="' + it.id + '"><button type="button" class="rowbtn" data-edit-item="' + it.id + '" aria-label="Change ' + esc(it.name) +
      '"><span class="what"><b>' + esc(it.name) + '</b><br><span class="small muted">Sold ' + dayText(HH.parseIso(it.sold)) +
      (it.platform ? " · " + esc(it.platform) : "") + " · " + m(it.saleCents) + '</span></span><span class="amt"><span class="amt-cap">profit</span>' +
      pm(profitOf(it)) + '</span><span class="chev" aria-hidden="true">›</span></button></li>';
  }
  function renderHome() {
    var ym = ymOf(T), ms = monthStats(ym), a = ageing(T);
    HH.hero($("#hero-profit"), pm(ms.profit));
    $("#hero-cap").textContent = ms.sold ? ymLabel(ym) + " · " + plural(ms.sold, "item", "items") + " sold · sales " + m(ms.sales) + " · fees " + m(ms.fees)
      : "No sales yet in " + ymLabel(ym);
    $("#st-stock").textContent = String(a.stock.n);
    var nListed = a.listed.length;
    $("#st-listed").textContent = nListed + " · " + m(a.asking) + " asking";
    $("#st-atcost").textContent = m(a.atCost);
    $("#st-old").textContent = String(a.groups[2].n);
    var counts = countByStatus();
    $("#hc-items-line").textContent = D.items.length ? counts.stock + " in stock · " + counts.listed + " listed · " + counts.sold + " sold" : "Nothing added yet";
    $("#hc-ageing-list").innerHTML = a.groups.map(function (g) {
      return "<li><span>" + esc(g.label) + "</span><b>" + g.n + "</b></li>";
    }).join("");
    var y = HH.ymd(T).y, ys = yearStats(y);
    $("#hc-year-head").textContent = "Profit in " + y;
    $("#hc-year-line").textContent = pm(ys.profit) + " from " + plural(ys.sold, "item", "items") + " sold";
    $("#hc-miles-line").textContent = "This month " + dist(ms.tenths) + " · " + m(ms.mileage);
    var recent = D.items.filter(function (it) { return it.status === "sold"; })
      .sort(function (p, q) { return HH.parseIso(q.sold) - HH.parseIso(p.sold) || q.id - p.id; }).slice(0, 3);
    $("#recent-list").innerHTML = recent.map(saleRow).join("");
    $("#recent-none").hidden = recent.length > 0;
  }
  function countByStatus() {
    var c = { all: D.items.length, stock: 0, listed: 0, sold: 0 };
    D.items.forEach(function (it) { c[it.status]++; });
    return c;
  }
  function lastDate(it) { return HH.parseIso(it.status === "sold" ? it.sold : it.status === "listed" ? it.listed : it.bought); }
  function matches(it, q) {
    if (!q) return true;
    q = q.toLowerCase();
    return it.name.toLowerCase().indexOf(q) >= 0 || it.notes.toLowerCase().indexOf(q) >= 0;
  }
  function itemLine(it) {
    if (it.status === "sold") return "Sold " + dayText(HH.parseIso(it.sold)) + (it.platform ? " · " + esc(it.platform) : "") + " · " + m(it.saleCents) +
      " · fees " + m(it.feeCents);
    if (it.status === "listed") {
      var d = HH.parseIso(it.listed);
      return "Listed " + dayText(d) + (it.platform ? " · " + esc(it.platform) : "") + " · " + daysText(Math.max(0, T - d)) + " · cost " + m(it.costCents);
    }
    return "Bought " + dayText(HH.parseIso(it.bought)) + " · not listed yet";
  }
  function itemAmt(it) {
    if (it.status === "sold") return '<span class="amt-cap">profit</span>' + pm(profitOf(it));
    if (it.status === "listed") return '<span class="amt-cap">asking</span>' + (it.listCents == null ? "—" : m(it.listCents));
    return '<span class="amt-cap">cost</span>' + m(it.costCents);
  }
  function itemRow(it, opts) {
    opts = opts || {};
    var sellBtn = it.status !== "sold" && !opts.noSell;
    return '<li data-item="' + it.id + '" data-status="' + it.status + '"><button type="button" class="rowbtn" ' + (opts.sell ? 'data-sell-item="' : 'data-edit-item="') +
      it.id + '" aria-label="' + (opts.sell ? "Record the sale of " : "Change ") + esc(it.name) + '"><span class="what"><b>' + esc(it.name) +
      '</b><br><span class="small muted">' + (opts.line || itemLine(it)) + "</span>" + (opts.line ? "" : '<br><span class="tag' + (it.status === "sold" ? " done" : "") + '">' +
      STATUS_TEXT[it.status] + "</span>") + '</span><span class="amt">' + itemAmt(it) + '</span><span class="chev" aria-hidden="true">›</span></button>' +
      (sellBtn ? '<div class="row-buttons rowsub"><button type="button" class="btn btn-quiet" data-sell-item="' + it.id + '">Mark as sold</button></div>' : "") + "</li>";
  }
  function renderItems() {
    var c = countByStatus();
    ["all", "stock", "listed", "sold"].forEach(function (k) { $("#cnt-" + k).textContent = "(" + c[k] + ")"; });
    $$('input[name="flt"]').forEach(function (r) { r.checked = r.value === filter; });
    var list = D.items.filter(function (it) { return (filter === "all" || it.status === filter) && matches(it, search); })
      .sort(function (p, q) { return lastDate(q) - lastDate(p) || q.id - p.id; });
    $("#item-list").innerHTML = list.map(function (it) { return itemRow(it); }).join("");
    $("#item-none").textContent = D.items.length ? "Nothing matches. Try All, or clear the search." : "No items yet. Tap + Add an item.";
    $("#item-none").hidden = list.length > 0;
    $("#export-btn").disabled = D.items.length === 0;
  }
  function renderSell() {
    var a = ageing(T), stock = D.items.filter(function (it) { return it.status === "stock"; })
      .sort(function (p, q) { return HH.parseIso(p.bought) - HH.parseIso(q.bought) || p.id - q.id; });
    var list = a.listed.map(function (x) { return x.it; }).concat(stock).filter(function (it) { return matches(it, sellSearch); });
    $("#sell-list").innerHTML = list.map(function (it) { return itemRow(it, { sell: true, noSell: true }); }).join("");
    $("#sell-none").hidden = list.length > 0;
  }
  function renderAgeing() {
    var a = ageing(T);
    $("#ag-groups").innerHTML = a.groups.map(function (g) {
      return '<li data-group="' + g.key + '"><span class="what"><b>' + esc(g.label) + '</b><br><span class="small muted">' + m(g.cost) + " at cost · " +
        m(g.asking) + ' asking</span></span><span class="amt">' + plural(g.n, "item", "items") + "</span></li>";
    }).join("");
    $("#ag-unlisted").textContent = plural(a.stock.n, "item", "items") + " · " + m(a.stock.cost) + " at cost";
    $("#ag-unlisted-note").textContent = a.stock.n ? "The oldest was bought " + daysText(a.stock.oldest) + (a.stock.oldest ? " ago" : "") + "." : "Everything you have is listed.";
    $("#ag-list").innerHTML = a.listed.map(function (x) {
      var it = x.it;
      return itemRow(it, { line: (it.platform ? esc(it.platform) + " · " : "") + "listed " + dayText(HH.parseIso(it.listed)) + " · <b>" + daysText(x.days) + "</b>" });
    }).join("");
    $("#ag-none").hidden = a.listed.length > 0;
  }
  function statsInto(prefix, s) {
    HH.hero($("#" + prefix + "-profit"), pm(s.profit));
    $("#" + prefix + "-sold").textContent = String(s.sold);
    $("#" + prefix + "-sales").textContent = m(s.sales);
    $("#" + prefix + "-fees").textContent = m(s.fees);
    $("#" + prefix + "-shipout").textContent = m(s.shipOut);
    $("#" + prefix + "-cost").textContent = m(s.cost);
    $("#" + prefix + "-miles").textContent = dist(s.tenths) + " · " + m(s.mileage);
    $("#" + prefix + "-after").textContent = pm(s.after);
  }
  function renderProfit() {
    var ys = years();
    if (profitYear == null || ys.indexOf(profitYear) < 0) profitYear = HH.ymd(T).y;
    $("#pr-year").innerHTML = ys.map(function (y) { return '<option value="' + y + '"' + (y === profitYear ? " selected" : "") + ">" + y + "</option>"; }).join("");
    var s = yearStats(profitYear);
    $("#yr-label").textContent = "Profit in " + profitYear;
    statsInto("yr", s);
    var now = HH.ymd(T), lastM = profitYear === now.y ? now.m : profitYear < now.y ? 12 : 0, rows = [], best = 0;
    for (var k = lastM; k >= 1; k--) {
      var ym = profitYear + "-" + (k < 10 ? "0" : "") + k, ms = monthStats(ym);
      rows.push({ ym: ym, s: ms });
      if (ms.profit > best) best = ms.profit;
    }
    $("#months-head").textContent = "By month in " + profitYear;
    $("#month-list").innerHTML = rows.map(function (r) {
      var s2 = r.s, empty = !s2.sold && !s2.trips.length;
      return '<li data-ym="' + r.ym + '"><button type="button" class="rowbtn" data-month="' + r.ym + '" aria-label="Open ' + ymLabel(r.ym) +
        '"><span class="what"><b>' + ymLabel(r.ym) + '</b><br><span class="small muted">' + (empty ? "Nothing sold" :
          plural(s2.sold, "item", "items") + " sold · sales " + m(s2.sales) + " · fees " + m(s2.fees) + (s2.trips.length ? " · mileage " + m(s2.mileage) : "")) +
        "</span>" + (empty ? "" : "<br>" + blocks(best > 0 ? Math.max(0, s2.profit) / best : 0)) + '</span><span class="amt">' + pm(s2.profit) +
        '</span><span class="chev" aria-hidden="true">›</span></button></li>';
    }).join("");
  }
  function renderMonth() {
    if (!monthYm) monthYm = ymOf(T);
    var s = monthStats(monthYm);
    $("#mo-title").textContent = ymLabel(monthYm);
    statsInto("mo", s);
    $("#mo-items").innerHTML = s.items.map(saleRow).join("");
    $("#mo-items-none").hidden = s.items.length > 0;
    $("#mo-trips").innerHTML = s.trips.map(tripRow).join("");
    $("#mo-trips-none").hidden = s.trips.length > 0;
  }
  function tripRow(t) {
    return '<li data-trip="' + t.id + '"><button type="button" class="rowbtn" data-edit-trip="' + t.id + '" aria-label="Change the trip on ' +
      HH.fmtDate(HH.parseIso(t.date), true) + '"><span class="what"><b>' + (t.note ? esc(t.note) : '<span class="muted">Trip</span>') +
      '</b><br><span class="small muted">' + dayText(HH.parseIso(t.date)) + " · " + dist(t.tenths) + " at " + rateText(t.rateMills) + " a " + unitWord() +
      '</span></span><span class="amt">' + m(tripCents(t)) + '</span><span class="chev" aria-hidden="true">›</span></button></li>';
  }
  function renderMileage() {
    var months = tripMonths();
    if (!mileYm || months.indexOf(mileYm) < 0) mileYm = ymOf(T);
    $("#mi-month").innerHTML = months.map(function (ym) { return '<option value="' + ym + '"' + (ym === mileYm ? " selected" : "") + ">" + ymLabel(ym) + "</option>"; }).join("");
    var s = monthStats(mileYm), y = ymParts(mileYm).y, ys = yearStats(y);
    $("#mi-dist").textContent = dist(s.tenths);
    $("#mi-amount").textContent = m(s.mileage);
    $("#mi-year-label").textContent = "All of " + y;
    $("#mi-year").textContent = dist(ys.tenths) + " · " + m(ys.mileage);
    $("#trip-list").innerHTML = s.trips.map(tripRow).join("");
    $("#trip-none").hidden = s.trips.length > 0;
    $("#mi-rate-line").textContent = D.settings.rateMills ? "Your rate for new trips: " + rateText(D.settings.rateMills) + " a " + unitWord() + ". Change it in Settings."
      : "Your mileage rate is 0 for now: set it in Settings and new trips use it. Check the current rate where you live.";
  }
  function curChips(box, name) {
    var cur = D.settings.currency, other = CURRENCIES.indexOf(cur) < 0;
    $(box).innerHTML = CURRENCIES.map(function (c) {
      return '<label class="chip"><input type="radio" name="' + name + '" value="' + esc(c) + '"' + (c === cur ? " checked" : "") + "><span>" + esc(c) + "</span></label>";
    }).join("") + '<label class="chip"><input type="radio" name="' + name + '" value="other"' + (other ? " checked" : "") + "><span>Your own</span></label>";
  }
  function platRow(p) {
    return '<li data-plat="' + p.id + '"><button type="button" class="rowbtn" data-edit-plat="' + p.id + '" aria-label="Change ' + esc(p.name) +
      '"><span class="what"><b>' + esc(p.name) + '</b><br><span class="small muted">' + pct(p.rateBp) + " of the sale" + (p.onShip ? " and shipping charged" : "") +
      " + " + m(p.fixedCents) + ' an order</span></span><span class="chev" aria-hidden="true">›</span></button></li>';
  }
  function renderSettings() {
    var s = D.settings;
    curChips("#s-cur-chips", "cur");
    var other = CURRENCIES.indexOf(s.currency) < 0;
    $("#s-cur-own-wrap").hidden = !other;
    if (other) $("#s-cur-own").value = s.currency;
    $$('input[name="unit"]').forEach(function (r) { r.checked = r.value === s.unit; });
    $("#s-rate-label").firstChild.textContent = "Mileage rate per " + unitWord() + " ";
    $("#s-rate").value = rateInput(s.rateMills);
    $("#plat-list").innerHTML = D.platforms.map(platRow).join("") || '<li class="muted">No platforms. Add one below.</li>';
    $("#w-plat-list").innerHTML = $("#plat-list").innerHTML;
    $$('input[name="theme"]').forEach(function (r) { r.checked = r.value === s.theme; });
    $("#last-backup").textContent = D.meta.lastBackup ? "Last backup: " + HH.fmtLong(HH.parseIso(D.meta.lastBackup)) : "No backup made yet.";
    $("#sample-state").textContent = D.meta.sample ? "Sample data is on: the items, sales and trips in the app are made up." :
      "Sample data is off. You can load made-up items to look around while the app is empty.";
    $("#sample-btn").textContent = D.meta.sample ? "Clear the sample data" : "Load sample data";
  }
  function go(id) {
    render();
    if (id === "month") renderMonth();
    if (id === "sell") renderSell();
    HH.show(id);
    $("#tabs").hidden = id === "welcome";
  }

  // ── first run ────────────────────────────────────────────────────
  function welcomeStep(k) {
    [1, 2].forEach(function (i) {
      $("#welcome-" + i).hidden = i !== k;
      $("#st" + i).classList.toggle("on", i <= k);
    });
    var h1 = $("#welcome-" + k + " h1");
    if (h1) { h1.setAttribute("tabindex", "-1"); h1.focus(); }
  }
  function startWelcome() {
    go("welcome");
    curChips("#w-cur-chips", "w-cur");
    $("#w-cur-own-wrap").hidden = CURRENCIES.indexOf(D.settings.currency) >= 0;
    $("#w-cur-own").value = CURRENCIES.indexOf(D.settings.currency) >= 0 ? "" : D.settings.currency;
    $$('input[name="w-unit"]').forEach(function (r) { r.checked = r.value === D.settings.unit; });
    $("#w-rate").value = D.settings.rateMills ? rateInput(D.settings.rateMills) : "";
    wRateLabel();
    $("#w-err").hidden = true;
    welcomeStep(1);
  }
  function wRateLabel() {
    var u = (($$('input[name="w-unit"]').filter(function (r) { return r.checked; })[0] || {}).value) === "mi" ? "mile" : "km";
    $("#w-rate-label").firstChild.textContent = "Mileage rate per " + u + " ";
  }
  function finishWelcome() {
    D.meta.onboarded = true;
    save();
    go("home");
  }
  function chosenCurrency(name, ownSel) {
    var v = ($$('input[name="' + name + '"]').filter(function (r) { return r.checked; })[0] || {}).value || "$";
    if (v !== "other") return v;
    var own = $(ownSel).value.replace(/[<>&"']/g, "").trim().slice(0, 4);
    return own || null;
  }

  // ── sample data (moves with today) ───────────────────────────────
  function loadSample() {
    var t = HH.today(), d = blank(), id = d.meta.nextId;
    d.settings = { currency: "$", unit: "km", rateMills: 880, theme: D ? D.settings.theme : "auto" };
    if (D) { d.platforms = JSON.parse(JSON.stringify(D.platforms)); id = Math.max(id, D.meta.nextId); }
    var P = {};
    d.platforms.forEach(function (p) { P[p.name] = p; });
    var pick = function (n) { return P[n] ? n : (d.platforms[0] ? d.platforms[0].name : ""); };
    function item(name, notes, cost, bought, st, listed, plat, list, sold, sale, shipIn, shipOut) {
      var it = { id: id++, name: name, notes: notes, costCents: cost, bought: HH.iso(t + bought), status: st,
                 listed: listed == null ? null : HH.iso(t + listed), platform: plat ? pick(plat) : "", listCents: list == null ? null : list,
                 sold: null, saleCents: null, shipInCents: 0, shipOutCents: 0, feeCents: null, feeAuto: true, sample: true };
      if (st === "sold") {
        it.sold = HH.iso(t + sold); it.saleCents = sale; it.shipInCents = shipIn; it.shipOutCents = shipOut;
        it.feeCents = feeFor(P[it.platform] || null, sale, shipIn);
      }
      return it;
    }
    d.items = [
      // in stock, not listed yet
      item("Box of paperbacks", "Mixed fiction, 14 books · shelf B", 1000, -3, "stock"),
      item("Brass candlesticks", "Pair · needs a polish", 600, -8, "stock"),
      item("Kids' raincoat", "Size 6", 300, -12, "stock"),
      item("Vintage tea set", "6 cups and saucers · bin 4", 1500, -20, "stock"),
      // listed: every ageing group
      item("Denim jacket", "Size M · rack 1", 800, -6, "listed", -4, "eBay", 4500),
      item("Linen shirt", "Size L", 400, -10, "listed", -9, "Poshmark", 2800),
      item("Ceramic vase", "Blue glaze · shelf A", 350, -16, "listed", -14, "Etsy", 3200),
      item("Running shoes", "Size 9 · box 2", 1200, -24, "listed", -22, "Mercari", 4800),
      item("Wool scarf", "Grey", 200, -44, "listed", -41, "Depop", 1800),
      item("Leather belt", "Brown, size 34", 500, -60, "listed", -58, "eBay", 2400),
      item("Board game", "Complete, all pieces counted", 600, -75, "listed", -70, "Facebook", 2500),
      item("Table lamp", "Brass base, new cord", 1500, -110, "listed", -104, "Etsy", 6500),
      item("Silk tie", "Paisley", 100, -140, "listed", -131, "eBay", 1500),
      // sold: this month and earlier months
      item("Camera bag", "", 900, -9, "sold", -7, "eBay", 4200, 0, 3900, 1200, 1085),
      item("Glass jug", "", 300, -5, "sold", null, "In person", null, -1, 1200, 0, 0),
      item("Hiking boots", "Size 8", 1500, -21, "sold", -19, "Poshmark", 6000, -2, 5200, 0, 0),
      item("Wall clock", "", 450, -18, "sold", -15, "Etsy", 3800, -4, 3600, 1100, 1020),
      item("Knit cardigan", "Size S", 600, -30, "sold", -27, "Depop", 3000, -6, 2600, 800, 780),
      item("Picture frame set", "Set of 3", 250, -40, "sold", -35, "Facebook", 2000, -11, 1800, 0, 0),
      item("Cast iron pan", "", 800, -52, "sold", -48, "eBay", 5500, -24, 4800, 1500, 1390),
      item("Record player", "Works, new belt", 2500, -66, "sold", -60, "eBay", 12000, -33, 11000, 2000, 1850),
      item("Jigsaw puzzle", "1000 pieces", 150, -70, "sold", -65, "Mercari", 1500, -38, 1400, 600, 600),
      item("Dress boots", "Size 7", 1800, -90, "sold", -84, "Poshmark", 6500, -55, 5800, 0, 0),
      item("Desk lamp", "", 500, -100, "sold", -96, "Facebook", 2800, -61, 2500, 0, 0),
      item("Vinyl records", "Lot of 12", 1200, -125, "sold", -120, "eBay", 6000, -88, 5400, 1400, 1290),
      item("Ceramic planter", "", 300, -140, "sold", -134, "Etsy", 2900, -95, 2700, 1000, 980),
      item("Sun hat", "", 200, -150, "sold", -146, "Depop", 1600, -118, 1500, 700, 690),
      item("Coffee grinder", "Hand grinder", 700, -170, "sold", -163, "Mercari", 3200, -129, 2900, 900, 900),
      item("Rain jacket", "Size XL", 900, -190, "sold", -184, "Poshmark", 4500, -151, 3900, 0, 0),
      item("Bookends", "Pair", 400, -210, "sold", -203, "Etsy", 2600, -170, 2400, 900, 870)
    ];
    var trips = [[0, 62, "Post office"], [-1, 184, "Sourcing: weekend markets"], [-6, 238, "Sourcing: charity shops"], [-9, 45, "Post office"],
                 [-15, 310, "Sourcing: garage sales"], [-23, 58, "Post office"], [-34, 276, "Sourcing: estate sale"], [-41, 52, "Post office"],
                 [-62, 198, "Sourcing: weekend markets"], [-90, 140, "Drop-off for a local pickup"], [-121, 225, "Sourcing: charity shops"]];
    d.trips = trips.map(function (r) { return { id: id++, date: HH.iso(t + r[0]), tenths: r[1], rateMills: 880, note: r[2], sample: true }; });
    d.meta.sample = true;
    d.meta.onboarded = true;
    d.meta.nextId = id;
    D = d;
    save();
    go("home");
    HH.toast("Sample data loaded. Clear it any time.", null, 4000);
  }
  function clearSample() {
    var items = D.items.filter(function (x) { return !x.sample; }), trips = D.trips.filter(function (x) { return !x.sample; });
    var theme = D.settings.theme, next = D.meta.nextId, platforms = D.platforms;
    D = blank();
    D.settings.theme = theme;
    D.platforms = platforms;
    D.items = items;
    D.trips = trips;
    D.meta.nextId = next;
    D.meta.onboarded = items.length > 0 || trips.length > 0;
    save();
    if (D.meta.onboarded) { go("home"); HH.toast("Sample cleared. Your own items are still here."); } else startWelcome();
  }

  // ── items ────────────────────────────────────────────────────────
  function statusChosen() { return ($$('input[name="status"]').filter(function (r) { return r.checked; })[0] || {}).value || "stock"; }
  function platOptions(current) {
    var names = D.platforms.map(function (p) { return p.name; });
    if (current && names.indexOf(current) < 0) names.push(current);
    $("#it-platform").innerHTML = names.map(function (n) { return '<option value="' + esc(n) + '">' + esc(n) + "</option>"; }).join("") +
      '<option value="">None</option>';
  }
  function showBoxes() {
    var st = statusChosen();
    $("#listed-box").hidden = st === "stock";
    $("#sold-box").hidden = st !== "sold";
    $("#it-listed-label").innerHTML = "Date listed" + (st === "sold" ? ' <span class="hint">Optional for a sold item</span>' : "");
    preview();
  }
  function formSale() {
    return { sale: money0($("#it-sale").value), shipIn: money0($("#it-shipin").value), shipOut: money0($("#it-shipout").value),
             cost: money0($("#it-cost").value), plat: platByName($("#it-platform").value) };
  }
  function autoFee() {
    var f = formSale();
    if (feeTouched || f.sale == null || f.shipIn == null) return;
    $("#it-fee").value = $("#it-sale").value.trim() === "" ? "" : HH.plain(feeFor(f.plat, f.sale, f.shipIn));
  }
  function preview() {
    var st = statusChosen(), f = formSale(), fee = money0($("#it-fee").value);
    if (st !== "sold") {
      $("#pv-profit").textContent = "—";
      $("#pv-line").textContent = "Profit is worked out when the item is sold: choose Sold and type the sale.";
      return;
    }
    var calc = f.sale != null && f.shipIn != null && $("#it-sale").value.trim() !== "" ? feeFor(f.plat, f.sale, f.shipIn) : null;
    var hint = calc == null ? "The fee is worked out from the platform's rate once you type the sale price." : !feeTouched && fee === calc ? "Worked out from " + (f.plat ? esc(f.plat.name) + "'s rate: " : "") + feeSum(f.plat, f.sale, f.shipIn)
      : (feeTouched ? "Typed by you. " : "Worked out when you recorded the sale. ") + (f.plat ? "At " + esc(f.plat.name) + "'s rate now it would be " + m(calc) + "." : "");
    $("#fee-hint").innerHTML = hint;
    $("#fee-reset").hidden = calc == null || fee === calc;
    if ([f.sale, f.shipIn, f.shipOut, f.cost, fee].some(function (x) { return x == null; })) {
      $("#pv-profit").textContent = "—";
      $("#pv-line").textContent = "Type the amounts as numbers, such as 25.00, to see the profit.";
      return;
    }
    $("#pv-profit").textContent = pm(f.sale + f.shipIn - fee - f.shipOut - f.cost);
    $("#pv-line").textContent = m(f.sale) + " sale + " + m(f.shipIn) + " shipping charged − " + m(fee) + " fees − " + m(f.shipOut) + " shipping paid − " +
      m(f.cost) + " cost";
  }
  function openItem(it, opts) {
    opts = opts || {};
    editingItem = it || null;
    itemReturn = opts.from || "items";
    var st = opts.status || (it ? it.status : "stock");
    $("#item-title").textContent = opts.status === "sold" && (!it || it.status !== "sold") ? (it ? "Record the sale" : "Add a sold item") : it ? "Change item" : "Add an item";
    $("#it-name").value = it ? it.name : "";
    $("#it-notes").value = it ? it.notes : "";
    $("#it-cost").value = it ? HH.plain(it.costCents) : "";
    HH.setDate($("#it-bought"), it ? it.bought : HH.iso(T));
    $("#it-bought").max = HH.iso(T);
    $$('input[name="status"]').forEach(function (r) { r.checked = r.value === st; });
    var first = D.platforms[0] ? D.platforms[0].name : "";
    var platName = it && (it.platform || it.status !== "stock") ? it.platform : first;
    platOptions(platName);
    $("#it-platform").value = platName;
    $("#it-listed").value = it && it.listed ? it.listed : (st === "listed" ? HH.iso(T) : "");
    $("#it-listed").max = HH.iso(T);
    $("#it-listprice").value = it && it.listCents != null ? HH.plain(it.listCents) : "";
    var sold = it && it.status === "sold";
    HH.setDate($("#it-sold"), sold ? it.sold : HH.iso(T));
    $("#it-sold").max = HH.iso(T);
    $("#it-sale").value = sold ? HH.plain(it.saleCents) : it && it.listCents != null ? HH.plain(it.listCents) : "";
    $("#it-shipin").value = sold ? HH.plain(it.shipInCents) : "";
    $("#it-shipout").value = sold ? HH.plain(it.shipOutCents) : "";
    feeTouched = sold ? !it.feeAuto : false;
    if (sold) $("#it-fee").value = HH.plain(it.feeCents); else { $("#it-fee").value = ""; autoFee(); }
    $("#it-err").hidden = true;
    $("#it-delete").hidden = !it;
    go("item");
    showBoxes();
    if (opts.status === "sold") $("#it-sale").focus(); else $("#it-name").focus();
  }
  function dateErr(bought, listed, sold) {
    if (bought == null) return "Pick the day you bought it.";
    if (bought > T) return "Pick today or an earlier day for the date bought.";
    if (listed != null && listed > T) return "Pick today or an earlier day for the date listed.";
    if (sold != null && sold > T) return "Pick today or an earlier day for the date sold.";
    if (listed != null && listed < bought) return "The date listed is before the date bought. Check the two dates.";
    if (sold != null && listed != null && sold < listed) return "The date sold is before the date listed. Check the two dates.";
    if (sold != null && sold < bought) return "The date sold is before the date bought. Check the two dates.";
    return "";
  }
  function saveItem(ev) {
    ev.preventDefault();
    var st = statusChosen(), name = $("#it-name").value.trim().slice(0, 60), notes = $("#it-notes").value.trim().slice(0, 200);
    var cost = money0($("#it-cost").value), bought = HH.parseIso($("#it-bought").value);
    var listedTxt = $("#it-listed").value, listed = st === "stock" || !listedTxt ? null : HH.parseIso(listedTxt);
    var listTxt = $("#it-listprice").value.trim(), listCents = st === "stock" || listTxt === "" ? null : HH.parseMoney(listTxt);
    var sold = st === "sold" ? HH.parseIso($("#it-sold").value) : null, f = formSale(), fee = money0($("#it-fee").value);
    var err = !name ? "Give the item a name, such as Denim jacket." : cost == null ? "Type the cost as a number, such as 4.50. 0 is fine." :
      st !== "stock" && listedTxt && listed == null ? "Pick the date listed." :
      st === "listed" && listed == null ? "Pick the day you listed it." :
      st !== "stock" && listTxt !== "" && listCents == null ? "Type the listing price as a number, such as 25, or leave it blank." :
      st === "sold" && sold == null ? "Pick the day it sold." :
      st === "sold" && ($("#it-sale").value.trim() === "" || f.sale == null) ? "Type the sale price as a number, such as 25.00." :
      st === "sold" && f.shipIn == null ? "Type the shipping charged as a number. 0 is fine." :
      st === "sold" && f.shipOut == null ? "Type the shipping you paid as a number. 0 is fine." :
      st === "sold" && fee == null ? "Type the fees as a number, such as 3.25. 0 is fine." : "";
    if (!err) err = dateErr(bought, listed, sold);
    if (err) { $("#it-err").textContent = err; $("#it-err").hidden = false; return; }
    var before = JSON.stringify(D.items), it = editingItem || { id: newId() }, isNew = !editingItem;
    it.name = name; it.notes = notes; it.costCents = cost; it.bought = HH.iso(bought); it.status = st;
    it.listed = listed == null ? null : HH.iso(listed);
    it.platform = st === "stock" ? "" : $("#it-platform").value;
    it.listCents = listCents;
    if (st === "sold") {
      it.sold = HH.iso(sold); it.saleCents = f.sale; it.shipInCents = f.shipIn; it.shipOutCents = f.shipOut; it.feeCents = fee; it.feeAuto = !feeTouched;
    } else {
      it.sold = null; it.saleCents = null; it.shipInCents = 0; it.shipOutCents = 0; it.feeCents = null; it.feeAuto = true;
    }
    if (isNew) { if (D.meta.sample) it.sample = false; D.items.push(it); }
    save();
    go(itemReturn === "sell" ? "home" : itemReturn);
    HH.toast((isNew ? "Added " : "Saved ") + name + (st === "sold" ? " · profit " + pm(profitOf(it)) : ""), function () {
      D.items = JSON.parse(before); save(); render();
    });
  }
  function deleteItem() {
    var it = editingItem;
    if (!it) return;
    var before = JSON.stringify(D.items);
    D.items = D.items.filter(function (x) { return x.id !== it.id; });
    save();
    go(itemReturn === "sell" ? "home" : itemReturn);
    HH.toast("Deleted " + it.name, function () { D.items = JSON.parse(before); save(); render(); });
  }

  // ── CSV of every item ────────────────────────────────────────────
  function csvCell(v) {
    v = String(v == null ? "" : v);
    return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  function daysListed(it) {
    if (!it.listed) return "";
    var l = HH.parseIso(it.listed);
    if (it.status === "sold") return String(HH.parseIso(it.sold) - l);
    if (it.status === "listed") return String(Math.max(0, T - l));
    return "";
  }
  function csvRows() {
    var head = ["Item", "Status", "Bought", "Cost", "Listed", "Days listed", "Platform", "List price", "Sold", "Sale price", "Shipping charged",
                "Shipping paid", "Fees", "Profit", "Notes"];
    var items = D.items.slice().sort(function (p, q) { return HH.parseIso(p.bought) - HH.parseIso(q.bought) || p.id - q.id; });
    return [head].concat(items.map(function (it) {
      var s = it.status === "sold";
      return [it.name, STATUS_TEXT[it.status], it.bought, num(it.costCents), it.listed || "", daysListed(it), it.platform, it.listCents == null ? "" : num(it.listCents),
              s ? it.sold : "", s ? num(it.saleCents) : "", s ? num(it.shipInCents) : "", s ? num(it.shipOutCents) : "", s ? num(it.feeCents) : "",
              s ? num(profitOf(it)) : "", it.notes];
    }));
  }
  function exportCsv() {
    T = HH.today();
    var text = "﻿" + csvRows().map(function (r) { return r.map(csvCell).join(","); }).join("\r\n") + "\r\n";
    var name = "hollowayhart-reseller-items-" + HH.iso(T) + ".csv";
    HH.download(name, text);
    HH.toast("Items saved to your downloads: " + name, null, 6000);
  }

  // ── trips ────────────────────────────────────────────────────────
  function tripPreview() {
    var tenths = parseTenths($("#tr-dist").value), rate = parseMills($("#tr-rate").value);
    $("#tr-preview").textContent = tenths && rate != null ? dist(tenths) + " × " + rateText(rate) + " a " + unitWord() + " = " + m(tripCents({ tenths: tenths, rateMills: rate })) : "";
  }
  function openTrip(t) {
    editingTrip = t || null;
    $("#trip-title").textContent = t ? "Change trip" : "Add a trip";
    HH.setDate($("#tr-date"), t ? t.date : HH.iso(T));
    $("#tr-date").max = HH.iso(T);
    $("#tr-dist").value = t ? (t.tenths / 10).toFixed(1).replace(/\.0$/, "") : "";
    $("#tr-note").value = t ? t.note : "";
    $("#tr-rate").value = rateInput(t ? t.rateMills : D.settings.rateMills);
    $("#tr-dist-label").textContent = "Distance (" + unitShort() + ")";
    $("#tr-rate-label").textContent = "Rate per " + unitWord();
    $("#tr-err").hidden = true;
    $("#tr-delete").hidden = !t;
    go("trip");
    tripPreview();
    $("#tr-dist").focus();
  }
  function saveTrip(ev) {
    ev.preventDefault();
    var date = HH.parseIso($("#tr-date").value), tenths = parseTenths($("#tr-dist").value), rate = parseMills($("#tr-rate").value);
    var note = $("#tr-note").value.trim().slice(0, 60);
    var err = date == null ? "Pick the day of the trip." : date > T ? "Pick today or an earlier day." :
      tenths == null || tenths <= 0 ? "Type the distance as a number, such as 12.5." : rate == null ? "Type the rate as a number, such as 0.85. 0 is fine." : "";
    if (err) { $("#tr-err").textContent = err; $("#tr-err").hidden = false; return; }
    var before = JSON.stringify(D.trips), t = editingTrip || { id: newId() }, isNew = !editingTrip;
    t.date = HH.iso(date); t.tenths = tenths; t.rateMills = rate; t.note = note;
    if (isNew) { if (D.meta.sample) t.sample = false; D.trips.push(t); }
    mileYm = ymOf(date);
    save();
    go("mileage");
    HH.toast((isNew ? "Added a trip: " : "Saved the trip: ") + dist(tenths) + " · " + m(tripCents(t)), function () { D.trips = JSON.parse(before); save(); render(); });
  }
  function deleteTrip() {
    var t = editingTrip;
    if (!t) return;
    var before = JSON.stringify(D.trips);
    D.trips = D.trips.filter(function (x) { return x.id !== t.id; });
    save();
    go("mileage");
    HH.toast("Deleted the trip", function () { D.trips = JSON.parse(before); save(); render(); });
  }

  // ── platforms ────────────────────────────────────────────────────
  function platExample() {
    var rate = parseRate($("#pl-rate").value === "" ? "0" : $("#pl-rate").value), fixed = money0($("#pl-fixed").value);
    if (rate == null || fixed == null || rate > 10000) { $("#pl-example").textContent = ""; return; }
    var p = { rateBp: rate, fixedCents: fixed, onShip: $("#pl-onship").checked };
    $("#pl-example").textContent = "For example, a " + m(2500) + " sale with " + m(650) + " shipping charged: fees " + m(feeFor(p, 2500, 650)) + ".";
  }
  function openPlat(p, from) {
    editingPlat = p || null;
    platReturn = from || "settings";
    $("#plat-title").textContent = p ? "Change " + p.name : "Add a platform";
    $("#pl-name").value = p ? p.name : "";
    $("#pl-rate").value = p ? (p.rateBp / 100).toFixed(2).replace(/\.?0+$/, "") : "";
    $("#pl-fixed").value = p ? HH.plain(p.fixedCents) : "";
    $("#pl-onship").checked = p ? p.onShip : false;
    $("#pl-err").hidden = true;
    $("#pl-delete").hidden = !p;
    go("plat");
    $("#tabs").hidden = platReturn === "welcome";
    platExample();
    $("#pl-name").focus();
  }
  function closePlat() {
    if (platReturn === "welcome") { go("welcome"); welcomeStep(2); } else go("settings");
  }
  function savePlat(ev) {
    ev.preventDefault();
    var name = $("#pl-name").value.trim().slice(0, 30), rate = parseRate($("#pl-rate").value === "" ? "0" : $("#pl-rate").value);
    var fixed = money0($("#pl-fixed").value), clash = platByName(name);
    var err = !name ? "Give the platform a name, such as Market stall." : clash && clash !== editingPlat ? "There's already a platform called " + clash.name + "." :
      rate == null || rate > 10000 ? "Type the % as a number from 0 to 100, such as 13.25." : fixed == null ? "Type the fixed fee as a number, such as 0.30. 0 is fine." : "";
    if (err) { $("#pl-err").textContent = err; $("#pl-err").hidden = false; return; }
    var before = JSON.stringify(D.platforms), p = editingPlat || { id: newId() }, isNew = !editingPlat;
    p.name = name; p.rateBp = rate; p.fixedCents = fixed; p.onShip = $("#pl-onship").checked;
    if (isNew) D.platforms.push(p);
    save();
    closePlat();
    HH.toast((isNew ? "Added " : "Saved ") + name + ": new sales use " + pct(rate) + " + " + m(fixed), function () { D.platforms = JSON.parse(before); save(); render(); });
  }
  function deletePlat() {
    var p = editingPlat;
    if (!p) return;
    var before = JSON.stringify(D.platforms);
    D.platforms = D.platforms.filter(function (x) { return x.id !== p.id; });
    save();
    closePlat();
    HH.toast("Deleted " + p.name + ". Items keep the platform name they were given.", function () { D.platforms = JSON.parse(before); save(); render(); });
  }

  // ── settings ─────────────────────────────────────────────────────
  function saveShop() {
    var cur = chosenCurrency("cur", "#s-cur-own"), rate = parseMills($("#s-rate").value);
    var unit = ($$('input[name="unit"]').filter(function (r) { return r.checked; })[0] || {}).value || "km";
    $("#s-cur-own-wrap").hidden = (($$('input[name="cur"]').filter(function (r) { return r.checked; })[0] || {}).value) !== "other";
    if (cur == null) { $("#s-err").textContent = "Type your currency symbol, such as NZ$, or pick one above."; $("#s-err").hidden = false; $("#s-saved").textContent = ""; return; }
    if (rate == null) { $("#s-err").textContent = "Type the mileage rate as a number, such as 0.85. 0 is fine."; $("#s-err").hidden = false; $("#s-saved").textContent = ""; return; }
    $("#s-err").hidden = true;
    D.settings.currency = cur; D.settings.unit = unit; D.settings.rateMills = rate;
    save();
    render();
    $("#s-saved").textContent = "Saved. New trips use " + rateText(rate) + " a " + unitWord() + ".";
  }

  // ── backup and restore ───────────────────────────────────────────
  function backup() {
    T = HH.today();
    D.meta.lastBackup = HH.iso(T);
    D.meta.reminderDismissed = null;
    save();
    var name = "hollowayhart-reseller-app-backup-" + HH.iso(T) + ".json";
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
      if (r.error === "newer") {
        restoreMsg('<p class="err" id="restore-refused">This backup was made by a newer version of the app, so this copy can\'t read it. Nothing was changed.</p>');
        return;
      }
      if (r.error) {
        restoreMsg('<p class="err" id="restore-refused">This file isn\'t a backup from this app, or it is damaged. Nothing was changed.</p>');
        return;
      }
      pendingRestore = r.data;
      var d = r.data, sold = d.items.filter(function (x) { return x.status === "sold"; }).length;
      restoreMsg('<div class="banner" id="restore-summary"><strong>This backup has</strong>' +
        plural(d.items.length, "item", "items") + " (" + sold + " sold) · " + plural(d.trips.length, "trip", "trips") + " · " +
        plural(d.platforms.length, "platform", "platforms") + (r.made != null ? " · made " + HH.fmtLong(r.made) : "") +
        '<p class="small" style="margin-top:6px">Restoring replaces everything in the app now.</p>' +
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
      title: "Start fresh?", yes: "Next", no: "Keep my data",
      text: "This deletes your items, sales, trips and platform rates from this browser. If you might want them again, cancel and use Back up now first.",
      onYes: function () {
        HH.confirmStep({
          title: "Delete everything now?", yes: "Yes, delete everything", no: "Cancel", danger: true,
          text: "This can't be undone without a backup.",
          onYes: function () {
            var theme = D.settings.theme;
            D = blank(); D.settings.theme = theme;
            save();
            startWelcome();
            HH.toast("Everything was deleted. Starting fresh.");
          }
        });
      }
    });
  }

  // ── wiring ───────────────────────────────────────────────────────
  function wire() {
    $$("[data-nav]").forEach(function (b) { b.addEventListener("click", function () { go(b.getAttribute("data-nav")); }); });
    $("#add-item-btn").addEventListener("click", function () { openItem(null, { from: "home" }); });
    $("#items-add").addEventListener("click", function () { openItem(null, { from: "items" }); });
    $("#sell-btn").addEventListener("click", function () { sellSearch = ""; $("#sell-search").value = ""; go("sell"); });
    $("#sell-new").addEventListener("click", function () { openItem(null, { from: "home", status: "sold" }); });
    $("#sell-back").addEventListener("click", function () { go("home"); });
    $("#sell-search").addEventListener("input", function () { sellSearch = $("#sell-search").value.trim(); renderSell(); });
    $("#item-form").addEventListener("submit", saveItem);
    $("#it-cancel").addEventListener("click", function () { go(itemReturn === "sell" ? "sell" : itemReturn); });
    $("#it-delete").addEventListener("click", deleteItem);
    $$('input[name="status"]').forEach(function (r) {
      r.addEventListener("change", function () {
        if (r.value === "listed" && !$("#it-listed").value) $("#it-listed").value = HH.iso(T);
        if (r.value === "sold" && !$("#it-sold").value) HH.setDate($("#it-sold"), HH.iso(T));
        if (r.value === "sold" && $("#it-sale").value.trim() === "" && $("#it-listprice").value.trim() !== "") $("#it-sale").value = $("#it-listprice").value.trim();
        autoFee();
        showBoxes();
      });
    });
    ["#it-sale", "#it-shipin", "#it-platform"].forEach(function (id) {
      $(id).addEventListener("input", function () { autoFee(); preview(); });
      $(id).addEventListener("change", function () { autoFee(); preview(); });
    });
    ["#it-shipout", "#it-cost"].forEach(function (id) { $(id).addEventListener("input", preview); });
    $("#it-fee").addEventListener("input", function () { feeTouched = $("#it-fee").value.trim() !== ""; preview(); });
    $("#it-fee").addEventListener("change", function () { if ($("#it-fee").value.trim() === "") { feeTouched = false; autoFee(); } preview(); });
    $("#fee-reset").addEventListener("click", function () { feeTouched = false; autoFee(); preview(); });
    $$('input[name="flt"]').forEach(function (r) { r.addEventListener("change", function () { filter = r.value; renderItems(); }); });
    $("#it-search").addEventListener("input", function () { search = $("#it-search").value.trim(); renderItems(); });
    $("#export-btn").addEventListener("click", exportCsv);
    $("#pr-year").addEventListener("change", function () { profitYear = +$("#pr-year").value; renderProfit(); });
    $("#mo-back").addEventListener("click", function () { go("profit"); });
    $("#mi-month").addEventListener("change", function () { mileYm = $("#mi-month").value; renderMileage(); });
    $("#trip-add").addEventListener("click", function () { openTrip(null); });
    $("#trip-form").addEventListener("submit", saveTrip);
    $("#tr-cancel").addEventListener("click", function () { go("mileage"); });
    $("#tr-delete").addEventListener("click", deleteTrip);
    ["#tr-dist", "#tr-rate"].forEach(function (id) { $(id).addEventListener("input", tripPreview); });
    $("#plat-add").addEventListener("click", function () { openPlat(null, "settings"); });
    $("#plat-form").addEventListener("submit", savePlat);
    $("#pl-cancel").addEventListener("click", closePlat);
    $("#pl-delete").addEventListener("click", deletePlat);
    ["#pl-rate", "#pl-fixed"].forEach(function (id) { $(id).addEventListener("input", platExample); });
    $("#pl-onship").addEventListener("change", platExample);
    document.addEventListener("click", function (ev) {
      var t = ev.target.closest ? ev.target.closest("[data-edit-item],[data-sell-item],[data-edit-trip],[data-edit-plat],[data-month]," +
        "[data-clear-sample],[data-backup],[data-dismiss-backup],[data-go]") : null;
      if (!t) return;
      var vis = $$("[data-screen]").filter(function (s) { return !s.hidden; })[0];
      var screen = vis ? vis.getAttribute("data-screen") : "home";
      if (t.hasAttribute("data-edit-item")) openItem(byId(D.items, +t.getAttribute("data-edit-item")), { from: screen });
      else if (t.hasAttribute("data-sell-item")) openItem(byId(D.items, +t.getAttribute("data-sell-item")), { from: screen, status: "sold" });
      else if (t.hasAttribute("data-edit-trip")) openTrip(byId(D.trips, +t.getAttribute("data-edit-trip")));
      else if (t.hasAttribute("data-edit-plat")) openPlat(byId(D.platforms, +t.getAttribute("data-edit-plat")), screen === "welcome" ? "welcome" : "settings");
      else if (t.hasAttribute("data-month")) { monthYm = t.getAttribute("data-month"); go("month"); }
      else if (t.hasAttribute("data-clear-sample")) clearSample();
      else if (t.hasAttribute("data-backup")) backup();
      else if (t.hasAttribute("data-dismiss-backup")) { D.meta.reminderDismissed = HH.iso(T); save(); renderBanners(); }
      else if (t.hasAttribute("data-go")) go(t.getAttribute("data-go"));
    });
    $("#set-form").addEventListener("submit", function (ev) { ev.preventDefault(); saveShop(); });
    $("#s-cur-chips").addEventListener("change", function () {
      var other = (($$('input[name="cur"]').filter(function (r) { return r.checked; })[0] || {}).value) === "other";
      $("#s-cur-own-wrap").hidden = !other;
      if (other) { if (!$("#s-cur-own").value.trim()) { $("#s-cur-own").focus(); return; } }
      saveShop();
    });
    $("#s-cur-own").addEventListener("change", saveShop);
    $$('input[name="unit"]').forEach(function (r) { r.addEventListener("change", saveShop); });
    $("#s-rate").addEventListener("change", saveShop);
    $$('input[name="theme"]').forEach(function (r) {
      r.addEventListener("change", function () { D.settings.theme = r.value; save(); HH.applyTheme(r.value); });
    });
    $("#backup-btn").addEventListener("click", backup);
    $("#restore-file").addEventListener("change", onRestoreFile);
    $("#sample-btn").addEventListener("click", function () {
      if (D.meta.sample) { clearSample(); return; }
      if (hasOwn()) {
        $("#sample-state").textContent = "Sample data only loads into an empty app. Back up, then Start fresh, if you want to look at it.";
        return;
      }
      loadSample();
    });
    $("#fresh-btn").addEventListener("click", startFresh);
    $("#help-btn").addEventListener("click", function () { go("help"); });
    $("#help-back").addEventListener("click", function () { go("settings"); });
    // first run
    $("#w-cur-chips").addEventListener("change", function () {
      var other = (($$('input[name="w-cur"]').filter(function (r) { return r.checked; })[0] || {}).value) === "other";
      $("#w-cur-own-wrap").hidden = !other;
      if (other) $("#w-cur-own").focus();
    });
    $$('input[name="w-unit"]').forEach(function (r) { r.addEventListener("change", wRateLabel); });
    $("#w-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var cur = chosenCurrency("w-cur", "#w-cur-own"), rate = parseMills($("#w-rate").value);
      var err = cur == null ? "Type your currency symbol, such as NZ$, or pick one above." : rate == null ? "Type the mileage rate as a number, such as 0.85. 0 is fine." : "";
      if (err) { $("#w-err").textContent = err; $("#w-err").hidden = false; return; }
      $("#w-err").hidden = true;
      D.settings.currency = cur;
      D.settings.unit = ($$('input[name="w-unit"]').filter(function (r) { return r.checked; })[0] || {}).value || "km";
      D.settings.rateMills = rate;
      save();
      renderSettings();
      welcomeStep(2);
    });
    $("#w-sample").addEventListener("click", loadSample);
    $("#w-plat-add").addEventListener("click", function () { openPlat(null, "welcome"); });
    $("#w-done").addEventListener("click", finishWelcome);
    document.addEventListener("visibilitychange", function () { if (!document.hidden && D.meta.onboarded) render(); });
  }

  // ── start ────────────────────────────────────────────────────────
  function start() {
    var raw = store.read();
    if (raw) {
      var r = migrate(raw);
      if (r.data) D = r.data;
      else {
        try { window.localStorage.setItem("hh139_unreadable_" + HH.iso(HH.today()), JSON.stringify(raw)); } catch (e) { /* nothing more to do */ }
        D = blank();
      }
    } else D = blank();
    wire();
    if (D.meta.onboarded) go("home"); else startWelcome();
  }

  // for the QA runner (qa/app_qa139.py): the same maths the screens use
  window.HH139 = { feeFor: feeFor, profitOf: profitOf, tripCents: tripCents, monthStats: monthStats, yearStats: yearStats, ageing: ageing,
    csvRows: csvRows, migrate: migrate, SCHEMA: SCHEMA, APP_ID: APP_ID, data: function () { return D; } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
