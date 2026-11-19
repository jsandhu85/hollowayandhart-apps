window.HH_BUILD = {"id": "141", "version": "18Nov2026.4", "hosted": true};
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

/* Product 141: Beauty Pro Client Book & Appointment App (specs/business/141-beauty-pro-client-book-app.yaml), 18 Nov 2026.
   Client cards (contact, birthday as day and month, allergies and sensitivities in the client's words, patch tests, visits with
   their service notes), a week / day calendar, rebook reminders from each service's rebook weeks, services and prices, and an
   income log (done appointments, tips, product sales) by week or month. Money is integer cents; dates are day numbers from HH
   (apps/core.js); times are 'HH:MM' strings. The rules are the spec's, exactly. */
(function () {
  "use strict";
  var SCHEMA = 1;
  var APP_ID = "hollowayhart-client-book";
  var STATUS = ["Booked", "Done", "No-show", "Cancelled"];
  var ST_CLS = { Booked: "booked", Done: "done", "No-show": "noshow", Cancelled: "cancelled" };
  var BIZ = [["nails", "Nails"], ["lashes", "Lashes"], ["brows", "Brows"], ["skin", "Skin"], ["mixed", "Mixed"]];
  var NOTE_FIELDS = {
    nails: ["Nail shape", "Colour", "Length", "Notes"],
    lashes: ["Lash map", "Curl", "Length", "Notes"],
    brows: ["Brow shape", "Tint formula", "Notes"],
    skin: ["Products used", "Formula", "Skin notes"],
    mixed: ["Formula", "Lash map", "Nail shape and colour", "Brow notes", "Notes"]
  };
  var CURRENCIES = ["AU$", "US$", "£", "€"];
  var KINDS = ["Product sale", "Tip"];
  var WINDOW = 14;
  var REMIND_DAYS = 30;
  var MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var $ = HH.$, $$ = HH.$$, esc = HH.esc;
  var store = new HH.Store("hh141_");
  var D = null;
  var T = HH.today();
  var editingAppt = null, apReturn = "home", apDraftClient = null;
  var viewClient = null, editingClient = null, clientReturn = "clients", editingPatch = null;
  var editingSale = null, editingSvc = null, svcReturn = "services", pendingRestore = null;
  var calMode = "week", calDay = null, incMode = "week", incDay = null, search = "";

  // ── data ──────────────────────────────────────────────────────────
  function blank() {
    return {
      schema: SCHEMA,
      settings: { currency: "AU$", business: "mixed", weekStart: "Mon", clock: "12", theme: "auto" },
      services: [], clients: [], appts: [], sales: [],
      meta: { created: HH.iso(HH.today()), lastBackup: null, reminderDismissed: null, sample: false, onboarded: false, nextId: 1 }
    };
  }
  function isInt(x) { return typeof x === "number" && isFinite(x) && Math.floor(x) === x; }
  function isDate(s) { return HH.parseIso(s) != null; }
  function isName(s, n) { return typeof s === "string" && s.length > 0 && s.length <= n; }
  function isText(s, n) { return typeof s === "string" && s.length <= n; }
  function isTime(s) { return tmin(s) != null; }
  function isBday(s) {
    var m = /^(\d{2})-(\d{2})$/.exec(String(s || ""));
    return !!m && +m[1] >= 1 && +m[1] <= 12 && +m[2] >= 1 && +m[2] <= HH.lastDay(2028, +m[1]);
  }
  function validate(d) {
    try {
      var s = d.settings, m = d.meta, i, j, x, ids = {};
      if (d.schema !== SCHEMA || !s || !m) return false;
      if (!["services", "clients", "appts", "sales"].every(function (k) { return Array.isArray(d[k]); })) return false;
      if (!isText(s.currency, 4) || !NOTE_FIELDS[s.business] || ["Mon", "Sun"].indexOf(s.weekStart) < 0) return false;
      if (["12", "24"].indexOf(s.clock) < 0 || ["auto", "light", "dark"].indexOf(s.theme) < 0) return false;
      if (!isDate(m.created) || !(m.lastBackup === null || isDate(m.lastBackup))) return false;
      if (!(m.reminderDismissed === null || isDate(m.reminderDismissed))) return false;
      if (typeof m.sample !== "boolean" || typeof m.onboarded !== "boolean" || !isInt(m.nextId)) return false;
      for (i = 0; i < d.services.length; i++) {
        x = d.services[i];
        if (!isInt(x.id) || !isName(x.name, 40) || !isInt(x.cents) || x.cents < 0) return false;
        if (!isInt(x.minutes) || x.minutes < 1 || x.minutes > 720 || !isInt(x.rebookWeeks) || x.rebookWeeks < 0 || x.rebookWeeks > 104) return false;
      }
      for (i = 0; i < d.clients.length; i++) {
        x = d.clients[i];
        if (!isInt(x.id) || !isName(x.name, 40) || !isText(x.phone, 30) || !isText(x.email, 80)) return false;
        if (!(x.bday === null || isBday(x.bday)) || !isText(x.allergies, 600) || !isText(x.notes, 600) || !Array.isArray(x.patches)) return false;
        for (j = 0; j < x.patches.length; j++) {
          var p = x.patches[j];
          if (!isInt(p.id) || !isDate(p.date) || !isName(p.product, 60) || !isText(p.result, 120) || !(p.next === null || isDate(p.next))) return false;
        }
        ids[x.id] = 1;
      }
      for (i = 0; i < d.appts.length; i++) {
        x = d.appts[i];
        if (!isInt(x.id) || !isInt(x.clientId) || !ids[x.clientId] || !(x.serviceId === null || isInt(x.serviceId))) return false;
        if (!isName(x.service, 40) || !isDate(x.date) || !isTime(x.time) || !isInt(x.minutes) || x.minutes < 1 || x.minutes > 720) return false;
        if (!isInt(x.cents) || x.cents < 0 || !isInt(x.tipCents) || x.tipCents < 0 || STATUS.indexOf(x.status) < 0 || !Array.isArray(x.notes)) return false;
        for (j = 0; j < x.notes.length; j++) if (!isName(x.notes[j].label, 40) || !isName(x.notes[j].text, 300)) return false;
      }
      for (i = 0; i < d.sales.length; i++) {
        x = d.sales[i];
        if (!isInt(x.id) || !isDate(x.date) || KINDS.indexOf(x.kind) < 0 || !isText(x.note, 60) || !isInt(x.cents) || x.cents <= 0) return false;
        if (!(x.clientId === null || (isInt(x.clientId) && ids[x.clientId]))) return false;
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
  function hasOwn() { return own(D.services) || own(D.clients) || own(D.appts) || own(D.sales); }
  function byId(list, id) { return list.filter(function (x) { return x.id === id; })[0]; }
  function clientOf(id) { return byId(D.clients, id); }
  function nameOf(id) { var c = clientOf(id); return c ? c.name : "A client"; }

  // ── time and wording ─────────────────────────────────────────────
  function pad(x) { return (x < 10 ? "0" : "") + x; }
  function tmin(s) {
    var p = /^(\d{2}):(\d{2})$/.exec(String(s || ""));
    if (!p || +p[1] > 23 || +p[2] > 59) return null;
    return +p[1] * 60 + +p[2];
  }
  function fmtTime(min) {
    min = HH.mod(min, 1440);
    var h = Math.floor(min / 60), mm = min % 60;
    if (D.settings.clock === "24") return pad(h) + ":" + pad(mm);
    return (h % 12 === 0 ? 12 : h % 12) + ":" + pad(mm) + " " + (h < 12 ? "am" : "pm");
  }
  function fmtHour(h) {
    if (D.settings.clock === "24") return pad(h % 24) + ":00";
    h = h % 24;
    return (h % 12 === 0 ? 12 : h % 12) + " " + (h < 12 ? "am" : "pm");
  }
  function startOf(a) { return tmin(a.time); }
  function range(a) { return fmtTime(startOf(a)) + " – " + fmtTime(startOf(a) + a.minutes); }
  function m(c) { return HH.money(c, D.settings.currency); }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
  function inDays(d, t) {
    var k = d - t;
    if (k === 0) return "today";
    if (k === 1) return "tomorrow";
    if (k > 1) return "in " + k + " days";
    if (k === -1) return "yesterday";
    return plural(-k, "day", "days") + " ago";
  }
  function dayOf(a) { return HH.parseIso(a.date); }
  function cmpAppt(a, b) { return dayOf(a) - dayOf(b) || startOf(a) - startOf(b) || a.id - b.id; }
  function apptsOn(d) { return D.appts.filter(function (a) { return dayOf(a) === d; }).sort(cmpAppt); }
  function counted(a) { return a.status === "Booked" || a.status === "Done"; }
  function notesLine(a) { return a.notes.map(function (n) { return n.label + ": " + n.text; }).join(" · "); }
  function byName(a, b) { var x = a.name.toLowerCase(), y = b.name.toLowerCase(); return x < y ? -1 : x > y ? 1 : a.id - b.id; }

  // ── rebook (the spec's rule) ─────────────────────────────────────
  function lastDone(clientId) {
    var best = null;
    D.appts.forEach(function (a) { if (a.clientId === clientId && a.status === "Done" && (!best || cmpAppt(a, best) > 0)) best = a; });
    return best;
  }
  function nextBooked(clientId, t) {
    var best = null;
    D.appts.forEach(function (a) { if (a.clientId === clientId && a.status === "Booked" && dayOf(a) >= t && (!best || cmpAppt(a, best) < 0)) best = a; });
    return best;
  }
  function weeksOf(serviceId) { var s = serviceId == null ? null : byId(D.services, serviceId); return s ? s.rebookWeeks : 0; }
  function rebookOf(c, t) {
    t = t == null ? T : t;
    var last = lastDone(c.id);
    if (!last) return { last: null, weeks: 0, due: null, booked: nextBooked(c.id, t) };
    var w = weeksOf(last.serviceId);
    return { last: last, weeks: w, due: w > 0 ? dayOf(last) + 7 * w : null, booked: nextBooked(c.id, t) };
  }
  function rebookList(t) {
    t = t == null ? T : t;
    var due = [], later = 0;
    D.clients.forEach(function (c) {
      var r = rebookOf(c, t);
      if (r.due == null || r.booked) return;
      if (r.due <= t + WINDOW) due.push({ c: c, r: r }); else later++;
    });
    due.sort(function (x, y) { return x.r.due - y.r.due || byName(x.c, y.c); });
    return { due: due, later: later };
  }
  function rbWhen(due) {
    if (due === T) return "Due back today";
    if (due > T) return "Due back " + HH.fmtDate(due) + " · " + inDays(due, T);
    return "Was due " + HH.fmtDate(due) + " · " + inDays(due, T);
  }

  // ── patch tests and birthdays ────────────────────────────────────
  function patchKey(p) { return p.product.trim().toLowerCase(); }
  function latestPatches(c) {
    var best = {};
    c.patches.forEach(function (p) {
      var k = patchKey(p), b = best[k];
      if (!b || HH.parseIso(p.date) > HH.parseIso(b.date) || (p.date === b.date && p.id > b.id)) best[k] = p;
    });
    return best;
  }
  function patchDueFor(c, t) {
    var out = [], best = latestPatches(c);
    for (var k in best) {
      var p = best[k];
      if (p.next && HH.parseIso(p.next) <= t + WINDOW) out.push(p);
    }
    return out;
  }
  function patchDue(t) {
    t = t == null ? T : t;
    var out = [];
    D.clients.forEach(function (c) { patchDueFor(c, t).forEach(function (p) { out.push({ c: c, p: p }); }); });
    out.sort(function (x, y) { return HH.parseIso(x.p.next) - HH.parseIso(y.p.next) || byName(x.c, y.c); });
    return out;
  }
  function bdayNext(c, t) {
    if (!c.bday) return null;
    var mo = +c.bday.slice(0, 2), da = +c.bday.slice(3, 5), y = HH.ymd(t).y;
    var d = HH.dn(y, mo, Math.min(da, HH.lastDay(y, mo)));
    if (d < t) d = HH.dn(y + 1, mo, Math.min(da, HH.lastDay(y + 1, mo)));
    return d;
  }
  function bdays(t) {
    var out = [];
    D.clients.forEach(function (c) { var d = bdayNext(c, t); if (d != null && d <= t + WINDOW) out.push({ c: c, d: d }); });
    out.sort(function (x, y) { return x.d - y.d || byName(x.c, y.c); });
    return out;
  }
  function bdayText(b) { return MO[+b.slice(0, 2) - 1] ? +b.slice(3, 5) + " " + MO[+b.slice(0, 2) - 1] : ""; }

  // ── weeks, months and income (the spec's rule) ───────────────────
  function wsDay() { return D.settings.weekStart === "Sun" ? 0 : 1; }
  function weekStartOf(d) { return d - HH.mod(HH.weekday(d) - wsDay(), 7); }
  function monthRange(d) { var a = HH.ymd(d); return { first: HH.dn(a.y, a.m, 1), last: HH.dn(a.y, a.m, HH.lastDay(a.y, a.m)) }; }
  function periodOf(mode, d) {
    if (mode === "month") return monthRange(d);
    var f = weekStartOf(d);
    return { first: f, last: f + 6 };
  }
  function incomeIn(first, last) {
    var r = { services: 0, tips: 0, products: 0, total: 0, done: 0, noShow: 0, cancelled: 0, booked: 0, rows: [] };
    D.appts.forEach(function (a) {
      var d = dayOf(a);
      if (d < first || d > last) return;
      if (a.status === "Done") { r.services += a.cents; r.tips += a.tipCents; r.done++; r.rows.push({ d: d, t: startOf(a), id: a.id, a: a }); }
      else if (a.status === "No-show") r.noShow++;
      else if (a.status === "Cancelled") r.cancelled++;
      else r.booked++;
    });
    D.sales.forEach(function (s) {
      var d = HH.parseIso(s.date);
      if (d < first || d > last) return;
      if (s.kind === "Tip") r.tips += s.cents; else r.products += s.cents;
      r.rows.push({ d: d, t: 1440, id: s.id, s: s });
    });
    r.total = r.services + r.tips + r.products;
    r.rows.sort(function (x, y) { return y.d - x.d || y.t - x.t || y.id - x.id; });
    return r;
  }
  function periodLabel(mode, p) {
    if (mode === "month") { var a = HH.ymd(p.first); return MONTHS[a.m - 1] + " " + a.y; }
    return "Week of " + HH.fmtDate(p.first, true);
  }
  function overlaps(dateIso, start, minutes, exceptId) {
    var d = HH.parseIso(dateIso), end = start + minutes;
    if (d == null || start == null) return [];
    return D.appts.filter(function (a) {
      return a.id !== exceptId && dayOf(a) === d && a.status !== "Cancelled" && a.status !== "No-show" &&
        start < startOf(a) + a.minutes && startOf(a) < end;
    }).sort(cmpAppt);
  }
  function blocks(frac) {
    var on = Math.max(0, Math.min(20, Math.round(frac * 20))), h = '<span class="blocks" aria-hidden="true">';
    for (var i = 0; i < 20; i++) h += '<i class="' + (i < on ? "on" : "") + '"></i>';
    return h + "</span>";
  }

  // ── rendering ────────────────────────────────────────────────────
  function render() {
    T = HH.today();
    HH.applyTheme(D.settings.theme);
    renderBanners();
    renderHome();
    renderCalendar();
    renderClients();
    renderClientView();
    renderRebook();
    renderIncome();
    renderServices();
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
      h += '<div class="banner slim" id="sample-banner"><span><span class="sample-flag">SAMPLE</span> · made-up clients</span>' +
        '<button type="button" class="btn btn-quiet" data-clear-sample>Clear sample</button></div>';
    } else if (D && D.meta.onboarded && hasOwn() && store.ok) {
      var since = HH.parseIso(D.meta.lastBackup || D.meta.created), dis = HH.parseIso(D.meta.reminderDismissed);
      if (T - since >= REMIND_DAYS && (dis == null || T - dis >= REMIND_DAYS)) {
        h += '<div class="banner" id="backup-banner"><strong>' + (D.meta.lastBackup ? "Your last backup was " +
          HH.fmtLong(since) + "." : "You haven't made a backup yet.") + "</strong>A backup is a small file with your whole client book, " +
          'in case the browser\'s data is ever cleared.<div class="row-buttons"><button type="button" class="btn btn-primary" data-backup>' +
          'Back up now</button><button type="button" class="btn btn-quiet" data-dismiss-backup>Not now</button></div></div>';
      }
    }
    $("#banners").innerHTML = h;
  }
  function statusTag(a) { return '<span class="tag st-' + ST_CLS[a.status] + '">' + esc(a.status) + "</span>"; }
  function apptItem(a, opt) {
    opt = opt || {};
    var who = esc(nameOf(a.clientId)) + " · " + esc(a.service);
    var sub = (opt.range ? range(a) + " · " : "") + plural(a.minutes, "min", "min") + " · " + m(a.cents) +
      (a.status === "Done" && a.tipCents ? " + " + m(a.tipCents) + " tip" : "");
    return '<div class="appt st-' + ST_CLS[a.status] + '" data-appt="' + a.id + '"><button type="button" class="rowbtn" data-edit-appt="' + a.id +
      '" aria-label="Change ' + esc(nameOf(a.clientId) + " " + a.service + " " + fmtTime(startOf(a))) + '">' +
      (opt.range ? "" : '<span class="time">' + fmtTime(startOf(a)) + "</span>") +
      '<span class="what"><b>' + who + '</b><br><span class="small muted">' + sub + "</span> " + statusTag(a) + "</span>" +
      '<span class="chev" aria-hidden="true">›</span></button>' +
      (opt.doneBtn && a.status === "Booked" ? '<button type="button" class="btn btn-quiet" data-done-appt="' + a.id + '">Done</button>' : "") + "</div>";
  }
  function renderHome() {
    var list = apptsOn(T), n = list.filter(function (a) { return a.status !== "Cancelled"; }).length;
    var done = list.filter(function (a) { return a.status === "Done"; }).length;
    $("#today-label").textContent = "Today · " + HH.fmtDate(T);
    $("#today-count").textContent = String(n);
    $("#today-cap").textContent = (n === 1 ? "appointment" : "appointments") + (n ? " · " + done + " done" : " booked so far");
    $("#today-list").innerHTML = list.map(function (a) { return "<li>" + apptItem(a, { doneBtn: true }) + "</li>"; }).join("");
    $("#today-none").hidden = list.length > 0;
    var rb = rebookList();
    $("#hc-rebook-line").textContent = rb.due.length ? plural(rb.due.length, "client", "clients") + " due back in the next two weeks or already due"
      : "Nobody due in the next two weeks";
    $("#hc-rebook-list").innerHTML = rb.due.slice(0, 3).map(function (x) {
      return "<li><span>" + esc(x.c.name) + '</span><span class="muted small">' + esc(rbShort(x.r.due)) + "</span></li>";
    }).join("");
    var p = periodOf("week", T), inc = incomeIn(p.first, p.last);
    $("#hc-income-line").innerHTML = '<b class="serif" style="font-size:1.5rem">' + esc(m(inc.total)) + '</b> <span class="small muted">' +
      esc(plural(inc.done, "appointment", "appointments")) + " done</span>";
    $("#hc-income-list").innerHTML = [["Services", inc.services], ["Tips", inc.tips], ["Product sales", inc.products]].map(function (r) {
      return "<li><span>" + r[0] + "</span><b>" + esc(m(r[1])) + "</b></li>";
    }).join("");
    var pd = patchDue();
    $("#hc-patch-line").textContent = pd.length ? plural(pd.length, "patch test", "patch tests") + " due in the next two weeks" : "None due in the next two weeks";
    $("#hc-patch-list").innerHTML = pd.slice(0, 3).map(function (x) {
      return "<li><span>" + esc(x.c.name + " · " + x.p.product + " · due " + HH.fmtDate(HH.parseIso(x.p.next)) + " · " + inDays(HH.parseIso(x.p.next), T)) + "</span></li>";
    }).join("");
    var bd = bdays(T);
    $("#hc-bday-line").textContent = bd.length ? plural(bd.length, "birthday", "birthdays") + " in the next two weeks" : "None in the next two weeks";
    $("#hc-bday-list").innerHTML = bd.slice(0, 3).map(function (x) {
      return "<li><span>" + esc(x.c.name) + '</span><span class="muted small">' + esc(HH.fmtDate(x.d) + " · " + inDays(x.d, T)) + "</span></li>";
    }).join("");
  }
  function rbShort(due) {
    if (due === T) return "due today";
    return due > T ? "due " + inDays(due, T) : "was due " + inDays(due, T);
  }
  function renderCalendar() {
    if (calDay == null) calDay = T;
    $$('input[name="calmode"]').forEach(function (r) { r.checked = r.value === calMode; });
    HH.setDate($("#cal-date"), HH.iso(calDay));
    $("#cal-week").hidden = calMode !== "week";
    $("#cal-day").hidden = calMode !== "day";
    var first = calMode === "week" ? weekStartOf(calDay) : calDay, last = calMode === "week" ? first + 6 : calDay;
    var inRange = D.appts.filter(function (a) { var d = dayOf(a); return d >= first && d <= last; });
    var live = inRange.filter(counted), value = 0, cx = 0, nx = 0;
    live.forEach(function (a) { value += a.cents; });
    inRange.forEach(function (a) { if (a.status === "Cancelled") cx++; if (a.status === "No-show") nx++; });
    $("#cal-summary").textContent = plural(live.length, "appointment", "appointments") + " · " + m(value) +
      (cx ? " · " + cx + " cancelled" : "") + (nx ? " · " + plural(nx, "no-show", "no-shows") : "");
    if (calMode === "week") {
      $("#cal-title").textContent = "Week of " + HH.fmtDate(first, true);
      var h = "";
      for (var d = first; d <= last; d++) {
        var list = apptsOn(d), nn = list.filter(counted).length;
        h += '<div class="day' + (d === T ? " today" : "") + '" data-day="' + HH.iso(d) + '"><button type="button" class="rowbtn dayhead" data-cal-day="' + d +
          '"><span class="dn">' + HH.fmtDate(d) + (d === T ? " · today" : "") + '</span><span class="small muted">' +
          (list.length ? plural(nn, "appointment", "appointments") : "") + ' ›</span></button>' +
          (list.length ? list.map(function (a) { return apptItem(a); }).join("") : '<p class="free">Free</p>') + "</div>";
      }
      $("#cal-week").innerHTML = h;
    } else {
      $("#cal-title").textContent = HH.fmtDate(calDay, true) + (calDay === T ? " · today" : "");
      var dl = apptsOn(calDay), h0 = 9, h1 = 17;
      dl.forEach(function (a) { var s = Math.floor(startOf(a) / 60); h0 = Math.min(h0, s); h1 = Math.max(h1, s); });
      var out = "";
      for (var hr = h0; hr <= h1; hr++) {
        var at = dl.filter(function (a) { return Math.floor(startOf(a) / 60) === hr; });
        out += '<div class="hour" data-hour="' + hr + '"><span class="h">' + fmtHour(hr) + '</span><div class="slot">' +
          at.map(function (a) { return apptItem(a, { range: true }); }).join("") + "</div></div>";
      }
      $("#cal-day").innerHTML = out;
    }
  }
  function clientTags(c) {
    var t = [], nb = nextBooked(c.id, T), r = rebookOf(c, T);
    if (nb) t.push("next " + HH.fmtDate(dayOf(nb)));
    if (r.due != null && !r.booked && r.due <= T + WINDOW) t.push("due to rebook");
    if (patchDueFor(c, T).length) t.push("patch test due");
    if (c.allergies.trim()) t.push("allergies noted");
    return t;
  }
  function renderClients() {
    var q = search.trim().toLowerCase(), qd = q.replace(/\D/g, "");
    var list = D.clients.filter(function (c) {
      return !q || c.name.toLowerCase().indexOf(q) >= 0 || (qd.length >= 3 && c.phone.replace(/\D/g, "").indexOf(qd) >= 0);
    }).sort(byName);
    $("#client-list").innerHTML = list.map(function (c) {
      var last = lastDone(c.id);
      var line = (c.phone ? esc(c.phone) + " · " : "") + (last ? "last visit " + HH.fmtDate(dayOf(last)) + " · " + esc(last.service) : "no visits yet");
      return '<li class="client-row" data-client="' + c.id + '"><button type="button" class="rowbtn" data-view-client="' + c.id + '" aria-label="Open ' +
        esc(c.name) + '"><span class="what"><b>' + esc(c.name) + '</b><br><span class="small muted">' + line + "</span><br>" +
        clientTags(c).map(function (x) { return '<span class="tag">' + esc(x) + "</span>"; }).join("") +
        '</span><span class="chev" aria-hidden="true">›</span></button></li>';
    }).join("");
    $("#client-none").hidden = list.length > 0;
    $("#client-none").textContent = D.clients.length ? "No client matches that." : "No clients yet.";
  }
  function renderClientView() {
    var c = viewClient && clientOf(viewClient.id);
    if (!c) return;
    viewClient = c;
    $("#cv-name").textContent = c.name;
    var rows = [];
    if (c.phone) rows.push(["Phone", esc(c.phone)]);
    if (c.email) rows.push(["Email", esc(c.email)]);
    if (c.bday) { var nb = bdayNext(c, T); rows.push(["Birthday", esc(bdayText(c.bday) + " · " + inDays(nb, T))]); }
    $("#cv-contact").innerHTML = '<div class="contact">' + (rows.length ? rows.map(function (r) {
      return '<div class="stat"><span>' + r[0] + "</span><b>" + r[1] + "</b></div>";
    }).join("") : '<p class="muted small">No contact details yet.</p>') + "</div>" +
      (c.notes.trim() ? '<p class="quote" id="cv-notes" style="margin-top:8px">' + esc(c.notes) + "</p>" : "");
    if (c.allergies.trim()) { $("#cv-allergies").className = "quote"; $("#cv-allergies").textContent = c.allergies; }
    else { $("#cv-allergies").className = "muted"; $("#cv-allergies").textContent = "Nothing noted."; }
    var best = latestPatches(c);
    var ps = c.patches.slice().sort(function (a, b) { return HH.parseIso(b.date) - HH.parseIso(a.date) || b.id - a.id; });
    $("#cv-patch-list").innerHTML = ps.map(function (p) {
      var latest = best[patchKey(p)] === p, nx = p.next ? HH.parseIso(p.next) : null;
      var tag = !latest ? '<span class="tag">a newer test is noted</span>' : nx != null ? '<span class="tag' + (nx <= T + WINDOW ? " done" : "") +
        '">next due ' + HH.fmtDate(nx) + " · " + inDays(nx, T) + "</span>" : '<span class="tag">no next date</span>';
      return '<li data-patch="' + p.id + '"><button type="button" class="rowbtn" data-edit-patch="' + p.id + '" aria-label="Change patch test ' + esc(p.product) +
        '"><span class="what"><b>' + esc(p.product) + '</b><br><span class="small muted">Tested ' + HH.fmtDate(HH.parseIso(p.date), true) +
        (p.result ? " · " + esc(p.result) : "") + "</span><br>" + tag + '</span><span class="chev" aria-hidden="true">›</span></button></li>';
    }).join("");
    $("#cv-patch-none").hidden = ps.length > 0;
    var r = rebookOf(c, T), line;
    if (!r.last) line = "No done appointments yet.";
    else if (r.due == null) line = "Last visit " + HH.fmtDate(dayOf(r.last), true) + " · " + r.last.service + ". That service has no rebook reminder.";
    else line = rbWhen(r.due) + " (" + plural(r.weeks, "week", "weeks") + " after " + r.last.service + " on " + HH.fmtDate(dayOf(r.last)) + ").";
    if (r.booked) line += " Booked: " + HH.fmtDate(dayOf(r.booked)) + " at " + fmtTime(startOf(r.booked)) + " · " + r.booked.service + ".";
    $("#cv-rebook").textContent = line;
    var vs = D.appts.filter(function (a) { return a.clientId === c.id; }).sort(function (a, b) { return cmpAppt(b, a); });
    $("#cv-visits").innerHTML = vs.map(function (a) {
      var nl = notesLine(a);
      return '<li data-visit="' + a.id + '"><button type="button" class="rowbtn" data-edit-appt="' + a.id + '" aria-label="Change ' + esc(a.service) +
        '"><span class="what"><b>' + esc(a.service) + "</b> " + statusTag(a) + '<br><span class="small muted">' + HH.fmtDate(dayOf(a), true) + " · " +
        fmtTime(startOf(a)) + " · " + m(a.cents) + (a.tipCents && a.status === "Done" ? " + " + m(a.tipCents) + " tip" : "") + "</span>" +
        (nl ? '<span class="visit-notes small">' + esc(nl) + "</span>" : "") + '</span><span class="chev" aria-hidden="true">›</span></button></li>';
    }).join("");
    $("#cv-visits-none").hidden = vs.length > 0;
  }
  function renderRebook() {
    var rb = rebookList();
    $("#rb-list").innerHTML = rb.due.map(function (x) {
      return '<li data-rebook="' + x.c.id + '"><span class="what"><b>' + esc(x.c.name) + '</b><br><span class="small muted">' + esc(x.r.last.service) +
        " · last visit " + HH.fmtDate(dayOf(x.r.last)) + '</span><br><span class="small rb-when">' + esc(rbWhen(x.r.due)) + "</span></span>" +
        '<button type="button" class="btn btn-quiet" data-rebook-book="' + x.c.id + '">Book</button></li>';
    }).join("");
    $("#rb-none").hidden = rb.due.length > 0;
    $("#rb-later").hidden = !rb.later;
    $("#rb-later").textContent = plural(rb.later, "more client", "more clients") + " due later than " + HH.fmtDate(T + WINDOW) + ".";
  }
  function renderIncome() {
    if (incDay == null) incDay = T;
    $$('input[name="incmode"]').forEach(function (r) { r.checked = r.value === incMode; });
    var p = periodOf(incMode, incDay), r = incomeIn(p.first, p.last);
    $("#inc-title").textContent = periodLabel(incMode, p);
    $("#inc-total").textContent = m(r.total);
    $("#inc-services").textContent = m(r.services);
    $("#inc-done").textContent = "· " + r.done + " done";
    $("#inc-tips").textContent = m(r.tips);
    $("#inc-products").textContent = m(r.products);
    var parts = [r.done + " done"];
    if (r.noShow) parts.push(plural(r.noShow, "no-show", "no-shows"));
    if (r.cancelled) parts.push(r.cancelled + " cancelled");
    if (r.booked) parts.push(r.booked + " booked");
    $("#inc-counts").textContent = parts.join(" · ") + (r.noShow || r.cancelled || r.booked ? ". Only done appointments count." : "");
    $("#inc-now").textContent = incMode === "week" ? "This week" : "This month";
    $("#inc-list-head").textContent = incMode === "week" ? "This week's entries" : "This month's entries";
    $("#inc-list").innerHTML = r.rows.map(function (x) {
      if (x.a) {
        var a = x.a;
        return '<li data-inc="appt-' + a.id + '"><button type="button" class="rowbtn" data-edit-appt="' + a.id + '" aria-label="Change ' + esc(a.service) +
          '"><span class="what"><b>' + esc(nameOf(a.clientId)) + " · " + esc(a.service) + '</b><br><span class="small muted">' + HH.fmtDate(x.d) + " · " +
          m(a.cents) + (a.tipCents ? " + " + m(a.tipCents) + " tip" : "") + '</span></span><span class="amt">' + m(a.cents + a.tipCents) +
          '</span><span class="chev" aria-hidden="true">›</span></button></li>';
      }
      var s = x.s;
      return '<li data-inc="sale-' + s.id + '"><button type="button" class="rowbtn" data-edit-sale="' + s.id + '" aria-label="Change ' + esc(s.kind) +
        '"><span class="what"><b>' + esc(s.kind) + (s.note ? " · " + esc(s.note) : "") + '</b><br><span class="small muted">' + HH.fmtDate(x.d) +
        (s.clientId ? " · " + esc(nameOf(s.clientId)) : "") + '</span></span><span class="amt">' + m(s.cents) +
        '</span><span class="chev" aria-hidden="true">›</span></button></li>';
    }).join("");
    $("#inc-none").hidden = r.rows.length > 0;
    $("#inc-none").textContent = incMode === "week" ? "Nothing in this week yet." : "Nothing in this month yet.";
    // week by week (8) or month by month (6), ending with the period shown
    var hist = [], k, q;
    if (incMode === "week") {
      for (k = 7; k >= 0; k--) { q = periodOf("week", p.first - 7 * k); hist.push({ label: "Week of " + HH.fmtDate(q.first), r: incomeIn(q.first, q.last) }); }
    } else {
      for (k = 5; k >= 0; k--) { q = monthRange(HH.addMonths(p.first, -k)); hist.push({ label: periodLabel("month", q), r: incomeIn(q.first, q.last) }); }
    }
    var max = 0;
    hist.forEach(function (x) { max = Math.max(max, x.r.total); });
    $("#inc-hist-head").textContent = incMode === "week" ? "Week by week" : "Month by month";
    $("#inc-history").innerHTML = hist.reverse().map(function (x) {
      return '<li><span class="what"><b>' + esc(x.label) + "</b><br>" + blocks(max ? x.r.total / max : 0) + '</span><span class="amt">' + m(x.r.total) + "</span></li>";
    }).join("");
  }
  function svcLine(s) {
    return m(s.cents) + " · " + s.minutes + " min · " + (s.rebookWeeks ? "rebook every " + plural(s.rebookWeeks, "week", "weeks") : "no rebook reminder");
  }
  function svcItem(s) {
    return '<li data-svc="' + s.id + '"><button type="button" class="rowbtn" data-edit-svc="' + s.id + '" aria-label="Change ' + esc(s.name) +
      '"><span class="what"><b>' + esc(s.name) + '</b><br><span class="small muted">' + esc(svcLine(s)) +
      '</span></span><span class="chev" aria-hidden="true">›</span></button></li>';
  }
  function renderServices() {
    $("#svc-list").innerHTML = D.services.map(svcItem).join("");
    $("#svc-none").hidden = D.services.length > 0;
    $("#w-svc-list").innerHTML = $("#svc-list").innerHTML;
    $("#w-svc-none").hidden = D.services.length > 0;
  }
  function chipSet(el, name, items, value) {
    el.innerHTML = items.map(function (it) {
      return '<label class="chip"><input type="radio" name="' + name + '" value="' + esc(it[0]) + '"' + (it[0] === value ? " checked" : "") +
        "><span>" + esc(it[1]) + "</span></label>";
    }).join("");
  }
  function curItems() { return CURRENCIES.map(function (c) { return [c, c]; }).concat([["own", "Your own"]]); }
  function renderSettings() {
    var s = D.settings, ownCur = CURRENCIES.indexOf(s.currency) < 0;
    chipSet($("#s-biz"), "biz", BIZ, s.business);
    $("#s-biz-fields").textContent = "Note fields: " + NOTE_FIELDS[s.business].join(", ") + ".";
    chipSet($("#s-cur"), "cur", curItems(), ownCur ? "own" : s.currency);
    $("#s-cur-own-wrap").hidden = !ownCur;
    if (ownCur) $("#s-cur-own").value = s.currency;
    chipSet($("#s-ws"), "ws", [["Mon", "Monday"], ["Sun", "Sunday"]], s.weekStart);
    chipSet($("#s-clock"), "clock", [["12", "1:30 pm"], ["24", "13:30"]], s.clock);
    $$('input[name="theme"]').forEach(function (r) { r.checked = r.value === s.theme; });
    $("#last-backup").textContent = D.meta.lastBackup ? "Last backup: " + HH.fmtLong(HH.parseIso(D.meta.lastBackup)) : "No backup made yet.";
    $("#sample-state").textContent = D.meta.sample ? "Sample data is on: the clients in the app are made up." :
      "Sample data is off. You can load made-up clients to look around while the app is empty.";
    $("#sample-btn").textContent = D.meta.sample ? "Clear the sample data" : "Load sample data";
  }
  function go(id) {
    render();
    HH.show(id);
    $("#tabs").hidden = id === "welcome" || (id === "svc-edit" && svcReturn === "welcome");
  }

  // ── first run ────────────────────────────────────────────────────
  function welcomeStep(k) {
    [1, 2, 3].forEach(function (i) {
      $("#welcome-" + i).hidden = i !== k;
      $("#st" + i).classList.toggle("on", i <= k);
    });
    var h1 = $("#welcome-" + k + " h1");
    if (h1) { h1.setAttribute("tabindex", "-1"); h1.focus(); }
  }
  function startWelcome() {
    go("welcome");
    var s = D.settings, ownCur = CURRENCIES.indexOf(s.currency) < 0;
    chipSet($("#w-biz"), "wbiz", BIZ, s.business);
    chipSet($("#w-cur"), "wcur", curItems(), ownCur ? "own" : s.currency);
    chipSet($("#w-ws"), "wws", [["Mon", "Monday"], ["Sun", "Sunday"]], s.weekStart);
    $("#w-cur-own-wrap").hidden = !ownCur;
    $("#w-cur-own").value = ownCur ? s.currency : "";
    $("#w-err").hidden = true;
    welcomeStep(1);
  }
  function checked(name) { return ($$('input[name="' + name + '"]').filter(function (r) { return r.checked; })[0] || {}).value; }
  function finishWelcome() {
    D.meta.onboarded = true;
    save();
    go("home");
  }

  // ── sample data (moves with today) ───────────────────────────────
  function loadSample() {
    var t = HH.today(), id = 1, d = blank();
    var keep = D ? D.settings : d.settings;
    d.settings = { currency: keep.currency, business: "mixed", weekStart: keep.weekStart, clock: keep.clock, theme: keep.theme };
    var S = {};
    [["gel", "Gel nails", 6500, 60, 3], ["acr", "Acrylic full set", 8500, 90, 3], ["inf", "Nail infill", 5500, 60, 2],
     ["cls", "Classic lash set", 12000, 120, 3], ["lin", "Lash infill", 7000, 60, 2], ["lft", "Lash lift and tint", 9000, 60, 6],
     ["lam", "Brow lamination", 8500, 45, 6], ["wax", "Brow wax and tint", 4500, 30, 4], ["fac", "Express facial", 6000, 30, 4],
     ["pt", "Patch test visit", 0, 15, 0]].forEach(function (r) {
      var s = { id: id++, name: r[1], cents: r[2], minutes: r[3], rebookWeeks: r[4], sample: true };
      S[r[0]] = s;
      d.services.push(s);
    });
    var md = function (k) { var a = HH.ymd(t + k); return pad(a.m) + "-" + pad(a.d); };
    var C = {};
    [["mia", "Mia R.", "0400 000 101", "mia@example.com", md(6), "Says latex gloves make their hands itchy.", "Prefers short almond nails. Likes a quiet appointment."],
     ["oli", "Olivia T.", "0400 000 102", "olivia@example.com", "04-17", "", "Usually books Saturday mornings."],
     ["ava", "Ava K.", "0400 000 103", "", "09-02", "Told me strong glue fumes make their eyes water.", "Natural look, nothing too long."],
     ["gra", "Grace L.", "0400 000 104", "grace@example.com", null, "", "Likes a softer arch."],
     ["chl", "Chloe M.", "0400 000 105", "", "12-30", "", ""],
     ["rub", "Ruby S.", "0400 000 106", "ruby@example.com", "06-21", "Says fragranced creams make their skin go red.", "Prefers a gentle facial."],
     ["zoe", "Zoe P.", "0400 000 107", "", null, "", "Brings their own design ideas."],
     ["emm", "Emma W.", "0400 000 108", "emma@example.com", "02-11", "", ""],
     ["sop", "Sophie D.", "0400 000 109", "", md(11), "", "Prefers neutral colours."],
     ["isl", "Isla B.", "0400 000 110", "isla@example.com", "10-05", "", ""],
     ["sam", "Sam C.", "0400 000 111", "", null, "", ""],
     ["jor", "Jordan H.", "0400 000 112", "jordan@example.com", "08-14", "", "Evening appointments suit them best."],
     ["pri", "Priya N.", "0400 000 113", "priya@example.com", null, "", "New client. Patch tested before the first set."]].forEach(function (r) {
      var c = { id: id++, name: r[1], phone: r[2], email: r[3], bday: r[4], allergies: r[5], notes: r[6], patches: [], sample: true };
      C[r[0]] = c;
      d.clients.push(c);
    });
    [["ava", -200, "Lash glue", "No reaction at 48 hours", 5], ["chl", -170, "Lash lift lotion and tint", "No redness at 48 hours", 10],
     ["emm", -30, "Brow tint", "No reaction at 48 hours", 150], ["isl", -20, "Lash glue", "No reaction at 48 hours", 160],
     ["pri", -4, "Lash glue, behind the ear", "No redness at 48 hours", 180], ["rub", -60, "Mask, inner arm", "No redness at 48 hours", null]
    ].forEach(function (r) {
      C[r[0]].patches.push({ id: id++, date: HH.iso(t + r[1]), product: r[2], result: r[3], next: r[4] == null ? null : HH.iso(t + r[4]) });
    });
    var N = function (pairs) { return pairs.map(function (p) { return { label: p[0], text: p[1] }; }); };
    [["mia", "gel", -63, "10:00", "Done", 0, []], ["mia", "gel", -42, "10:00", "Done", 500, N([["Nail shape and colour", "Almond, nude pink"]])],
     ["mia", "gel", -21, "10:00", "Done", 1000, N([["Nail shape and colour", "Almond, soft pink with a fine glitter tip"]])],
     ["oli", "gel", -45, "11:00", "Done", 0, []], ["oli", "gel", -24, "11:00", "Done", 500, N([["Nail shape and colour", "Square, berry red"]])],
     ["ava", "cls", -54, "13:00", "Done", 1500, N([["Lash map", "Natural, 8 to 11 mm, C curl"]])], ["ava", "lin", -26, "13:00", "Done", 0, []],
     ["ava", "lin", -12, "13:00", "Done", 500, N([["Lash map", "Natural, 8 to 11 mm, C curl"], ["Notes", "Filled about 40 per cent"]])],
     ["gra", "wax", -26, "09:30", "Done", 0, N([["Formula", "Dark brown, 5 minutes"], ["Brow notes", "Softer arch, tails left long"]])],
     ["gra", "wax", -8, "09:30", "Cancelled", 0, []],
     ["chl", "lft", -80, "15:00", "Done", 0, []], ["chl", "lft", -38, "15:00", "Done", 1000, N([["Formula", "Lift 8 minutes, set 6, tint black 5"]])],
     ["rub", "fac", -57, "16:00", "Done", 0, []], ["rub", "fac", -29, "16:00", "Done", 0, N([["Notes", "Unscented products only, as they asked"]])],
     ["zoe", "inf", -35, "12:00", "Done", 0, []], ["zoe", "acr", -14, "12:00", "Done", 1000, N([["Nail shape and colour", "Long coffin, chrome"]])],
     ["emm", "lam", -10, "10:30", "Done", 0, N([["Brow notes", "Laminated, set 8 minutes, tinted soft brown"]])],
     ["sop", "gel", -28, "14:00", "Done", 0, []], ["sop", "gel", -7, "14:00", "Done", 500, N([["Nail shape and colour", "Oval, milky white"]])],
     ["isl", "cls", -3, "11:30", "Done", 1500, N([["Lash map", "Doll eye, 9 to 12 mm, D curl"]])],
     ["sam", "wax", -40, "17:00", "Done", 0, []], ["sam", "wax", -5, "17:00", "No-show", 0, []],
     ["jor", "fac", -2, "15:00", "Done", 0, N([["Notes", "Hydrating mask, 20 minutes"]])],
     ["pri", "pt", -4, "16:30", "Done", 0, []],
     ["emm", "wax", 0, "09:30", "Done", 500, N([["Formula", "Soft brown, 4 minutes"]])], ["mia", "gel", 0, "11:00", "Booked", 0, []],
     ["pri", "cls", 0, "13:00", "Booked", 0, []], ["zoe", "inf", 0, "15:30", "Booked", 0, []],
     ["oli", "gel", 1, "10:00", "Booked", 0, []], ["zoe", "inf", 14, "12:00", "Booked", 0, []], ["mia", "gel", 21, "11:00", "Booked", 0, []],
     ["oli", "wax", -1, "16:00", "Done", 0, []], ["mia", "fac", -2, "12:30", "Done", 500, []], ["oli", "fac", 2, "14:00", "Booked", 0, []],
     ["zoe", "wax", 3, "10:30", "Booked", 0, []], ["pri", "lam", 4, "12:00", "Booked", 0, []], ["oli", "lft", 5, "15:00", "Booked", 0, []],
     ["pri", "lin", 6, "11:00", "Booked", 0, []]
    ].forEach(function (r) {
      var s = S[r[1]];
      d.appts.push({ id: id++, clientId: C[r[0]].id, serviceId: s.id, service: s.name, date: HH.iso(t + r[2]), time: r[3], minutes: s.minutes,
                     cents: s.cents, tipCents: r[5], status: r[4], notes: r[6], sample: true });
    });
    [[-1, "Product sale", "Cuticle oil", 2450, "sop"], [-3, "Product sale", "Lash cleanser", 2800, "isl"], [-9, "Product sale", "Brow gel", 2200, "emm"],
     [-16, "Product sale", "Hand cream", 1800, null], [-4, "Tip", "Left in the tip jar", 1000, null], [0, "Product sale", "Gift voucher", 5000, null],
     [-30, "Product sale", "Lash cleanser", 2800, "chl"]].forEach(function (r) {
      d.sales.push({ id: id++, date: HH.iso(t + r[0]), kind: r[1], note: r[2], cents: r[3], clientId: r[4] ? C[r[4]].id : null, sample: true });
    });
    d.meta.sample = true;
    d.meta.onboarded = true;
    d.meta.nextId = id;
    D = d;
    calDay = null; incDay = null; viewClient = null;
    save();
    go("home");
    HH.toast("Sample data loaded. Clear it any time.", null, 4000);
  }
  function clearSample() {
    var keep = {}, s = D.settings, next = D.meta.nextId;
    ["services", "clients", "appts", "sales"].forEach(function (k) { keep[k] = D[k].filter(function (x) { return !x.sample; }); });
    D = blank();
    D.settings.theme = s.theme; D.settings.currency = s.currency; D.settings.weekStart = s.weekStart; D.settings.clock = s.clock;
    for (var k in keep) D[k] = keep[k];
    var ids = {};
    D.clients.forEach(function (c) { ids[c.id] = 1; });
    D.appts = D.appts.filter(function (a) { return ids[a.clientId]; });
    D.sales.forEach(function (x) { if (x.clientId != null && !ids[x.clientId]) x.clientId = null; });
    D.meta.nextId = next;
    viewClient = null; calDay = null; incDay = null;
    save();
    startWelcome();
  }

  // ── appointments ─────────────────────────────────────────────────
  function fillClientSelect(sel, value, withNew, noneLabel) {
    var list = D.clients.slice().sort(byName);
    sel.innerHTML = '<option value="">' + esc(noneLabel) + "</option>" + list.map(function (c) {
      return '<option value="' + c.id + '">' + esc(c.name) + "</option>";
    }).join("") + (withNew ? '<option value="new">+ New client</option>' : "");
    sel.value = value == null ? "" : String(value);
  }
  function fillServiceSelect(value, extraName) {
    var opts = D.services.map(function (s) { return '<option value="' + s.id + '">' + esc(s.name) + "</option>"; });
    if (extraName) opts.push('<option value="keep">' + esc(extraName) + "</option>");
    opts.push('<option value="other">Something else</option>');
    $("#ap-service").innerHTML = opts.join("");
    $("#ap-service").value = value;
  }
  function noteFieldsFor(a) {
    var f = NOTE_FIELDS[D.settings.business].slice();
    if (a) a.notes.forEach(function (n) { if (f.indexOf(n.label) < 0) f.push(n.label); });
    return f;
  }
  function renderNoteFields(a) {
    $("#ap-notes").innerHTML = noteFieldsFor(a).map(function (lab, i) {
      var have = a ? a.notes.filter(function (n) { return n.label === lab; })[0] : null;
      return '<label for="ap-note-' + i + '">' + esc(lab) + '</label><input id="ap-note-' + i + '" type="text" maxlength="300" autocomplete="off" data-label="' +
        esc(lab) + '" value="' + esc(have ? have.text : "") + '">';
    }).join("");
  }
  function openAppt(a, from, pre) {
    editingAppt = a || null;
    apReturn = from || "home";
    pre = pre || {};
    $("#ap-title").textContent = a ? "Change appointment" : "New appointment";
    var cid = a ? a.clientId : pre.clientId != null ? pre.clientId : (D.clients.length ? null : "new");
    fillClientSelect($("#ap-client"), cid, true, "Pick a client");
    $("#ap-client-new").value = "";
    $("#ap-client-new-wrap").hidden = $("#ap-client").value !== "new";
    var svc;
    if (a) svc = a.serviceId != null && byId(D.services, a.serviceId) ? String(a.serviceId) : "keep";
    else if (pre.serviceId != null && byId(D.services, pre.serviceId)) svc = String(pre.serviceId);
    else svc = D.services.length ? String(D.services[0].id) : "other";
    fillServiceSelect(svc, a && svc === "keep" ? a.service : null);
    $("#ap-service-other").value = "";
    $("#ap-service-other-wrap").hidden = svc !== "other";
    HH.setDate($("#ap-date"), a ? a.date : HH.iso(pre.date != null ? pre.date : T));
    $("#ap-time").value = a ? a.time : (pre.time || "10:00");
    if (a) { $("#ap-minutes").value = String(a.minutes); $("#ap-price").value = HH.plain(a.cents); }
    else serviceDefaults();
    chipSet($("#ap-status"), "apstatus", STATUS.map(function (s) { return [s, s]; }), a ? a.status : "Booked");
    $("#ap-tip").value = a && a.tipCents ? HH.plain(a.tipCents) : "";
    renderNoteFields(a);
    $("#ap-err").hidden = true;
    $("#ap-delete").hidden = !a;
    go("appt");
    apLive();
  }
  function serviceDefaults() {
    var s = byId(D.services, +$("#ap-service").value);
    if (s) { $("#ap-minutes").value = String(s.minutes); $("#ap-price").value = HH.plain(s.cents); }
    else if ($("#ap-service").value === "other" && !$("#ap-minutes").value) $("#ap-minutes").value = "60";
  }
  function parseMinutes(v) { v = String(v || "").trim(); return /^\d{1,3}$/.test(v) && +v >= 1 && +v <= 720 ? +v : null; }
  function apLive() {
    var st = checked("apstatus") || "Booked", start = tmin($("#ap-time").value), mins = parseMinutes($("#ap-minutes").value);
    var ov = st === "Cancelled" || st === "No-show" || start == null || mins == null ? [] :
      overlaps($("#ap-date").value, start, mins, editingAppt ? editingAppt.id : null);
    $("#ap-overlap").hidden = !ov.length;
    $("#ap-overlap").textContent = ov.length ? "This overlaps with " + ov.map(function (a) { return nameOf(a.clientId) + " at " + fmtTime(startOf(a)); }).join(" and ") + "." : "";
    var s = byId(D.services, +$("#ap-service").value), d = HH.parseIso($("#ap-date").value);
    var w = s ? s.rebookWeeks : $("#ap-service").value === "keep" && editingAppt ? weeksOf(editingAppt.serviceId) : 0;
    var show = st === "Done" && w > 0 && d != null;
    $("#ap-rebook-line").hidden = !show;
    $("#ap-rebook-line").textContent = show ? "Due back in " + plural(w, "week", "weeks") + ": " + HH.fmtDate(d + 7 * w) : "";
    $("#ap-client-new-wrap").hidden = $("#ap-client").value !== "new";
    $("#ap-service-other-wrap").hidden = $("#ap-service").value !== "other";
  }
  function apErr(t) { $("#ap-err").textContent = t; $("#ap-err").hidden = false; }
  function saveAppt(ev) {
    ev.preventDefault();
    var cv = $("#ap-client").value, newName = $("#ap-client-new").value.trim().slice(0, 40), sv = $("#ap-service").value;
    var other = $("#ap-service-other").value.trim().slice(0, 40), date = HH.parseIso($("#ap-date").value), start = tmin($("#ap-time").value);
    var mins = parseMinutes($("#ap-minutes").value), price = HH.parseMoney($("#ap-price").value);
    var tipTxt = $("#ap-tip").value.trim(), tip = tipTxt === "" ? 0 : HH.parseMoney(tipTxt), st = checked("apstatus") || "Booked";
    if (cv === "" || (cv === "new" && !newName)) return apErr(cv === "new" ? "Type the new client's name." : "Pick a client, or choose + New client and type their name.");
    if (sv === "other" && !other) return apErr("Type what the appointment is for, or pick a service.");
    if (date == null) return apErr("Pick the day.");
    if (start == null) return apErr("Pick a start time.");
    if (mins == null) return apErr("Type the length in minutes, such as 60.");
    if (price == null) return apErr("Type the price as a number, such as 65 or 0.");
    if (tip == null) return apErr("Type the tip as a number, or leave it blank.");
    var clientId;
    if (cv === "new") {
      var c = { id: newId(), name: newName, phone: "", email: "", bday: null, allergies: "", notes: "", patches: [] };
      if (D.meta.sample) c.sample = false;
      D.clients.push(c);
      clientId = c.id;
    } else clientId = +cv;
    var a = editingAppt || { id: newId() }, s = byId(D.services, +sv);
    a.clientId = clientId;
    if (sv === "keep") { /* the appointment keeps its own service name and id */ }
    else if (s) { a.serviceId = s.id; a.service = s.name; }
    else { a.serviceId = null; a.service = other; }
    a.date = HH.iso(date); a.time = $("#ap-time").value; a.minutes = mins; a.cents = price; a.tipCents = tip; a.status = st;
    a.notes = $$("#ap-notes input").map(function (i) { return { label: i.getAttribute("data-label"), text: i.value.trim().slice(0, 300) }; })
      .filter(function (n) { return n.text; });
    if (!editingAppt) { if (D.meta.sample) a.sample = false; D.appts.push(a); }
    save();
    var was = editingAppt;
    closeAppt();
    HH.toast((was ? "Changed: " : "Booked: ") + nameOf(a.clientId) + " · " + HH.fmtDate(date) + " at " + fmtTime(start));
  }
  function closeAppt() {
    if (apReturn === "client" && viewClient && clientOf(viewClient.id)) go("client");
    else go(apReturn === "client" ? "clients" : apReturn);
  }
  function deleteAppt() {
    var a = editingAppt, i = D.appts.indexOf(a);
    if (i < 0) return;
    D.appts.splice(i, 1);
    save();
    closeAppt();
    HH.toast("Deleted " + nameOf(a.clientId) + "'s appointment", function () { D.appts.splice(i, 0, a); save(); render(); });
  }
  function markDone(a) {
    var before = a.status;
    a.status = "Done";
    save();
    render();
    var w = weeksOf(a.serviceId);
    HH.toast("Done: " + nameOf(a.clientId) + " · " + a.service + (w ? ". Due back " + HH.fmtDate(dayOf(a) + 7 * w) : ""), function () {
      a.status = before; save(); render();
    });
  }
  function bookFor(c, from) {
    var r = rebookOf(c, T), last = r.last || D.appts.filter(function (a) { return a.clientId === c.id; }).sort(cmpAppt).pop();
    var date = r.due != null && r.due > T ? r.due : T;
    openAppt(null, from, { clientId: c.id, serviceId: last ? last.serviceId : null, date: date });
  }

  // ── clients and patch tests ──────────────────────────────────────
  function openClientView(c) { viewClient = c; go("client"); }
  function fillBday(b) {
    var dd = ['<option value="">Day</option>'], mm = ['<option value="">Month</option>'];
    for (var i = 1; i <= 31; i++) dd.push('<option value="' + i + '">' + i + "</option>");
    MONTHS.forEach(function (n, k) { mm.push('<option value="' + (k + 1) + '">' + n + "</option>"); });
    $("#c-bday-day").innerHTML = dd.join("");
    $("#c-bday-month").innerHTML = mm.join("");
    $("#c-bday-day").value = b ? String(+b.slice(3, 5)) : "";
    $("#c-bday-month").value = b ? String(+b.slice(0, 2)) : "";
  }
  function openClient(c, from) {
    editingClient = c || null;
    clientReturn = from || (c ? "client" : "clients");
    $("#c-title").textContent = c ? "Change " + c.name : "Add a client";
    $("#c-name").value = c ? c.name : "";
    $("#c-phone").value = c ? c.phone : "";
    $("#c-email").value = c ? c.email : "";
    fillBday(c ? c.bday : null);
    $("#c-allergies").value = c ? c.allergies : "";
    $("#c-notes").value = c ? c.notes : "";
    $("#c-err").hidden = true;
    $("#c-delete").hidden = !c;
    go("client-edit");
    $("#c-name").focus();
  }
  function saveClient(ev) {
    ev.preventDefault();
    var name = $("#c-name").value.trim().slice(0, 40), dd = $("#c-bday-day").value, mm = $("#c-bday-month").value;
    var err = !name ? "Type the client's name." : (dd === "") !== (mm === "") ? "Pick both the day and the month of the birthday, or neither." :
      dd && +dd > HH.lastDay(2028, +mm) ? MONTHS[+mm - 1] + " has no day " + dd + "." : "";
    if (err) { $("#c-err").textContent = err; $("#c-err").hidden = false; return; }
    var c = editingClient || { id: newId(), patches: [] };
    c.name = name; c.phone = $("#c-phone").value.trim().slice(0, 30); c.email = $("#c-email").value.trim().slice(0, 80);
    c.bday = dd ? pad(+mm) + "-" + pad(+dd) : null;
    c.allergies = $("#c-allergies").value.trim().slice(0, 600); c.notes = $("#c-notes").value.trim().slice(0, 600);
    if (!editingClient) { if (D.meta.sample) c.sample = false; D.clients.push(c); }
    save();
    var was = editingClient;
    viewClient = c;
    go("client");
    HH.toast((was ? "Saved " : "Added ") + name);
  }
  function deleteClient() {
    var c = editingClient;
    var n = D.appts.filter(function (a) { return a.clientId === c.id; }).length;
    HH.confirmStep({
      title: "Delete " + c.name + "?", yes: "Next", no: "Keep " + c.name,
      text: "This deletes " + c.name + "'s card, " + plural(n, "appointment", "appointments") + " and " + plural(c.patches.length, "patch test", "patch tests") +
        " from this browser. Income from those appointments goes too.",
      onYes: function () {
        HH.confirmStep({
          title: "Delete " + c.name + " now?", yes: "Yes, delete", no: "Cancel", danger: true, text: "This can't be undone without a backup.",
          onYes: function () {
            D.clients = D.clients.filter(function (x) { return x.id !== c.id; });
            D.appts = D.appts.filter(function (a) { return a.clientId !== c.id; });
            D.sales.forEach(function (x) { if (x.clientId === c.id) x.clientId = null; });
            save();
            viewClient = null;
            go("clients");
            HH.toast("Deleted " + c.name);
          }
        });
      }
    });
  }
  function openPatch(p) {
    editingPatch = p || null;
    $("#pt-title").textContent = p ? "Change patch test" : "Add a patch test";
    HH.setDate($("#pt-date"), p ? p.date : HH.iso(T));
    $("#pt-product").value = p ? p.product : "";
    $("#pt-result").value = p ? p.result : "";
    $("#pt-next").value = p && p.next ? p.next : "";
    $("#pt-err").hidden = true;
    $("#pt-delete").hidden = !p;
    go("patch-edit");
    $("#pt-product").focus();
  }
  function savePatch(ev) {
    ev.preventDefault();
    var date = HH.parseIso($("#pt-date").value), product = $("#pt-product").value.trim().slice(0, 60), nextTxt = $("#pt-next").value;
    var err = date == null ? "Pick the date of the test." : !product ? "Type the product or area, such as Lash glue." :
      nextTxt && HH.parseIso(nextTxt) == null ? "Pick the next due date, or leave it blank." : "";
    if (err) { $("#pt-err").textContent = err; $("#pt-err").hidden = false; return; }
    var c = viewClient, p = editingPatch || { id: newId() };
    p.date = HH.iso(date); p.product = product; p.result = $("#pt-result").value.trim().slice(0, 120); p.next = nextTxt || null;
    if (!editingPatch) c.patches.push(p);
    save();
    go("client");
    HH.toast((editingPatch ? "Changed " : "Added ") + "patch test: " + product);
  }
  function deletePatch() {
    var c = viewClient, p = editingPatch, i = c.patches.indexOf(p);
    if (i < 0) return;
    c.patches.splice(i, 1);
    save();
    go("client");
    HH.toast("Deleted patch test: " + p.product, function () { c.patches.splice(i, 0, p); save(); render(); });
  }

  // ── sales and tips ───────────────────────────────────────────────
  function openSale(s) {
    editingSale = s || null;
    $("#sl-title").textContent = s ? "Change " + s.kind.toLowerCase() : "Add a sale or tip";
    $$('input[name="slkind"]').forEach(function (r) { r.checked = r.value === (s ? s.kind : "Product sale"); });
    $("#sl-amount").value = s ? HH.plain(s.cents) : "";
    $("#sl-note").value = s ? s.note : "";
    fillClientSelect($("#sl-client"), s ? s.clientId : null, false, "No client");
    var p = periodOf(incMode, incDay == null ? T : incDay);
    HH.setDate($("#sl-date"), s ? s.date : HH.iso(T >= p.first && T <= p.last ? T : p.first));
    $("#sl-err").hidden = true;
    $("#sl-delete").hidden = !s;
    go("sale-edit");
    $("#sl-amount").focus();
  }
  function saveSale(ev) {
    ev.preventDefault();
    var cents = HH.parseMoney($("#sl-amount").value), date = HH.parseIso($("#sl-date").value);
    var err = cents == null || cents <= 0 ? "Type the amount as a number, such as 24.50." : date == null ? "Pick the day." : "";
    if (err) { $("#sl-err").textContent = err; $("#sl-err").hidden = false; return; }
    var s = editingSale || { id: newId() };
    s.kind = checked("slkind") || "Product sale"; s.cents = cents; s.note = $("#sl-note").value.trim().slice(0, 60); s.date = HH.iso(date);
    s.clientId = $("#sl-client").value ? +$("#sl-client").value : null;
    if (!editingSale) { if (D.meta.sample) s.sample = false; D.sales.push(s); }
    save();
    go("income");
    HH.toast((editingSale ? "Changed " : "Added ") + s.kind.toLowerCase() + " " + m(cents));
  }
  function deleteSale() {
    var s = editingSale, i = D.sales.indexOf(s);
    if (i < 0) return;
    D.sales.splice(i, 1);
    save();
    go("income");
    HH.toast("Deleted " + s.kind.toLowerCase() + " " + m(s.cents), function () { D.sales.splice(i, 0, s); save(); render(); });
  }

  // ── services ─────────────────────────────────────────────────────
  function openSvc(s, from) {
    editingSvc = s || null;
    svcReturn = from || "services";
    $("#sv-title").textContent = s ? "Change service" : "Add a service";
    $("#sv-name").value = s ? s.name : "";
    $("#sv-price").value = s ? HH.plain(s.cents) : "";
    $("#sv-minutes").value = s ? String(s.minutes) : "";
    $("#sv-rebook").value = s && s.rebookWeeks ? String(s.rebookWeeks) : "";
    $("#sv-err").hidden = true;
    $("#sv-delete").hidden = !s;
    go("svc-edit");
    $("#sv-name").focus();
  }
  function closeSvc() { if (svcReturn === "welcome") { go("welcome"); welcomeStep(2); } else go("services"); }
  function saveSvc(ev) {
    ev.preventDefault();
    var name = $("#sv-name").value.trim().slice(0, 40), cents = HH.parseMoney($("#sv-price").value), mins = parseMinutes($("#sv-minutes").value);
    var wt = $("#sv-rebook").value.trim(), weeks = wt === "" ? 0 : /^\d{1,3}$/.test(wt) && +wt <= 104 ? +wt : null;
    var err = !name ? "Give the service a name, such as Gel nails." : cents == null ? "Type the price as a number, such as 65 or 0." :
      mins == null ? "Type the length in minutes, such as 60." : weeks == null ? "Type the rebook weeks as a whole number, such as 3, or leave it blank." : "";
    if (err) { $("#sv-err").textContent = err; $("#sv-err").hidden = false; return; }
    var s = editingSvc || { id: newId() };
    s.name = name; s.cents = cents; s.minutes = mins; s.rebookWeeks = weeks;
    if (!editingSvc) { if (D.meta.sample) s.sample = false; D.services.push(s); }
    save();
    closeSvc();
    HH.toast((editingSvc ? "Changed " : "Added ") + name);
  }
  function deleteSvc() {
    var s = editingSvc, i = D.services.indexOf(s);
    if (i < 0) return;
    D.services.splice(i, 1);
    save();
    closeSvc();
    HH.toast("Deleted " + s.name + ". Appointments keep their own name and price.", function () { D.services.splice(i, 0, s); save(); render(); }, 6000);
  }

  // ── settings ─────────────────────────────────────────────────────
  function savedNote(t) { $("#s-saved").textContent = t; }
  function onSettingChange(ev) {
    var t = ev.target, s = D.settings;
    if (!t || !t.name) return;
    if (t.name === "biz") { s.business = t.value; savedNote("Saved. New appointments show the " + BIZ.filter(function (b) { return b[0] === t.value; })[0][1] + " note fields."); }
    else if (t.name === "cur") {
      if (t.value === "own") { $("#s-cur-own-wrap").hidden = false; $("#s-cur-own").focus(); return; }
      s.currency = t.value; savedNote("Saved. Amounts now show as " + m(6500) + ".");
    } else if (t.name === "ws") { s.weekStart = t.value; savedNote("Saved. Weeks start on " + (t.value === "Sun" ? "Sunday." : "Monday.")); }
    else if (t.name === "clock") { s.clock = t.value; savedNote("Saved. Times now show as " + fmtTime(14 * 60 + 30) + "."); }
    else if (t.name === "theme") { s.theme = t.value; save(); HH.applyTheme(t.value); return; }
    else return;
    save();
    render();
  }
  function saveOwnCurrency() {
    var v = $("#s-cur-own").value.trim().slice(0, 4);
    if (!v) { savedNote("Type your symbol, up to 4 characters."); return; }
    D.settings.currency = v;
    save();
    render();
    savedNote("Saved. Amounts now show as " + m(6500) + ".");
  }

  // ── backup and restore ───────────────────────────────────────────
  function backup() {
    T = HH.today();
    D.meta.lastBackup = HH.iso(T);
    D.meta.reminderDismissed = null;
    save();
    var name = "hollowayhart-client-book-app-backup-" + HH.iso(T) + ".json";
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
      var d = r.data, np = 0;
      d.clients.forEach(function (c) { np += c.patches.length; });
      restoreMsg('<div class="banner" id="restore-summary"><strong>This backup has</strong>' +
        plural(d.clients.length, "client", "clients") + " · " + plural(d.appts.length, "appointment", "appointments") + " · " +
        plural(d.services.length, "service", "services") + " · " + plural(d.sales.length, "sale or tip", "sales and tips") + " · " +
        plural(np, "patch test", "patch tests") + (r.made != null ? " · made " + HH.fmtLong(r.made) : "") +
        '<p class="small" style="margin-top:6px">Restoring replaces everything in the app now.</p>' +
        '<div class="row-buttons"><button type="button" class="btn btn-primary" id="restore-yes">Replace with this backup</button>' +
        '<button type="button" class="btn btn-quiet" id="restore-no">Cancel</button></div></div>');
      $("#restore-yes").addEventListener("click", function () {
        D = pendingRestore; pendingRestore = null;
        viewClient = null; calDay = null; incDay = null;
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
      text: "This deletes your clients, appointments, services, patch tests and income from this browser. If you might want them again, cancel and use Back up now first.",
      onYes: function () {
        HH.confirmStep({
          title: "Delete everything now?", yes: "Yes, delete everything", no: "Cancel", danger: true,
          text: "This can't be undone without a backup.",
          onYes: function () {
            var theme = D.settings.theme;
            D = blank(); D.settings.theme = theme;
            viewClient = null; calDay = null; incDay = null;
            save();
            startWelcome();
            HH.toast("Everything was deleted. Starting fresh.");
          }
        });
      }
    });
  }

  // ── wiring ───────────────────────────────────────────────────────
  function currentScreen() { var x = document.querySelector("[data-screen]:not([hidden])"); return x ? x.getAttribute("data-screen") : "home"; }
  function wire() {
    $$("[data-nav]").forEach(function (b) {
      b.addEventListener("click", function () { go(b.getAttribute("data-nav")); });
    });
    $("#new-appt-btn").addEventListener("click", function () { openAppt(null, "home"); });
    $("#cal-add").addEventListener("click", function () { openAppt(null, "calendar", { date: calDay }); });
    $("#ap-form").addEventListener("submit", saveAppt);
    $("#ap-cancel").addEventListener("click", closeAppt);
    $("#ap-delete").addEventListener("click", deleteAppt);
    $("#ap-service").addEventListener("change", function () { serviceDefaults(); apLive(); });
    ["#ap-client", "#ap-date", "#ap-time", "#ap-minutes"].forEach(function (id) {
      $(id).addEventListener("change", apLive);
      $(id).addEventListener("input", apLive);
    });
    $("#ap-status").addEventListener("change", apLive);
    $$('input[name="calmode"]').forEach(function (r) { r.addEventListener("change", function () { calMode = r.value; renderCalendar(); }); });
    $("#cal-prev").addEventListener("click", function () { calDay -= calMode === "week" ? 7 : 1; renderCalendar(); });
    $("#cal-next").addEventListener("click", function () { calDay += calMode === "week" ? 7 : 1; renderCalendar(); });
    $("#cal-today").addEventListener("click", function () { calDay = T; renderCalendar(); });
    $("#cal-date").addEventListener("change", function () { var d = HH.parseIso($("#cal-date").value); if (d != null) { calDay = d; renderCalendar(); } });
    $("#client-add").addEventListener("click", function () { openClient(null, "clients"); });
    $("#cl-search").addEventListener("input", function () { search = $("#cl-search").value; renderClients(); });
    $("#client-form").addEventListener("submit", saveClient);
    $("#c-cancel").addEventListener("click", function () { if (editingClient) go("client"); else go("clients"); });
    $("#c-delete").addEventListener("click", deleteClient);
    $("#cv-book").addEventListener("click", function () { bookFor(viewClient, "client"); });
    $("#cv-edit").addEventListener("click", function () { openClient(viewClient, "client"); });
    $("#cv-patch-add").addEventListener("click", function () { openPatch(null); });
    $("#cv-back").addEventListener("click", function () { go("clients"); });
    $("#patch-form").addEventListener("submit", savePatch);
    $("#pt-cancel").addEventListener("click", function () { go("client"); });
    $("#pt-delete").addEventListener("click", deletePatch);
    $$('input[name="incmode"]').forEach(function (r) { r.addEventListener("change", function () { incMode = r.value; renderIncome(); }); });
    $("#inc-prev").addEventListener("click", function () { incDay = incMode === "week" ? incDay - 7 : HH.addMonths(monthRange(incDay).first, -1); renderIncome(); });
    $("#inc-next").addEventListener("click", function () { incDay = incMode === "week" ? incDay + 7 : HH.addMonths(monthRange(incDay).first, 1); renderIncome(); });
    $("#inc-now").addEventListener("click", function () { incDay = T; renderIncome(); });
    $("#sale-add").addEventListener("click", function () { openSale(null); });
    $("#sale-form").addEventListener("submit", saveSale);
    $("#sl-cancel").addEventListener("click", function () { go("income"); });
    $("#sl-delete").addEventListener("click", deleteSale);
    $("#svc-add").addEventListener("click", function () { openSvc(null, "services"); });
    $("#svc-form").addEventListener("submit", saveSvc);
    $("#sv-cancel").addEventListener("click", closeSvc);
    $("#sv-delete").addEventListener("click", deleteSvc);
    document.addEventListener("click", function (ev) {
      var t = ev.target.closest ? ev.target.closest("[data-edit-appt],[data-done-appt],[data-view-client],[data-edit-patch],[data-rebook-book]," +
        "[data-edit-sale],[data-edit-svc],[data-cal-day],[data-clear-sample],[data-backup],[data-dismiss-backup],[data-go]") : null;
      if (!t) return;
      if (t.hasAttribute("data-edit-appt")) openAppt(byId(D.appts, +t.getAttribute("data-edit-appt")), currentScreen());
      else if (t.hasAttribute("data-done-appt")) markDone(byId(D.appts, +t.getAttribute("data-done-appt")));
      else if (t.hasAttribute("data-view-client")) openClientView(clientOf(+t.getAttribute("data-view-client")));
      else if (t.hasAttribute("data-edit-patch")) openPatch(byId(viewClient.patches, +t.getAttribute("data-edit-patch")));
      else if (t.hasAttribute("data-rebook-book")) bookFor(clientOf(+t.getAttribute("data-rebook-book")), "rebook");
      else if (t.hasAttribute("data-edit-sale")) openSale(byId(D.sales, +t.getAttribute("data-edit-sale")));
      else if (t.hasAttribute("data-edit-svc")) openSvc(byId(D.services, +t.getAttribute("data-edit-svc")), $("#tabs").hidden ? "welcome" : "services");
      else if (t.hasAttribute("data-cal-day")) { calDay = +t.getAttribute("data-cal-day"); calMode = "day"; renderCalendar(); window.scrollTo(0, 0); }
      else if (t.hasAttribute("data-clear-sample")) clearSample();
      else if (t.hasAttribute("data-backup")) backup();
      else if (t.hasAttribute("data-dismiss-backup")) { D.meta.reminderDismissed = HH.iso(T); save(); renderBanners(); }
      else if (t.hasAttribute("data-go")) go(t.getAttribute("data-go"));
    });
    ["#s-biz", "#s-cur", "#s-ws", "#s-clock"].forEach(function (id) { $(id).addEventListener("change", onSettingChange); });
    $$('input[name="theme"]').forEach(function (r) { r.addEventListener("change", onSettingChange); });
    $("#s-cur-own").addEventListener("change", saveOwnCurrency);
    $("#s-cur-own").addEventListener("input", function () { if ($("#s-cur-own").value.trim()) saveOwnCurrency(); });
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
    $("#w-cur").addEventListener("change", function () {
      var own_ = checked("wcur") === "own";
      $("#w-cur-own-wrap").hidden = !own_;
      if (own_) $("#w-cur-own").focus();
    });
    $("#w-setup").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var cur = checked("wcur"), ownTxt = $("#w-cur-own").value.trim().slice(0, 4);
      if (cur === "own" && !ownTxt) { $("#w-err").textContent = "Type your currency symbol, or pick one above."; $("#w-err").hidden = false; return; }
      $("#w-err").hidden = true;
      var s = D.settings;
      s.business = checked("wbiz") || "mixed"; s.currency = cur === "own" ? ownTxt : (cur || "AU$"); s.weekStart = checked("wws") || "Mon";
      save();
      renderServices();
      welcomeStep(2);
    });
    $("#w-sample").addEventListener("click", loadSample);
    $("#w-svc-add").addEventListener("click", function () { openSvc(null, "welcome"); });
    $("#w-svc-done").addEventListener("click", function () { welcomeStep(3); });
    $("#w-svc-skip").addEventListener("click", function () { welcomeStep(3); });
    $("#w-finish").addEventListener("click", finishWelcome);
    document.addEventListener("visibilitychange", function () { if (!document.hidden && D.meta.onboarded) render(); });
  }

  // ── start ────────────────────────────────────────────────────────
  function start() {
    var raw = store.read();
    if (raw) {
      var r = migrate(raw);
      if (r.data) D = r.data;
      else {
        try { window.localStorage.setItem("hh141_unreadable_" + HH.iso(HH.today()), JSON.stringify(raw)); } catch (e) { /* nothing more to do */ }
        D = blank();
      }
    } else D = blank();
    wire();
    if (D.meta.onboarded) go("home"); else startWelcome();
  }

  // for the QA runner (qa/app_qa141.py): the same rules the screens use
  window.HH141 = { rebookOf: function (id, t) { return rebookOf(clientOf(id), t); }, rebookList: rebookList, patchDue: patchDue,
    incomeIn: incomeIn, weekStartOf: weekStartOf, periodOf: periodOf, overlaps: overlaps, migrate: migrate, SCHEMA: SCHEMA, APP_ID: APP_ID,
    data: function () { return D; } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
