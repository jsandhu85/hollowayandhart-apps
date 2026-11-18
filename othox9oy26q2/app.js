window.HH_BUILD = {"id": "140", "version": "18Nov2026.6", "hosted": true};
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

/* Product 140: Small Business Bookkeeping App (specs/business/140-small-business-bookkeeping-app.yaml), 18 Nov 2026.
   Income and expenses by category with a receipt note each, GST / BAS quarters (Australia), sales tax (United States) or VAT
   (United Kingdom) by quarter, profit and loss by month and year, a mileage log at the buyer's own rate, and CSV export.
   A Region setting picks the tax words, the rate, the quarters and the year; changing it never changes an entry.
   Money is integer cents; tax rates are basis points (8.25% = 825); the mileage rate is tenths of a cent (0.725 = 725);
   distances are tenths; dates are day numbers from HH (apps/core.js). It's a record-keeping tool. It isn't tax advice. */
(function () {
  "use strict";
  var SCHEMA = 1;
  var APP_ID = "hollowayhart-bookkeeping-app";
  var REGIONS = ["AU", "US", "UK"];
  var INCOME_CATS = ["Sales", "Services", "Commissions", "Interest", "Other income"];
  var EXPENSE_CATS = ["Advertising", "Account fees", "Equipment", "Insurance", "Office supplies", "Phone & internet", "Postage & shipping",
    "Professional fees", "Rent", "Software & subscriptions", "Stock & materials", "Travel", "Utilities", "Vehicle", "Other"];
  var MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var MAX_CENTS = 9999999999;           // 99,999,999.99
  var MAX_TENTHS = 999999;              // 99,999.9 a trip
  var MAX_MILLS = 100000;               // 100.000 a km or mile
  var REMIND_DAYS = 30;
  var W = {
    AU: { name: "GST", Name: "GST", tick: "GST included", title: "GST & BAS", tab: "GST", yearWord: "financial year" },
    US: { name: "sales tax", Name: "Sales tax", tick: "Sales tax included", title: "Sales tax", tab: "Tax", yearWord: "tax year" },
    UK: { name: "VAT", Name: "VAT", tick: "VAT included", title: "VAT", tab: "VAT", yearWord: "tax year" }
  };
  var DEF = {
    AU: { currency: "$", units: "km", tickExpense: true },
    US: { currency: "$", units: "miles", tickExpense: false },
    UK: { currency: "£", units: "miles", tickExpense: true }
  };
  var $ = HH.$, $$ = HH.$$, esc = HH.esc;
  var store = new HH.Store("hh140_");
  var D = null;
  var T = HH.today();
  var editingEntry = null, entryType = "income", entryReturn = "home", editingTrip = null, tripReturn = "mileage", pendingRestore = null;
  var enYear = null, enType = "all", expYear = null, txYear = null, plYear = null, plPeriod = "year", miYear = null;

  // ── data ──────────────────────────────────────────────────────────
  function blank() {
    return {
      schema: SCHEMA,
      settings: { region: "AU", currency: "$", units: "km", usRateBp: 0, ukRateBp: 2000, ukQStart: 4, mileRateMills: null, theme: "auto",
                  incomeCats: INCOME_CATS.slice(), expenseCats: EXPENSE_CATS.slice() },
      entries: [], trips: [],
      meta: { created: HH.iso(HH.today()), lastBackup: null, reminderDismissed: null, sample: false, onboarded: false, nextId: 1 }
    };
  }
  function isInt(x) { return typeof x === "number" && isFinite(x) && Math.floor(x) === x; }
  function isDate(s) { return HH.parseIso(s) != null; }
  function isName(s, n) { return typeof s === "string" && s.length > 0 && s.length <= n; }
  function isText(s, n) { return typeof s === "string" && s.length <= n; }
  function isCats(a) { return Array.isArray(a) && a.length > 0 && a.every(function (c) { return isName(c, 30); }); }
  function validate(d) {
    try {
      var s = d.settings, m = d.meta, i, x;
      if (d.schema !== SCHEMA || !s || !m || !Array.isArray(d.entries) || !Array.isArray(d.trips)) return false;
      if (REGIONS.indexOf(s.region) < 0 || typeof s.currency !== "string" || s.currency.length > 4) return false;
      if (["km", "miles"].indexOf(s.units) < 0 || ["auto", "light", "dark"].indexOf(s.theme) < 0) return false;
      if (!(isInt(s.usRateBp) && s.usRateBp >= 0 && s.usRateBp < 10000) || !(isInt(s.ukRateBp) && s.ukRateBp >= 0 && s.ukRateBp < 10000)) return false;
      if (!(isInt(s.ukQStart) && s.ukQStart >= 1 && s.ukQStart <= 12)) return false;
      if (!(s.mileRateMills === null || (isInt(s.mileRateMills) && s.mileRateMills >= 0 && s.mileRateMills <= MAX_MILLS))) return false;
      if (!isCats(s.incomeCats) || !isCats(s.expenseCats)) return false;
      if (!isDate(m.created) || !(m.lastBackup === null || isDate(m.lastBackup))) return false;
      if (!(m.reminderDismissed === null || isDate(m.reminderDismissed))) return false;
      if (typeof m.sample !== "boolean" || typeof m.onboarded !== "boolean" || !isInt(m.nextId)) return false;
      for (i = 0; i < d.entries.length; i++) {
        x = d.entries[i];
        if (!isInt(x.id) || ["income", "expense"].indexOf(x.type) < 0 || !isInt(x.cents) || x.cents <= 0 || x.cents > MAX_CENTS) return false;
        if (!isDate(x.date) || !isName(x.cat, 30) || !isText(x.desc, 60) || typeof x.taxIn !== "boolean" || !isText(x.note, 200)) return false;
      }
      for (i = 0; i < d.trips.length; i++) {
        x = d.trips[i];
        if (!isInt(x.id) || !isDate(x.date) || !isText(x.purpose, 60) || !isInt(x.tenths) || x.tenths <= 0 || x.tenths > MAX_TENTHS) return false;
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
  function hasOwn() { return own(D.entries) || own(D.trips); }
  function byId(list, id) { return list.filter(function (x) { return x.id === id; })[0]; }

  // ── whole-number division, exact for the sizes the app allows (no floating-point slips at a rounding edge)
  function idiv(x, y) {
    var q = Math.floor(x / y);
    while (q * y > x) q--;
    while ((q + 1) * y <= x) q++;
    return q;
  }

  // ── tax (the spec's tax_maths) ───────────────────────────────────
  function rateBp(s) { s = s || D.settings; return s.region === "AU" ? 1000 : s.region === "US" ? s.usRateBp : s.ukRateBp; }
  function taxPart(cents, bp) {          // cents × bp ÷ (10000 + bp), rounded half-up to the cent; AU's 1000 is exactly ÷ 11
    if (!bp) return 0;
    var dd = 10000 + bp;
    return idiv(2 * cents * bp + dd, 2 * dd);
  }
  function taxOf(e) { return e.taxIn ? taxPart(e.cents, rateBp()) : 0; }
  function words() { return W[D.settings.region]; }

  // ── quarters and years by region ─────────────────────────────────
  function qStart() { var s = D.settings; return s.region === "AU" ? 7 : s.region === "US" ? 1 : s.ukQStart; }
  function monthAt(y, m0) { var t = y * 12 + m0; return { y: Math.floor(t / 12), m: (t % 12) + 1 }; }
  function qYearOf(n) { var a = HH.ymd(n), S = qStart(); return a.m >= S ? a.y : a.y - 1; }
  function quarterIndex(n) { var a = HH.ymd(n); return Math.floor((((a.m - qStart()) % 12) + 12) % 12 / 3); }
  function quarter(Y, k) {
    var S = qStart(), a = monthAt(Y, S - 1 + 3 * k), b = monthAt(Y, S - 1 + 3 * k + 2);
    return { first: HH.dn(a.y, a.m, 1), last: HH.dn(b.y, b.m, HH.lastDay(b.y, b.m)),
             label: a.y === b.y ? MO[a.m - 1] + "–" + MO[b.m - 1] + " " + b.y : MO[a.m - 1] + " " + a.y + "–" + MO[b.m - 1] + " " + b.y };
  }
  function short(y) { return String(y + 1).slice(2); }
  function qYearLabel(Y) {
    var S = qStart();
    if (D.settings.region === "AU") return "FY " + Y + "–" + short(Y);
    if (S === 1) return String(Y);
    var e = monthAt(Y, S - 1 + 11);
    return MO[S - 1] + " " + Y + " – " + MO[e.m - 1] + " " + e.y;
  }
  function tYearOf(n) {
    var a = HH.ymd(n), r = D.settings.region;
    if (r === "AU") return a.m >= 7 ? a.y : a.y - 1;
    if (r === "US") return a.y;
    return n >= HH.dn(a.y, 4, 6) ? a.y : a.y - 1;
  }
  function tYearRange(Y) {
    var r = D.settings.region;
    if (r === "AU") return { first: HH.dn(Y, 7, 1), last: HH.dn(Y + 1, 6, 30) };
    if (r === "US") return { first: HH.dn(Y, 1, 1), last: HH.dn(Y, 12, 31) };
    return { first: HH.dn(Y, 4, 6), last: HH.dn(Y + 1, 4, 5) };
  }
  function tYearLabel(Y) {
    var r = D.settings.region;
    return r === "AU" ? "FY " + Y + "–" + short(Y) : r === "US" ? String(Y) : Y + "–" + short(Y);
  }
  function rangeText(first, last) { return HH.fmtLong(first) + " – " + HH.fmtLong(last); }
  function monthRows(first, last) {      // calendar months cut to the year's first and last day (13 rows in a UK tax year)
    var out = [], d = first;
    while (d <= last) {
      var a = HH.ymd(d), me = HH.dn(a.y, a.m, HH.lastDay(a.y, a.m)), end = Math.min(me, last), b = HH.ymd(end);
      out.push({ first: d, last: end, label: a.d === 1 && end === me ? MO[a.m - 1] + " " + a.y : a.d + "–" + b.d + " " + MO[a.m - 1] + " " + a.y });
      d = end + 1;
    }
    return out;
  }
  function yearsOf(fn, lists) {
    var seen = {};
    seen[fn(T)] = 1;
    lists.forEach(function (list) { list.forEach(function (x) { seen[fn(HH.parseIso(x.date))] = 1; }); });
    return Object.keys(seen).map(Number).sort(function (a, b) { return b - a; });
  }
  function taxYears() { return yearsOf(tYearOf, [D.entries, D.trips]); }
  function qYears() { return yearsOf(qYearOf, [D.entries]); }

  // ── sums ─────────────────────────────────────────────────────────
  function sums(first, last) {
    var o = { inc: 0, incTax: 0, exp: 0, expTax: 0, incCats: {}, expCats: {}, n: 0 };
    D.entries.forEach(function (e) {
      var d = HH.parseIso(e.date);
      if (d < first || d > last) return;
      var t = taxOf(e), net = e.cents - t;
      o.n++;
      if (e.type === "income") { o.inc += e.cents; o.incTax += t; o.incCats[e.cat] = (o.incCats[e.cat] || 0) + net; }
      else { o.exp += e.cents; o.expTax += t; o.expCats[e.cat] = (o.expCats[e.cat] || 0) + net; }
    });
    o.incNet = o.inc - o.incTax;
    o.expNet = o.exp - o.expTax;
    o.profit = o.incNet - o.expNet;
    o.diff = o.incTax - o.expTax;
    return o;
  }

  // ── mileage ──────────────────────────────────────────────────────
  function tripsIn(first, last) {
    var list = D.trips.filter(function (x) { var d = HH.parseIso(x.date); return d >= first && d <= last; }), tenths = 0;
    list.forEach(function (x) { tenths += x.tenths; });
    return { list: list, tenths: tenths, claim: claimOf(tenths) };
  }
  function claimOf(tenths) {             // total distance × rate, rounded half-up once
    var r = D.settings.mileRateMills;
    return r == null ? null : idiv(2 * tenths * r + 100, 200);
  }

  // ── wording helpers ──────────────────────────────────────────────
  function m(c) { return HH.money(c, D.settings.currency); }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
  function profitText(c) { return c < 0 ? m(-c) + " loss" : m(c); }
  function diffText(c) { return c > 0 ? m(c) + " more collected than paid" : c < 0 ? m(-c) + " more paid than collected" : m(0); }
  function pct(bp) { return (bp / 100).toFixed(2).replace(/\.?0+$/, "") + "%"; }
  function num(tenths) {
    var w = String(Math.floor(tenths / 10)).replace(/\B(?=(\d{3})+(?!\d))/g, ","), f = tenths % 10;
    return f ? w + "." + f : w;
  }
  function unitWord(many) { return D.settings.units === "km" ? "km" : many ? "miles" : "mile"; }
  function distText(tenths) { return num(tenths) + " " + unitWord(tenths !== 10); }
  function rateText(mills) {
    var f = String(mills % 1000);
    f = ("000" + f).slice(-3).replace(/0$/, "");
    return D.settings.currency + Math.floor(mills / 1000) + "." + f;
  }
  function ratePlain(mills) { return mills == null ? "" : rateText(mills).slice(D.settings.currency.length); }
  function bpPlain(bp) { return (bp / 100).toFixed(2).replace(/\.?0+$/, ""); }
  function taxRule() { return D.settings.region === "AU" ? "the amount ÷ 11" : "at " + pct(rateBp()); }

  // ── parsing what's typed ─────────────────────────────────────────
  function parseRateBp(s) {             // a percentage with up to 2 decimals, under 100
    s = String(s == null ? "" : s).replace(/[\s%,]/g, "");
    if (!/^(\d+(\.\d{0,2})?|\.\d{1,2})$/.test(s)) return null;
    var p = s.split("."), bp = parseInt(p[0] || "0", 10) * 100 + (p[1] ? parseInt((p[1] + "0").slice(0, 2), 10) : 0);
    return bp < 10000 ? bp : null;
  }
  function parseMills(s) {              // money with up to 3 decimals, in tenths of a cent
    s = String(s == null ? "" : s).replace(/[\s,]/g, "").replace(/^[^\d.]+/, "");
    if (!/^(\d+(\.\d{0,3})?|\.\d{1,3})$/.test(s)) return null;
    var p = s.split("."), v = parseInt(p[0] || "0", 10) * 1000 + (p[1] ? parseInt((p[1] + "00").slice(0, 3), 10) : 0);
    return v <= MAX_MILLS ? v : null;
  }
  function parseTenths(s) {             // a distance with up to 1 decimal
    s = String(s == null ? "" : s).replace(/[\s,]/g, "");
    if (!/^(\d+(\.\d?)?|\.\d)$/.test(s)) return null;
    var p = s.split(".");
    return parseInt(p[0] || "0", 10) * 10 + (p[1] ? parseInt(p[1], 10) : 0);
  }

  // ── rendering ────────────────────────────────────────────────────
  function render() {
    T = HH.today();
    HH.applyTheme(D.settings.theme);
    renderWords();
    renderBanners();
    renderHome();
    renderEntries();
    renderTax();
    renderPl();
    renderMileage();
    renderSettings();
  }
  function renderWords() {
    var w = words();
    $$("[data-tx]").forEach(function (el) { el.textContent = w[el.getAttribute("data-tx")]; });
    $$("[data-unit]").forEach(function (el) { el.textContent = unitWord(el.getAttribute("data-unit") === "many"); });
  }
  function renderBanners() {
    var h = "";
    if (!store.ok) {
      h += '<div class="banner" id="storage-banner" role="alert"><strong>Your browser isn\'t saving data in this window. ' +
        "Use Backup before you close it.</strong>This happens in private windows, or when the browser is set to block site data. " +
        "The app still works until you close it.</div>";
    }
    if (D && D.meta.sample) {
      h += '<div class="banner slim" id="sample-banner"><span><span class="sample-flag">SAMPLE</span> · made-up entries</span>' +
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
  function byNewest(a, b) { return HH.parseIso(b.date) - HH.parseIso(a.date) || b.id - a.id; }
  function byOldest(a, b) { return HH.parseIso(a.date) - HH.parseIso(b.date) || a.id - b.id; }
  function entryRow(e) {
    var w = words(), t = taxOf(e), d = HH.parseIso(e.date);
    return '<li data-entry="' + e.id + '"><button type="button" class="rowbtn" data-edit-entry="' + e.id + '" aria-label="Change ' +
      esc((e.desc || e.cat) + " " + m(e.cents)) + '"><span class="what"><b>' + esc(e.desc || e.cat) + '</b><br><span class="small muted">' +
      HH.fmtDate(d, true) + " · " + esc(e.cat) + '</span><br><span class="tag">' + (e.type === "income" ? "Income" : "Expense") + "</span> " +
      '<span class="tag tax-tag">' + (e.taxIn ? esc(w.Name) + " " + m(t) : "No " + esc(w.name)) + "</span>" +
      (e.note ? '<span class="small note-line">Receipt: ' + esc(e.note) + "</span>" : "") +
      '</span><span class="amt">' + m(e.cents) + (e.type === "income" ? " in" : " out") + '</span><span class="chev" aria-hidden="true">›</span></button></li>';
  }
  function renderHome() {
    var w = words(), Y = tYearOf(T), r = tYearRange(Y), ys = sums(r.first, r.last);
    $("#hero-label").textContent = "Profit this " + w.yearWord;
    $("#hero-num").textContent = profitText(ys.profit);
    $("#hero-cap").textContent = tYearLabel(Y) + " · income " + m(ys.incNet) + " − expenses " + m(ys.expNet);
    var a = HH.ymd(T), ms = sums(HH.dn(a.y, a.m, 1), HH.dn(a.y, a.m, HH.lastDay(a.y, a.m)));
    $("#hm-head").textContent = "This month · " + MO[a.m - 1] + " " + a.y;
    $("#hm-income").textContent = m(ms.incNet);
    $("#hm-expense").textContent = m(ms.expNet);
    $("#hm-profit").textContent = profitText(ms.profit);
    var q = quarter(qYearOf(T), quarterIndex(T)), qs = sums(q.first, q.last);
    $("#hq-head").textContent = w.Name + " this quarter · " + q.label;
    $("#hq-col").textContent = m(qs.incTax);
    $("#hq-paid").textContent = m(qs.expTax);
    $("#hq-diff").textContent = diffText(qs.diff);
    var tr = tripsIn(r.first, r.last);
    $("#hmi-line").textContent = plural(tr.list.length, "trip", "trips") + " · " + distText(tr.tenths) +
      (tr.claim != null ? " · about " + m(tr.claim) + " at " + rateText(D.settings.mileRateMills) + " per " + unitWord(false)
        : " · type your rate on the Mileage screen for an estimate");
    var latest = D.entries.slice().sort(byNewest).slice(0, 5);
    $("#home-latest").innerHTML = latest.map(entryRow).join("");
    $("#home-latest-none").hidden = latest.length > 0;
    $("#home-how").textContent = "Profit = income − expenses for the " + w.yearWord + " (" + rangeText(r.first, r.last) + "), with the " + w.name +
      " taken out of every entry ticked '" + w.tick + "'. The " + w.name + " figures are estimates from what you typed, " +
      (D.settings.region === "AU" ? "the amount ÷ 11" : "at " + pct(rateBp())) + ". It's a record-keeping tool. It isn't tax advice.";
  }
  function yearOptions(list, label, sel, withAll) {
    return (withAll ? '<option value="all"' + (sel === "all" ? " selected" : "") + ">All years</option>" : "") +
      list.map(function (Y) { return '<option value="' + Y + '"' + (String(Y) === String(sel) ? " selected" : "") + ">" + label(Y) + "</option>"; }).join("");
  }
  function renderEntries() {
    var years = taxYears();
    if (enYear !== "all" && years.indexOf(+enYear) < 0) enYear = String(tYearOf(T));
    if (expYear !== "all" && years.indexOf(+expYear) < 0) expYear = "all";
    $("#en-year").innerHTML = yearOptions(years, tYearLabel, enYear, true);
    $("#exp-year").innerHTML = yearOptions(years, tYearLabel, expYear, true);
    $$('input[name="en-type"]').forEach(function (r) { r.checked = r.value === enType; });
    var rg = enYear === "all" ? null : tYearRange(+enYear);
    var list = D.entries.filter(function (e) {
      var d = HH.parseIso(e.date);
      return (!rg || (d >= rg.first && d <= rg.last)) && (enType === "all" || e.type === enType);
    }).sort(byNewest);
    var inc = 0, exp = 0;
    list.forEach(function (e) { if (e.type === "income") inc += e.cents; else exp += e.cents; });
    $("#en-count").textContent = plural(list.length, "entry", "entries") + (list.length ? " · in " + m(inc) + " · out " + m(exp) + ", as typed" : "");
    $("#en-list").innerHTML = list.map(entryRow).join("");
    $("#en-none").hidden = list.length > 0;
  }
  function stat(label, value, cls) { return '<div class="stat ' + cls + '"><span>' + esc(label) + "</span><b>" + esc(value) + "</b></div>"; }
  function renderTax() {
    var w = words(), years = qYears();
    if (txYear == null || years.indexOf(+txYear) < 0) txYear = qYearOf(T);
    txYear = +txYear;
    $("#tx-year").innerHTML = yearOptions(years, qYearLabel, txYear, false);
    var q0 = quarter(txYear, 0), q3 = quarter(txYear, 3), now = qYearOf(T) === txYear ? quarterIndex(T) : -1;
    $("#tx-range").textContent = rangeText(q0.first, q3.last);
    var h = "";
    for (var k = 0; k < 4; k++) {
      var q = quarter(txYear, k), s = sums(q.first, q.last);
      h += '<div class="card qcard" data-q="' + k + '"><h2>' + esc(q.label) + (k === now ? ' <span class="tag done">now</span>' : "") + "</h2>" +
        stat("Sales, as typed", m(s.inc), "q-sales") + stat(w.Name + " collected on sales", m(s.incTax), "q-col") +
        stat("Expenses, as typed", m(s.exp), "q-exp") + stat(w.Name + " paid on expenses", m(s.expTax), "q-paid") +
        stat("Difference", diffText(s.diff), "q-diff") + "</div>";
    }
    $("#tx-quarters").innerHTML = h;
    var ys = sums(q0.first, q3.last);
    $("#tx-total-head").textContent = "The whole year · " + qYearLabel(txYear);
    $("#tx-col").textContent = m(ys.incTax);
    $("#tx-paid").textContent = m(ys.expTax);
    $("#tx-diff").textContent = diffText(ys.diff);
    var r = D.settings.region;
    $("#tx-how").textContent = (r === "AU"
      ? "For each entry ticked 'GST included', the GST is the amount ÷ 11, rounded to the cent. BAS quarters run Jul–Sep, Oct–Dec, Jan–Mar and Apr–Jun, in a financial year from 1 July to 30 June."
      : "For each entry ticked '" + w.tick + "', the " + w.name + " is the amount × rate ÷ (100 + rate), rounded to the cent, at your rate of " +
        pct(rateBp()) + " (Settings). " + (r === "US" ? "Quarters follow the calendar year."
          : "Your VAT quarters start in " + MONTHS[D.settings.ukQStart - 1] + " (Settings).")) +
      " Collected adds up the " + w.name + " in your income entries; paid adds up the " + w.name + " in your expense entries; the difference is one minus the other. Entries without the tick count no " + w.name + ".";
  }
  function catRows(obj, order) {
    var keys = order.filter(function (c) { return obj[c]; }), extra = Object.keys(obj).filter(function (c) { return obj[c] && order.indexOf(c) < 0; }).sort();
    return keys.concat(extra).map(function (c) {
      return '<li data-cat="' + esc(c) + '"><span class="what">' + esc(c) + '</span><span class="amt">' + m(obj[c]) + "</span></li>";
    }).join("");
  }
  function renderPl() {
    var w = words(), years = taxYears();
    if (plYear == null || years.indexOf(+plYear) < 0) { plYear = tYearOf(T); plPeriod = "year"; }
    plYear = +plYear;
    var r = tYearRange(plYear), rows = monthRows(r.first, r.last);
    if (plPeriod !== "year" && !rows[+plPeriod]) plPeriod = "year";
    $("#pl-year").innerHTML = yearOptions(years, tYearLabel, plYear, false);
    $("#pl-range").textContent = rangeText(r.first, r.last);
    $("#pl-period").innerHTML = '<option value="year"' + (plPeriod === "year" ? " selected" : "") + ">The whole year</option>" +
      rows.map(function (x, i) { return '<option value="' + i + '"' + (String(i) === String(plPeriod) ? " selected" : "") + ">" + x.label + "</option>"; }).join("");
    var sel = plPeriod === "year" ? r : rows[+plPeriod], s = sums(sel.first, sel.last);
    $("#pl-intro").textContent = "Income minus expenses, for the " + w.yearWord + " or one month, with the " + w.name +
      " taken out of every entry ticked '" + w.tick + "'.";
    $("#pl-head").textContent = (plPeriod === "year" ? tYearLabel(plYear) : sel.label) + " · profit";
    $("#pl-profit").textContent = profitText(s.profit);
    $("#pl-cap").textContent = "Income " + m(s.incNet) + " − expenses " + m(s.expNet);
    $("#pl-inc-cats").innerHTML = catRows(s.incCats, D.settings.incomeCats);
    $("#pl-inc-none").hidden = $("#pl-inc-cats").innerHTML !== "";
    $("#pl-exp-cats").innerHTML = catRows(s.expCats, D.settings.expenseCats);
    $("#pl-exp-none").hidden = $("#pl-exp-cats").innerHTML !== "";
    $("#pl-income").textContent = m(s.incNet);
    $("#pl-expense").textContent = m(s.expNet);
    $("#pl-months").innerHTML = rows.map(function (x, i) {
      var t = sums(x.first, x.last);
      return '<li data-month="' + i + '"><button type="button" class="rowbtn" data-pl-month="' + i + '" aria-label="Show ' + esc(x.label) +
        '"><span class="what"><b>' + esc(x.label) + '</b><br><span class="small muted">In ' + m(t.incNet) + " · Out " + m(t.expNet) +
        '</span></span><span class="amt">' + profitText(t.profit) + '</span><span class="chev" aria-hidden="true">›</span></button></li>';
    }).join("");
    var tr = tripsIn(r.first, r.last);
    $("#pl-mileage").textContent = plural(tr.list.length, "trip", "trips") + " · " + distText(tr.tenths) +
      (tr.claim != null ? " · about " + m(tr.claim) + " at your rate" : "") + ". Not added into the profit above.";
  }
  function renderMileage() {
    var years = taxYears();
    if (miYear == null || years.indexOf(+miYear) < 0) miYear = tYearOf(T);
    miYear = +miYear;
    $("#mi-year").innerHTML = yearOptions(years, tYearLabel, miYear, false);
    var r = tYearRange(miYear), tr = tripsIn(r.first, r.last), rate = D.settings.mileRateMills;
    $("#mi-count").textContent = String(tr.list.length);
    $("#mi-total").textContent = distText(tr.tenths);
    $("#mi-claim").textContent = tr.claim != null ? m(tr.claim) : "—";
    $("#mi-claim-note").textContent = rate != null ? distText(tr.tenths) + " × " + rateText(rate) + " per " + unitWord(false) +
      ", rounded to the cent. An estimate from what you typed." : "Type your rate below to see an estimate.";
    if (document.activeElement !== $("#mi-rate")) $("#mi-rate").value = ratePlain(rate);
    $("#mi-list-head").textContent = "Trips · " + tYearLabel(miYear);
    $("#trip-list").innerHTML = tr.list.slice().sort(byNewest).map(function (x) {
      return '<li data-trip="' + x.id + '"><button type="button" class="rowbtn" data-edit-trip="' + x.id + '" aria-label="Change trip ' +
        esc(x.purpose || "") + '"><span class="what"><b>' + (x.purpose ? esc(x.purpose) : '<span class="muted">Business trip</span>') +
        '</b><br><span class="small muted">' + HH.fmtDate(HH.parseIso(x.date), true) + '</span></span><span class="amt">' + distText(x.tenths) +
        '</span><span class="chev" aria-hidden="true">›</span></button></li>';
    }).join("");
    $("#trip-none").hidden = tr.list.length > 0;
  }
  function monthOptions(sel) {
    return MONTHS.map(function (n, i) { return '<option value="' + (i + 1) + '"' + (i + 1 === sel ? " selected" : "") + ">" + n + "</option>"; }).join("");
  }
  function renderSettings() {
    var s = D.settings;
    $$('input[name="s-region"]').forEach(function (r) { r.checked = r.value === s.region; });
    $("#s-au-line").hidden = s.region !== "AU";
    $("#s-rate-wrap").hidden = s.region === "AU";
    $("#s-rate-label").textContent = s.region === "UK" ? "VAT rate (%)" : "Sales tax rate (%)";
    if (document.activeElement !== $("#s-rate")) $("#s-rate").value = s.region === "AU" ? "" : bpPlain(rateBp());
    $("#s-q-wrap").hidden = s.region !== "UK";
    $("#s-qstart").innerHTML = monthOptions(s.ukQStart);
    var chip = false;
    $$('input[name="s-cur"]').forEach(function (r) { r.checked = r.value === s.currency; chip = chip || r.checked; });
    if (document.activeElement !== $("#s-cur-own")) $("#s-cur-own").value = chip ? "" : s.currency;
    $$('input[name="s-units"]').forEach(function (r) { r.checked = r.value === s.units; });
    if (document.activeElement !== $("#s-inc-cats")) $("#s-inc-cats").value = s.incomeCats.join("\n");
    if (document.activeElement !== $("#s-exp-cats")) $("#s-exp-cats").value = s.expenseCats.join("\n");
    $$('input[name="theme"]').forEach(function (r) { r.checked = r.value === s.theme; });
    $("#last-backup").textContent = D.meta.lastBackup ? "Last backup: " + HH.fmtLong(HH.parseIso(D.meta.lastBackup)) : "No backup made yet.";
    $("#sample-state").textContent = D.meta.sample ? "Sample data is on: the entries and trips in the app are made up." :
      "Sample data is off. You can load made-up entries to look around while the app is empty.";
    $("#sample-btn").textContent = D.meta.sample ? "Clear the sample data" : "Load sample data";
  }
  function go(id) {
    render();
    HH.show(id);
    $("#tabs").hidden = id === "welcome";
  }

  // ── first run (the Start screen) ─────────────────────────────────
  function wRegion() { return ($$('input[name="w-region"]').filter(function (r) { return r.checked; })[0] || {}).value || "AU"; }
  function wRegionChanged() {
    var r = wRegion();
    $("#w-au-line").hidden = r !== "AU";
    $("#w-rate-wrap").hidden = r === "AU";
    $("#w-q-wrap").hidden = r !== "UK";
    $("#w-rate-label").textContent = r === "UK" ? "Your VAT rate (%)" : "Your sales tax rate (%)";
    $("#w-rate-hint").textContent = r === "UK" ? "20 for the standard rate. 0 if you don't charge VAT." : "The rate you collect, such as 8.25. 0 if you don't collect it.";
    $("#w-rate").value = r === "UK" ? bpPlain(D.settings.ukRateBp) : (D.settings.usRateBp ? bpPlain(D.settings.usRateBp) : "");
    $("#w-rate").placeholder = r === "UK" ? "20" : "8.25";
    $("#w-cur").value = DEF[r].currency;
  }
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
    $$('input[name="w-region"]').forEach(function (r) { r.checked = r.value === D.settings.region; });
    $("#w-qstart").innerHTML = monthOptions(D.settings.ukQStart);
    wRegionChanged();
    $("#w-err").hidden = true;
    welcomeStep(1);
  }
  function saveWelcome(ev) {
    ev.preventDefault();
    var r = wRegion(), s = D.settings, bp = null;
    if (r !== "AU") {
      var txt = $("#w-rate").value.trim();
      bp = parseRateBp(txt === "" ? "0" : txt);
      if (bp == null) {
        $("#w-err").textContent = "Type the " + W[r].name + " rate as a number under 100, such as " + (r === "UK" ? "20" : "8.25") + ". 0 is fine.";
        $("#w-err").hidden = false;
        return;
      }
    }
    $("#w-err").hidden = true;
    s.region = r;
    if (r === "US") s.usRateBp = bp;
    if (r === "UK") { s.ukRateBp = bp; s.ukQStart = +$("#w-qstart").value; }
    s.currency = $("#w-cur").value;
    s.units = DEF[r].units;
    save();
    renderWords();
    welcomeStep(2);
  }
  function finishWelcome(then) {
    D.meta.onboarded = true;
    save();
    if (then === "income" || then === "expense") openEntry(then, null, "home");
    else go("home");
  }

  // ── sample data (moves with today) ───────────────────────────────
  function loadSample(region) {
    var t = HH.today(), id = 1, d = blank();
    region = REGIONS.indexOf(region) >= 0 ? region : "AU";
    d.settings.region = region;
    d.settings.currency = DEF[region].currency;
    d.settings.units = DEF[region].units;
    d.settings.usRateBp = 825;
    d.settings.ukRateBp = 2000;
    d.settings.ukQStart = 4;
    d.settings.mileRateMills = region === "AU" ? 880 : region === "US" ? 700 : 450;
    d.settings.theme = D ? D.settings.theme : "auto";
    var usTicked = ["Equipment", "Office supplies", "Stock & materials"];
    d.entries = [
      [-2, "income", 48000, "Sales", "Online shop orders", true, "Payout statement in the Sales folder"],
      [-6, "income", 165000, "Services", "Logo design for a client", true, "Invoice 1046"],
      [-12, "income", 32050, "Sales", "Weekend market stall", true, ""],
      [-19, "income", 88000, "Services", "Website updates for a client", true, "Invoice 1045"],
      [-27, "income", 51275, "Sales", "Online shop orders", true, ""],
      [-35, "income", 120000, "Services", "Brand photos for a client", true, "Invoice 1044"],
      [-41, "income", 27500, "Sales", "Weekend market stall", true, ""],
      [-48, "income", 1240, "Interest", "Interest on business savings", false, ""],
      [-55, "income", 66000, "Services", "Logo design for a client", true, "Invoice 1043"],
      [-63, "income", 45980, "Sales", "Online shop orders", true, ""],
      [-77, "income", 99000, "Services", "Website build, first half", true, "Invoice 1042"],
      [-90, "income", 38400, "Sales", "Weekend market stall", true, ""],
      [-104, "income", 72600, "Services", "Brochure design", true, "Invoice 1041"],
      [-118, "income", 41200, "Sales", "Online shop orders", true, ""],
      [-133, "income", 1180, "Interest", "Interest on business savings", false, ""],
      [-147, "income", 55000, "Services", "Poster design", true, "Invoice 1040"],
      [-160, "income", 36300, "Sales", "Online shop orders", true, ""],
      [-1, "expense", 1650, "Postage & shipping", "Postage for orders", true, "In the shoebox"],
      [-4, "expense", 8900, "Stock & materials", "Paper and card stock", true, "Paper copy in the blue folder"],
      [-9, "expense", 4999, "Software & subscriptions", "Design software, monthly", true, "Emailed, saved in the Receipts folder"],
      [-10, "expense", 6500, "Phone & internet", "Mobile plan", true, ""],
      [-15, "expense", 7020, "Vehicle", "Fuel", true, "In the glovebox"],
      [-22, "expense", 3300, "Office supplies", "Printer ink", true, ""],
      [-26, "expense", 1500, "Account fees", "Monthly account fee", false, ""],
      [-30, "expense", 22000, "Advertising", "Market stall fee", true, "Paid at the gate, in the blue folder"],
      [-38, "expense", 4999, "Software & subscriptions", "Design software, monthly", true, "Emailed, saved in the Receipts folder"],
      [-44, "expense", 12900, "Insurance", "Business insurance, monthly", true, ""],
      [-52, "expense", 6650, "Vehicle", "Fuel", true, ""],
      [-60, "expense", 39900, "Equipment", "Drawing tablet", true, "In the blue folder, with the 2-year warranty"],
      [-68, "expense", 6500, "Phone & internet", "Mobile plan", true, ""],
      [-75, "expense", 2475, "Postage & shipping", "Postage for orders", true, ""],
      [-86, "expense", 18000, "Professional fees", "Bookkeeping help", true, "Invoice from the bookkeeper"],
      [-96, "expense", 7340, "Stock & materials", "Packaging", true, ""],
      [-112, "expense", 4999, "Software & subscriptions", "Design software, monthly", true, ""],
      [-125, "expense", 1500, "Account fees", "Monthly account fee", false, ""],
      [-140, "expense", 6800, "Vehicle", "Fuel", true, ""],
      [-155, "expense", 15000, "Advertising", "Online ads", true, ""],
      [-170, "expense", 30000, "Rent", "Shared studio desk", true, "Invoice from the studio"],
      [-3, "expense", 2350, "Travel", "Train to a client", true, ""],
      [-175, "income", 110000, "Services", "Website build, last stage", true, "Invoice 1039"]
    ].map(function (r) {
      var tick = r[5] && (region !== "US" || r[1] === "income" || usTicked.indexOf(r[3]) >= 0);
      return { id: id++, type: r[1], cents: r[2], date: HH.iso(t + r[0]), cat: r[3], desc: r[4], taxIn: tick, note: r[6], sample: true };
    });
    d.trips = [[-3, "Post office run", 64], [-12, "Weekend market", 248], [-20, "Supplier pick-up", 183], [-33, "Client meeting", 412],
               [-41, "Weekend market", 248], [-58, "Supplier pick-up", 183], [-79, "Client meeting", 356], [-90, "Weekend market", 248],
               [-120, "Post office run", 64]]
      .map(function (r) { return { id: id++, date: HH.iso(t + r[0]), purpose: r[1], tenths: r[2], sample: true }; });
    d.meta.sample = true;
    d.meta.onboarded = true;
    d.meta.nextId = id;
    D = d;
    enYear = null; txYear = null; plYear = null; miYear = null; plPeriod = "year";
    save();
    go("home");
    HH.toast("Sample data loaded. Clear it any time.", null, 4000);
  }
  function clearSample() {
    var keep = {}, theme = D.settings.theme, next = D.meta.nextId;
    ["entries", "trips"].forEach(function (k) { keep[k] = D[k].filter(function (x) { return !x.sample; }); });
    D = blank();
    D.settings.theme = theme;
    D.entries = keep.entries;
    D.trips = keep.trips;
    D.meta.nextId = next;
    save();
    startWelcome();
  }

  // ── entries ──────────────────────────────────────────────────────
  function defaultTick(type) { return type === "income" ? true : DEF[D.settings.region].tickExpense; }
  function cats(type) { return type === "income" ? D.settings.incomeCats : D.settings.expenseCats; }
  function defaultCat(type) {
    var list = cats(type);
    return type === "income" ? list[0] : list.indexOf("Other") >= 0 ? "Other" : list[list.length - 1];
  }
  function renderEntryCats(want) {
    var list = cats(entryType);
    if (want == null || list.indexOf(want) < 0) want = (editingEntry && editingEntry.type === entryType && list.indexOf(editingEntry.cat) < 0) ? editingEntry.cat : defaultCat(entryType);
    var all = list.indexOf(want) < 0 ? list.concat([want]) : list;
    $("#e-cats").innerHTML = all.map(function (c, i) {
      return '<label class="chip"><input type="radio" name="ecat" value="' + esc(c) + '" id="ecat-' + i + '"' + (c === want ? " checked" : "") +
        "><span>" + esc(c) + "</span></label>";
    }).join("");
  }
  function entryTitle() {
    $("#e-title").textContent = editingEntry ? (entryType === "income" ? "Change income" : "Change expense") : (entryType === "income" ? "Add income" : "Add an expense");
  }
  function updateTaxLine() {
    var w = words(), cents = HH.parseMoney($("#e-amount").value);
    $("#e-tax-line").textContent = !$("#e-taxin").checked ? "No " + w.name + " counted on this entry." :
      cents == null || cents <= 0 ? w.Name + " in this amount: shown when you type it (" + taxRule() + ")." :
      w.Name + " in this amount: " + m(taxPart(cents, rateBp())) + " (" + taxRule() + ")";
  }
  function openEntry(type, e, from) {
    editingEntry = e || null;
    entryType = e ? e.type : (type === "expense" ? "expense" : "income");
    entryReturn = from || (e ? "entries" : "home");
    $$('input[name="etype"]').forEach(function (r) { r.checked = r.value === entryType; });
    renderEntryCats(e ? e.cat : null);
    entryTitle();
    $("#e-amount").value = e ? HH.plain(e.cents) : "";
    $("#e-desc").value = e ? e.desc : "";
    $("#e-note").value = e ? e.note : "";
    $("#e-taxin").checked = e ? e.taxIn : defaultTick(entryType);
    var day = e ? HH.parseIso(e.date) : T;
    $("#e-date").value = HH.iso(day);
    $("#e-date").max = HH.iso(T);
    $("#e-day-text").textContent = day === T ? "Today" : HH.fmtDate(day, true);
    $("#e-day-wrap").hidden = true;
    $("#e-err").hidden = true;
    $("#e-delete").hidden = !e;
    go("entry");
    updateTaxLine();
    $("#e-amount").focus();
  }
  function closeEntry() {
    if (entryReturn === "welcome") { go("welcome"); welcomeStep(2); } else go(entryReturn);
  }
  function entryError(cents, day) {
    if (cents == null || cents <= 0 || cents > MAX_CENTS) return "Type the amount as a number, such as 49.95.";
    if (day == null) return "Pick the day it happened.";
    if (day > T) return "Pick today or an earlier day.";
    return "";
  }
  function saveEntry(ev) {
    ev.preventDefault();
    var cents = HH.parseMoney($("#e-amount").value), day = HH.parseIso($("#e-date").value), err = entryError(cents, day);
    if (err) { $("#e-err").textContent = err; $("#e-err").hidden = false; $("#e-amount").focus(); return; }
    var cat = ($$('#e-cats input').filter(function (i) { return i.checked; })[0] || {}).value || defaultCat(entryType);
    var vals = { type: entryType, cents: cents, date: HH.iso(day), cat: cat.slice(0, 30), desc: $("#e-desc").value.trim().slice(0, 60),
                 taxIn: $("#e-taxin").checked, note: $("#e-note").value.trim().slice(0, 200) };
    var w = words();
    if (editingEntry) {
      var target = editingEntry, before = {};
      Object.keys(vals).forEach(function (k) { before[k] = target[k]; target[k] = vals[k]; });
      save();
      go("entries");
      HH.toast("Changed to " + m(cents), function () { Object.keys(before).forEach(function (k) { target[k] = before[k]; }); save(); render(); });
    } else {
      var x = { id: newId() };
      Object.keys(vals).forEach(function (k) { x[k] = vals[k]; });
      if (D.meta.sample) x.sample = false;
      D.entries.push(x);
      save();
      if (entryReturn === "welcome") D.meta.onboarded = true;
      go(entryReturn === "entries" ? "entries" : "home");
      HH.toast("Saved " + m(cents) + (x.type === "income" ? " income" : " expense") + (x.taxIn ? " · " + w.Name + " " + m(taxOf(x)) : ""), function () {
        D.entries = D.entries.filter(function (s) { return s.id !== x.id; });
        save(); render();
      });
    }
  }
  function deleteEntry() {
    var x = editingEntry, i = D.entries.indexOf(x);
    if (i < 0) return;
    D.entries.splice(i, 1);
    save();
    go("entries");
    HH.toast("Deleted " + m(x.cents), function () { D.entries.splice(i, 0, x); save(); render(); });
  }

  // ── trips ────────────────────────────────────────────────────────
  function openTrip(x) {
    editingTrip = x || null;
    $("#t-title").textContent = x ? "Change trip" : "Add a trip";
    $("#t-dist").value = x ? num(x.tenths).replace(/,/g, "") : "";
    $("#t-purpose").value = x ? x.purpose : "";
    $("#t-date").value = x ? x.date : HH.iso(T);
    $("#t-date").max = HH.iso(T);
    $("#t-err").hidden = true;
    $("#t-delete").hidden = !x;
    go("trip");
    $("#t-dist").focus();
  }
  function saveTrip(ev) {
    ev.preventDefault();
    var tenths = parseTenths($("#t-dist").value), day = HH.parseIso($("#t-date").value);
    var err = tenths == null || tenths <= 0 || tenths > MAX_TENTHS ? "Type the distance as a number with at most one decimal, such as 12.5." :
      day == null ? "Pick the day of the trip." : day > T ? "Pick today or an earlier day." : "";
    if (err) { $("#t-err").textContent = err; $("#t-err").hidden = false; $("#t-dist").focus(); return; }
    var purpose = $("#t-purpose").value.trim().slice(0, 60);
    if (editingTrip) {
      var t = editingTrip, before = { tenths: t.tenths, date: t.date, purpose: t.purpose };
      t.tenths = tenths; t.date = HH.iso(day); t.purpose = purpose;
      save();
      go("mileage");
      HH.toast("Changed to " + distText(tenths), function () { t.tenths = before.tenths; t.date = before.date; t.purpose = before.purpose; save(); render(); });
    } else {
      var x = { id: newId(), date: HH.iso(day), purpose: purpose, tenths: tenths };
      if (D.meta.sample) x.sample = false;
      D.trips.push(x);
      miYear = tYearOf(day);
      save();
      go("mileage");
      HH.toast("Saved a trip of " + distText(tenths), function () { D.trips = D.trips.filter(function (s) { return s.id !== x.id; }); save(); render(); });
    }
  }
  function deleteTrip() {
    var x = editingTrip, i = D.trips.indexOf(x);
    if (i < 0) return;
    D.trips.splice(i, 1);
    save();
    go("mileage");
    HH.toast("Deleted a trip of " + distText(x.tenths), function () { D.trips.splice(i, 0, x); save(); render(); });
  }
  function saveRate() {
    var txt = $("#mi-rate").value.trim(), v = txt === "" ? null : parseMills(txt);
    if (txt !== "" && v == null) {
      $("#mi-err").textContent = "Type the rate as a number with up to 3 decimals, such as 0.88. Leave it blank for no estimate.";
      $("#mi-err").hidden = false;
      $("#mi-saved").textContent = "";
      return;
    }
    $("#mi-err").hidden = true;
    D.settings.mileRateMills = v;
    save();
    renderMileage(); renderHome(); renderPl();
    $("#mi-saved").textContent = v == null ? "Saved. No rate, so no estimate." : "Saved: " + rateText(v) + " per " + unitWord(false) + ".";
  }

  // ── CSV export ───────────────────────────────────────────────────
  function csvCell(v) {
    v = String(v == null ? "" : v);
    return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  function inYear(x, sel) {
    if (sel === "all") return true;
    var r = tYearRange(+sel), d = HH.parseIso(x.date);
    return d >= r.first && d <= r.last;
  }
  function exportEntries() {
    var w = words(), sel = $("#exp-year").value || "all";
    var list = D.entries.filter(function (e) { return inYear(e, sel); }).sort(byOldest);
    var lines = [["Date", "Type", "Category", "Description", "Amount", w.tick, w.Name, "Amount without " + w.name, "Receipt note"].map(csvCell).join(",")];
    list.forEach(function (e) {
      var t = taxOf(e);
      lines.push([e.date, e.type === "income" ? "Income" : "Expense", e.cat, e.desc, HH.plain(e.cents), e.taxIn ? "Yes" : "No", HH.plain(t),
                  HH.plain(e.cents - t), e.note].map(csvCell).join(","));
    });
    var name = "hollowayhart-bookkeeping-entries-" + HH.iso(T) + ".csv";
    HH.download(name, "﻿" + lines.join("\r\n") + "\r\n");
    HH.toast(plural(list.length, "entry", "entries") + " saved to your downloads: " + name, null, 6000);
  }
  function exportTrips() {
    var sel = $("#exp-year").value || "all";
    var list = D.trips.filter(function (x) { return inYear(x, sel); }).sort(byOldest);
    var lines = [["Date", "Purpose", "Distance", "Unit"].join(",")];
    list.forEach(function (x) { lines.push([x.date, x.purpose, num(x.tenths).replace(/,/g, ""), D.settings.units].map(csvCell).join(",")); });
    var name = "hollowayhart-bookkeeping-trips-" + HH.iso(T) + ".csv";
    HH.download(name, "﻿" + lines.join("\r\n") + "\r\n");
    HH.toast(plural(list.length, "trip", "trips") + " saved to your downloads: " + name, null, 6000);
  }

  // ── settings ─────────────────────────────────────────────────────
  function settingsSaved(text) { $("#s-saved").textContent = text; }
  function setRegion(r) {
    var s = D.settings, old = s.region;
    if (r === old) return;
    if (s.currency === DEF[old].currency) s.currency = DEF[r].currency;
    if (s.units === DEF[old].units) s.units = DEF[r].units;
    s.region = r;
    txYear = null; plYear = null; miYear = null; enYear = null; plPeriod = "year";
    $("#s-err").hidden = true;
    save();
    render();
    settingsSaved("Saved: " + (r === "AU" ? "Australia, GST" : r === "US" ? "United States, sales tax at " + pct(s.usRateBp) : "United Kingdom, VAT at " + pct(s.ukRateBp)) + ".");
  }
  function saveRateSetting() {
    var s = D.settings, txt = $("#s-rate").value.trim(), bp = parseRateBp(txt === "" ? "0" : txt);
    if (bp == null) {
      $("#s-err").textContent = "Type the " + words().name + " rate as a number under 100, such as " + (s.region === "UK" ? "20" : "8.25") + ".";
      $("#s-err").hidden = false;
      settingsSaved("");
      return;
    }
    $("#s-err").hidden = true;
    if (s.region === "US") s.usRateBp = bp; else if (s.region === "UK") s.ukRateBp = bp;
    save();
    render();
    settingsSaved("Saved: " + words().name + " at " + pct(bp) + ".");
  }
  function saveCurrency(v) {
    v = String(v || "").trim().slice(0, 4);
    D.settings.currency = v;
    save();
    render();
    settingsSaved("Saved. Amounts now show as " + m(123456) + ".");
  }
  function saveCats(id, key, defaults) {
    var lines = $(id).value.split("\n").map(function (x) { return x.trim().slice(0, 30); }).filter(function (x) { return x; });
    var seen = {}, list = [];
    lines.forEach(function (c) { if (!seen[c.toLowerCase()]) { seen[c.toLowerCase()] = 1; list.push(c); } });
    if (!list.length) list = defaults.slice();
    D.settings[key] = list;
    save();
    renderPl();
    $(id).value = list.join("\n");
    $("#s-cats-saved").textContent = "Saved " + plural(list.length, key === "incomeCats" ? "income category" : "expense category",
      key === "incomeCats" ? "income categories" : "expense categories") + ". Entries keep the category they were given.";
  }

  // ── backup and restore ───────────────────────────────────────────
  function backup() {
    T = HH.today();
    D.meta.lastBackup = HH.iso(T);
    D.meta.reminderDismissed = null;
    save();
    var name = "hollowayhart-bookkeeping-app-backup-" + HH.iso(T) + ".json";
    var mode = HH.saveFile(name, JSON.stringify({ app: APP_ID, schema: SCHEMA, made: HH.iso(T), data: D }, null, 2));
    render();
    HH.toast(HH.savedMessage(mode, name), null, 6000);
  }
  function readBackup(text) {
    var o;
    try { o = JSON.parse(text); } catch (e) { return { error: "broken" }; }
    if (!o || typeof o !== "object") return { error: "broken" };
    if (o.app !== APP_ID) return { error: typeof o.app === "string" && o.app.indexOf("hollowayhart-") === 0 ? "other" : "broken" };
    if (!o.data) return { error: "broken" };
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
      if (r.error === "other") {
        restoreMsg('<p class="err" id="restore-refused">This is a backup from a different Holloway &amp; Hart app, so it can\'t be loaded here. Nothing was changed.</p>');
        return;
      }
      if (r.error) {
        restoreMsg('<p class="err" id="restore-refused">This file isn\'t a backup from this app, or it is damaged. Nothing was changed.</p>');
        return;
      }
      pendingRestore = r.data;
      var d = r.data, inc = d.entries.filter(function (e) { return e.type === "income"; }).length;
      restoreMsg('<div class="banner" id="restore-summary"><strong>This backup has</strong>' +
        plural(d.entries.length, "entry", "entries") + " (" + inc + " income, " + (d.entries.length - inc) + " expenses) · " +
        plural(d.trips.length, "trip", "trips") + (r.made != null ? " · made " + HH.fmtLong(r.made) : "") +
        '<p class="small" style="margin-top:6px">Restoring replaces everything in the app now.</p>' +
        '<div class="row-buttons"><button type="button" class="btn btn-primary" id="restore-yes">Replace with this backup</button>' +
        '<button type="button" class="btn btn-quiet" id="restore-no">Cancel</button></div></div>');
      $("#restore-yes").addEventListener("click", function () {
        D = pendingRestore; pendingRestore = null;
        enYear = null; txYear = null; plYear = null; miYear = null; plPeriod = "year";
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
      text: "This deletes your entries, trips and settings from this browser. If you might want them again, cancel and use Back up now first.",
      onYes: function () {
        HH.confirmStep({
          title: "Delete everything now?", yes: "Yes, delete everything", no: "Cancel", danger: true,
          text: "This can't be undone without a backup.",
          onYes: function () {
            var theme = D.settings.theme;
            D = blank(); D.settings.theme = theme;
            enYear = null; txYear = null; plYear = null; miYear = null; plPeriod = "year";
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
    $$("[data-nav]").forEach(function (b) {
      b.addEventListener("click", function () { go(b.getAttribute("data-nav")); });
    });
    $("#add-income").addEventListener("click", function () { openEntry("income", null, "home"); });
    $("#add-expense").addEventListener("click", function () { openEntry("expense", null, "home"); });
    $("#en-add-income").addEventListener("click", function () { openEntry("income", null, "entries"); });
    $("#en-add-expense").addEventListener("click", function () { openEntry("expense", null, "entries"); });
    $("#e-form").addEventListener("submit", saveEntry);
    $("#e-cancel").addEventListener("click", closeEntry);
    $("#e-delete").addEventListener("click", deleteEntry);
    $("#e-amount").addEventListener("input", updateTaxLine);
    $("#e-taxin").addEventListener("change", updateTaxLine);
    $$('input[name="etype"]').forEach(function (r) {
      r.addEventListener("change", function () {
        var cur = ($$('#e-cats input').filter(function (i) { return i.checked; })[0] || {}).value;
        entryType = r.value;
        renderEntryCats(cats(entryType).indexOf(cur) >= 0 ? cur : null);
        if (!editingEntry) $("#e-taxin").checked = defaultTick(entryType);
        entryTitle();
        updateTaxLine();
      });
    });
    $("#e-day-change").addEventListener("click", function () { $("#e-day-wrap").hidden = false; $("#e-date").focus(); });
    $("#e-date").addEventListener("change", function () {
      var d = HH.parseIso($("#e-date").value);
      $("#e-day-text").textContent = d == null ? "?" : d === T ? "Today" : HH.fmtDate(d, true);
    });
    $("#en-year").addEventListener("change", function () { enYear = $("#en-year").value; renderEntries(); });
    $("#exp-year").addEventListener("change", function () { expYear = $("#exp-year").value; });
    $$('input[name="en-type"]').forEach(function (r) { r.addEventListener("change", function () { enType = r.value; renderEntries(); }); });
    $("#exp-entries").addEventListener("click", exportEntries);
    $("#exp-trips").addEventListener("click", exportTrips);
    $("#tx-year").addEventListener("change", function () { txYear = +$("#tx-year").value; renderTax(); });
    $("#pl-year").addEventListener("change", function () { plYear = +$("#pl-year").value; plPeriod = "year"; renderPl(); });
    $("#pl-period").addEventListener("change", function () { plPeriod = $("#pl-period").value; renderPl(); });
    $("#mi-year").addEventListener("change", function () { miYear = +$("#mi-year").value; renderMileage(); });
    $("#mi-rate").addEventListener("change", saveRate);
    $("#mi-form").addEventListener("submit", function (ev) { ev.preventDefault(); saveRate(); });
    $("#trip-add").addEventListener("click", function () { openTrip(null); });
    $("#t-form").addEventListener("submit", saveTrip);
    $("#t-cancel").addEventListener("click", function () { go("mileage"); });
    $("#t-delete").addEventListener("click", deleteTrip);
    document.addEventListener("click", function (ev) {
      var t = ev.target.closest ? ev.target.closest("[data-edit-entry],[data-edit-trip],[data-pl-month],[data-clear-sample],[data-backup]," +
        "[data-dismiss-backup],[data-go]") : null;
      if (!t) return;
      if (t.hasAttribute("data-edit-entry")) openEntry(null, byId(D.entries, +t.getAttribute("data-edit-entry")), HH.$('[data-screen="home"]').hidden ? "entries" : "home");
      else if (t.hasAttribute("data-edit-trip")) openTrip(byId(D.trips, +t.getAttribute("data-edit-trip")));
      else if (t.hasAttribute("data-pl-month")) { plPeriod = t.getAttribute("data-pl-month"); renderPl(); window.scrollTo(0, 0); }
      else if (t.hasAttribute("data-clear-sample")) clearSample();
      else if (t.hasAttribute("data-backup")) backup();
      else if (t.hasAttribute("data-dismiss-backup")) { D.meta.reminderDismissed = HH.iso(T); save(); renderBanners(); }
      else if (t.hasAttribute("data-go")) go(t.getAttribute("data-go"));
    });
    $("#set-form").addEventListener("submit", function (ev) { ev.preventDefault(); if (D.settings.region !== "AU") saveRateSetting(); });
    $$('input[name="s-region"]').forEach(function (r) { r.addEventListener("change", function () { setRegion(r.value); }); });
    $("#s-rate").addEventListener("change", saveRateSetting);
    $("#s-qstart").addEventListener("change", function () {
      D.settings.ukQStart = +$("#s-qstart").value; txYear = null;
      save(); render();
      settingsSaved("Saved: VAT quarters start in " + MONTHS[D.settings.ukQStart - 1] + ".");
    });
    $$('input[name="s-cur"]').forEach(function (r) { r.addEventListener("change", function () { $("#s-cur-own").value = ""; saveCurrency(r.value); }); });
    $("#s-cur-own").addEventListener("change", function () {
      var v = $("#s-cur-own").value.trim();
      if (v) saveCurrency(v);
    });
    $$('input[name="s-units"]').forEach(function (r) {
      r.addEventListener("change", function () {
        D.settings.units = r.value; save(); render();
        settingsSaved("Saved: distances in " + r.value + ". Your trips keep the numbers you typed.");
      });
    });
    $("#s-inc-cats").addEventListener("change", function () { saveCats("#s-inc-cats", "incomeCats", INCOME_CATS); });
    $("#s-exp-cats").addEventListener("change", function () { saveCats("#s-exp-cats", "expenseCats", EXPENSE_CATS); });
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
      loadSample(D.settings.region);
    });
    $("#fresh-btn").addEventListener("click", startFresh);
    $("#help-btn").addEventListener("click", function () { go("help"); });
    $("#help-back").addEventListener("click", function () { go("settings"); });
    // first run
    $$('input[name="w-region"]').forEach(function (r) { r.addEventListener("change", wRegionChanged); });
    $("#w-form").addEventListener("submit", saveWelcome);
    $("#w-sample").addEventListener("click", function () { loadSample(wRegion()); });
    $("#w-add-income").addEventListener("click", function () { finishWelcome("income"); });
    $("#w-add-expense").addEventListener("click", function () { finishWelcome("expense"); });
    $("#w-finish").addEventListener("click", function () { finishWelcome("home"); });
    document.addEventListener("visibilitychange", function () { if (!document.hidden && D.meta.onboarded) render(); });
  }

  // ── start ────────────────────────────────────────────────────────
  function start() {
    var raw = store.read();
    if (raw) {
      var r = migrate(raw);
      if (r.data) D = r.data;
      else {
        try { window.localStorage.setItem("hh140_unreadable_" + HH.iso(HH.today()), JSON.stringify(raw)); } catch (e) { /* nothing more to do */ }
        D = blank();
      }
    } else D = blank();
    wire();
    if (D.meta.onboarded) go("home"); else startWelcome();
  }

  // for the QA runner (qa/app_qa140.py): the same maths the screens use
  window.HH140 = { taxPart: taxPart, taxOf: taxOf, sums: sums, quarter: quarter, qYearOf: qYearOf, tYearOf: tYearOf, tYearRange: tYearRange,
    monthRows: monthRows, claimOf: claimOf, parseRateBp: parseRateBp, parseMills: parseMills, parseTenths: parseTenths, migrate: migrate,
    SCHEMA: SCHEMA, APP_ID: APP_ID, data: function () { return D; } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
