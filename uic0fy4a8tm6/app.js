window.HH_BUILD = {"id": "138", "version": "18Nov2026.5", "hosted": true};
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

/* Product 138: Debt Payoff App (specs/money/138-debt-payoff-app.yaml), 18 Nov 2026.
   72's payoff maths unchanged (apps/p72/app.js: the spec's month loop in integer cents; Snowball / Avalanche, ties by list order)
   plus a custom order, the month-by-month rows, minimums only, an extra-payment what-if and a log of real payments that brings
   each balance down. Money is integer cents; APRs are basis points (19.99% = 1999); dates are day numbers from HH (apps/core.js). */
(function () {
  "use strict";
  var SCHEMA = 1;
  var APP_ID = "hollowayhart-debt-payoff-app";
  var METHODS = ["Snowball", "Avalanche", "Custom"];
  var CURRENCIES = ["$", "AU$", "US$", "£", "€"];
  var REMIND_DAYS = 30;
  var CAP_MONTHS = 600;
  var TABLE_FIRST = 24;
  var MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var $ = HH.$, $$ = HH.$$, esc = HH.esc;
  var store = new HH.Store("hh138_");
  var D = null;
  var T = HH.today();
  var S = null;                        // the plan summary of the last render
  var editingDebt = null, debtReturn = "debts", payReturn = "home", pendingRestore = null, monthsAll = false, payFilter = "all";
  var dragId = null;

  // ── data ──────────────────────────────────────────────────────────
  function blank() {
    return {
      schema: SCHEMA,
      settings: { currency: "$", monthlyCents: 0, method: "Snowball", customOrder: [], theme: "auto", whatIfCents: 5000 },
      debts: [], payments: [],
      meta: { created: HH.iso(HH.today()), lastBackup: null, reminderDismissed: null, sample: false, onboarded: false, nextId: 1 }
    };
  }
  function isInt(x) { return typeof x === "number" && isFinite(x) && Math.floor(x) === x; }
  function isDate(s) { return HH.parseIso(s) != null; }
  function isName(s, n) { return typeof s === "string" && s.length > 0 && s.length <= n; }
  function validate(d) {
    try {
      var s = d.settings, m = d.meta, i, x;
      if (d.schema !== SCHEMA || !s || !m || !Array.isArray(d.debts) || !Array.isArray(d.payments)) return false;
      if (typeof s.currency !== "string" || !s.currency.length || s.currency.length > 4) return false;
      if (!(isInt(s.monthlyCents) && s.monthlyCents >= 0) || METHODS.indexOf(s.method) < 0) return false;
      if (!Array.isArray(s.customOrder) || !s.customOrder.every(isInt)) return false;
      if (["auto", "light", "dark"].indexOf(s.theme) < 0 || !(isInt(s.whatIfCents) && s.whatIfCents >= 0)) return false;
      if (!isDate(m.created) || !(m.lastBackup === null || isDate(m.lastBackup))) return false;
      if (!(m.reminderDismissed === null || isDate(m.reminderDismissed))) return false;
      if (typeof m.sample !== "boolean" || typeof m.onboarded !== "boolean" || !isInt(m.nextId)) return false;
      for (i = 0; i < d.debts.length; i++) {
        x = d.debts[i];
        if (!isInt(x.id) || !isName(x.name, 40) || !isInt(x.cents) || x.cents < 0 || !isInt(x.startCents) || x.startCents < 0) return false;
        if (!isInt(x.aprBp) || x.aprBp < 0 || !isInt(x.minCents) || x.minCents < 0) return false;
        if (!(x.paidOn === null || isDate(x.paidOn)) || typeof x.celebrated !== "boolean") return false;
      }
      for (i = 0; i < d.payments.length; i++) {
        x = d.payments[i];
        if (!isInt(x.id) || !isInt(x.debtId) || !isInt(x.cents) || x.cents <= 0 || !isDate(x.date)) return false;
        if (!isInt(x.before) || x.before < 0 || !isInt(x.after) || x.after < 0) return false;
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
  function hasOwn() { return D.debts.some(function (x) { return !x.sample; }) || D.payments.some(function (x) { return !x.sample; }); }
  function byId(list, id) { return list.filter(function (x) { return x.id === id; })[0]; }
  function live() { return D.debts.filter(function (d) { return d.cents > 0; }); }

  // ── debt payoff: 72's month loop, unchanged, with a custom order and the month-by-month rows ─
  function interestOf(cents, aprBp) { return Math.floor((cents * aprBp * 2 + 120000) / 240000); }
  function payoff(debts, monthly, method, order, opts) {
    opts = opts || {};
    var cap = opts.cap || CAP_MONTHS;
    var live_ = debts.filter(function (d) { return d.cents > 0; });
    if (!live_.length) return { empty: true };
    var mins = 0;
    live_.forEach(function (d) { mins += d.minCents; });
    if (monthly < mins) return { below: mins - monthly, mins: mins };
    var pos = {};
    (order || []).forEach(function (id, k) { pos[id] = k; });
    var rank = live_.map(function (d, k) { return pos.hasOwnProperty(d.id) ? pos[d.id] : 1e6 + k; });
    var bal = live_.map(function (d) { return d.cents; }), paid = live_.map(function () { return null; });
    var interest = 0, total = 0, i, pay, o, rows = opts.rows ? [] : null;
    for (var month = 1; month <= cap; month++) {
      var mi = 0, pays = live_.map(function () { return 0; }), newly = [];
      for (i = 0; i < live_.length; i++) if (bal[i] > 0) { var it = interestOf(bal[i], live_[i].aprBp); bal[i] += it; interest += it; mi += it; }
      var left = monthly, paidNow = 0;
      for (i = 0; i < live_.length; i++) if (bal[i] > 0) { pay = Math.min(live_[i].minCents, bal[i], left); bal[i] -= pay; left -= pay; paidNow += pay; pays[i] += pay; }
      var ord = live_.map(function (_d, k) { return k; });
      ord.sort(method === "Avalanche" ? function (a, b) { return live_[b].aprBp - live_[a].aprBp || a - b; }
               : method === "Custom" ? function (a, b) { return rank[a] - rank[b] || a - b; }
               : function (a, b) { return bal[a] - bal[b] || a - b; });
      for (o = 0; o < ord.length && left > 0; o++) {
        i = ord[o];
        if (bal[i] > 0) { pay = Math.min(bal[i], left); bal[i] -= pay; left -= pay; paidNow += pay; pays[i] += pay; }
      }
      for (i = 0; i < live_.length; i++) if (bal[i] === 0 && paid[i] === null) { paid[i] = month; newly.push(live_[i].id); }
      total += paidNow;
      if (rows) {
        var sum = 0;
        bal.forEach(function (b) { sum += b; });
        rows.push({ month: month, pays: pays, interest: mi, left: sum, bals: bal.slice(), paidNow: newly });
      }
      if (bal.every(function (b) { return b === 0; })) {
        var byId_ = {};
        live_.forEach(function (d, k) { byId_[d.id] = paid[k]; });
        return { months: month, paidMonth: byId_, interest: interest, lastPayment: paidNow, mins: mins, total: total, rows: rows,
                 ids: live_.map(function (d) { return d.id; }) };
      }
    }
    return { never: true, mins: mins };
  }
  function extraNeeded(debts, monthly, method, order) {
    // the smallest whole-dollar extra that finishes within the cap (binary search on dollars), as 72
    var lo = 1, hi = 1;
    while (payoff(debts, monthly + hi * 100, method, order).never && hi < 10000000) hi *= 2;
    while (lo < hi) { var mid = Math.floor((lo + hi) / 2); if (payoff(debts, monthly + mid * 100, method, order).never) lo = mid + 1; else hi = mid; }
    return lo * 100;
  }
  function minimumsOnly(debts) {
    // each debt alone at its own minimum: no extra, and a paid-off debt's minimum is not moved on
    var list = debts.filter(function (d) { return d.cents > 0; }), months = 0, interest = 0;
    if (!list.length) return { empty: true };
    for (var k = 0; k < list.length; k++) {
      var r = payoff([list[k]], list[k].minCents, "Snowball");
      if (!r.months) return { never: true, debt: list[k] };
      months = Math.max(months, r.months);
      interest += r.interest;
    }
    return { months: months, interest: interest };
  }
  function customOrder() {
    // the buyer's order: the ids they placed, then any debt not placed yet (just added) in list order
    var have = {}, out = [];
    D.debts.forEach(function (d) { have[d.id] = 1; });
    D.settings.customOrder.forEach(function (id) { if (have[id] && out.indexOf(id) < 0) out.push(id); });
    D.debts.forEach(function (d) { if (out.indexOf(d.id) < 0) out.push(d.id); });
    return out;
  }
  function minsTotal() { var t = 0; live().forEach(function (d) { t += d.minCents; }); return t; }
  function summary(monthly) {
    var s = D.settings, ord = customOrder(), amt = monthly == null ? s.monthlyCents : monthly;
    var r = payoff(D.debts, amt, s.method, ord, { rows: true });
    r.monthly = amt;
    r.owed = 0; r.start = 0;
    D.debts.forEach(function (d) { r.owed += d.cents; r.start += Math.max(d.startCents, d.cents); });
    if (r.never) r.extra = extraNeeded(D.debts, amt, s.method, ord);
    r.minOnly = minimumsOnly(D.debts);
    if (r.months && r.minOnly.months) { r.saved = r.minOnly.interest - r.interest; r.sooner = r.minOnly.months - r.months; }
    return r;
  }
  function focusDebt() {
    // the debt that gets the extra next: Snowball the smallest balance, Avalanche the highest APR, Custom the first in your order
    var L = live(), s = D.settings;
    if (!L.length) return null;
    if (s.method === "Custom") {
      var ord = customOrder();
      return L.slice().sort(function (a, b) { return ord.indexOf(a.id) - ord.indexOf(b.id); })[0];
    }
    var idx = L.map(function (_d, k) { return k; });
    idx.sort(s.method === "Avalanche" ? function (a, b) { return L[b].aprBp - L[a].aprBp || a - b; } : function (a, b) { return L[a].cents - L[b].cents || a - b; });
    return L[idx[0]];
  }

  // ── months and words ─────────────────────────────────────────────
  function ymOf(dayNo) { var a = HH.ymd(dayNo); return a.y + "-" + (a.m < 10 ? "0" : "") + a.m; }
  function ymParts(ym) { return { y: +ym.slice(0, 4), m: +ym.slice(5, 7) }; }
  function ymLabel(ym) { var a = ymParts(ym); return MO[a.m - 1] + " " + a.y; }
  function ymAdd(ym, k) { var a = ymParts(ym); return ymOf(HH.addMonths(HH.dn(a.y, a.m, 1), k)); }
  function monthLabel(k) { return ymLabel(ymAdd(ymOf(T), k)); }
  function m(c) { return HH.money(c, D.settings.currency); }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
  function pct(bp) { var s = (bp / 100).toFixed(2).replace(/\.?0+$/, ""); return s + "%"; }
  function blocks(frac) {
    var on = Math.max(0, Math.min(20, Math.round(frac * 20))), h = '<span class="blocks" aria-hidden="true">';
    for (var i = 0; i < 20; i++) h += '<i class="' + (i < on ? "on" : "") + '"></i>';
    return h + "</span>";
  }
  function methodName(x) { return x === "Custom" ? "My own order" : x; }
  function planMessage(r) {
    if (r.empty) return D.debts.length ? "Every debt you listed is paid off." : "Add a debt to see the month you could be debt-free.";
    if (r.below) return "Your monthly amount is below the minimums: add " + m(r.below) + " (the minimums add up to " + m(r.mins) + ").";
    if (r.never) return "This won't be paid off at this amount: add " + m(r.extra) + " a month.";
    return "";
  }
  function paidWord(d) { return d.paidOn ? "Paid off " + HH.fmtLong(HH.parseIso(d.paidOn)) : "Paid off"; }

  // ── rendering ────────────────────────────────────────────────────
  function render() {
    T = HH.today();
    HH.applyTheme(D.settings.theme);
    S = summary();
    S.whatIf = payoff(D.debts, D.settings.monthlyCents + D.settings.whatIfCents, D.settings.method, customOrder());
    renderBanners();
    renderHome();
    renderDebts();
    renderPlan();
    renderMonths();
    renderWhatIf();
    renderPayments();
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
      h += '<div class="banner slim" id="sample-banner"><span><span class="sample-flag">SAMPLE</span> · made-up numbers</span>' +
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
  function heroFor(r) {
    if (r.months) return { label: "Debt-free", num: monthLabel(r.months), cap: "in " + plural(r.months, "month", "months") + " · paying " + m(r.monthly) + " a month" };
    if (r.empty && D.debts.length) return { label: "You're debt-free", num: "✓", cap: "Every debt you listed is paid off." };
    return { label: "Debt-free", num: "—", cap: planMessage(r) };
  }
  function celebrationLine(d) {
    var n = D.debts.length, k = D.debts.filter(function (x) { return x.cents === 0; }).length, next = focusDebt();
    if (!next) return "That's every debt you listed. You're debt-free, and the money that went to them is yours again.";
    return "That's " + k + " of " + n + " debts cleared." + (d.minCents > 0 ? " Its " + m(d.minCents) + " minimum now goes to " +
      next.name + ", the next one in line." : " One less thing to carry.");
  }
  function renderHome() {
    var r = S, h = heroFor(r);
    $("#free-label").textContent = h.label;
    $("#free-month").textContent = h.num;
    $("#free-caption").textContent = h.cap;
    var cel = D.debts.filter(function (d) { return d.cents === 0 && !d.celebrated; });
    $("#celebrate").innerHTML = cel.map(function (d) {
      return '<div class="card celebrate" data-celebrate="' + d.id + '" role="status"><p class="cel-head"><span class="tick" aria-hidden="true">✓</span> <b>' +
        esc(d.name) + " is paid off.</b></p><p>" + esc(celebrationLine(d)) + '</p><button type="button" class="btn btn-quiet" data-ack="' + d.id +
        '">Thanks</button></div>';
    }).join("");
    var paidOff = Math.max(0, r.start - r.owed), frac = r.start > 0 ? paidOff / r.start : 0;
    $("#progress-line").textContent = m(paidOff) + " of " + m(r.start) + " · " + Math.round(frac * 100) + "%";
    $("#progress-bar").innerHTML = blocks(frac);
    $("#owed").textContent = m(r.owed);
    $("#interest").textContent = r.months ? m(r.interest) : "—";
    $("#saved").textContent = r.saved != null ? m(r.saved) : "—";
    var f = focusDebt();
    $("#focus").textContent = f ? f.name : "—";
    $("#hc-plan-line").textContent = methodName(D.settings.method) + " · " + m(D.settings.monthlyCents) + " a month";
    $("#hc-months-line").textContent = r.months ? plural(r.months, "month", "months") + " to go · " + monthLabel(1) + ": " + m(sumArr(r.rows[0].pays)) +
      " to your debts" : "Your plan, month by month";
    var w = S.whatIf;
    $("#hc-whatif-line").textContent = w && w.months && r.months ? "+" + m(D.settings.whatIfCents) + " a month: debt-free " + monthLabel(w.months) +
      (r.months - w.months > 0 ? ", " + plural(r.months - w.months, "month", "months") + " sooner" : "") : "Try an extra amount each month";
    var last = D.payments.slice().sort(byNewest)[0], ld = last ? byId(D.debts, last.debtId) : null;
    $("#hc-pay-line").textContent = last ? plural(D.payments.length, "payment", "payments") + " · last " + HH.fmtDate(HH.parseIso(last.date)) + ": " +
      m(last.cents) + (ld ? " to " + ld.name : "") : "No payments logged yet";
    var paid = D.debts.filter(function (d) { return d.cents === 0; });
    $("#paid-card").hidden = !paid.length;
    $("#paid-list").innerHTML = paid.map(function (d) {
      return '<li data-paid="' + d.id + '"><span class="what"><span class="tick" aria-hidden="true">✓</span> <b>' + esc(d.name) + '</b><br><span class="small muted">' +
        paidWord(d) + (d.startCents > 0 ? " · " + m(d.startCents) + " cleared" : "") + "</span></span></li>";
    }).join("");
  }
  function sumArr(a) { var t = 0; a.forEach(function (x) { t += x; }); return t; }
  function byNewest(a, b) { return HH.parseIso(b.date) - HH.parseIso(a.date) || b.id - a.id; }
  function debtItem(d) {
    var start = Math.max(d.startCents, d.cents), done = start - d.cents, frac = start > 0 ? done / start : 0;
    var when = d.cents === 0 ? '<span class="tag done">✓ ' + paidWord(d) + "</span>" :
      S.paidMonth && S.paidMonth[d.id] ? '<span class="tag">paid off ' + monthLabel(S.paidMonth[d.id]) + " in the plan</span>" : "";
    return '<li data-debt="' + d.id + '"><button type="button" class="rowbtn" data-edit-debt="' + d.id + '" aria-label="Change ' + esc(d.name) +
      '"><span class="what"><b>' + esc(d.name) + '</b><br><span class="small muted">' + pct(d.aprBp) + " APR · minimum " + m(d.minCents) +
      '</span><br><span class="small">Started at ' + m(start) + " · " + m(done) + " paid off</span><br>" + blocks(frac) +
      (when ? "<br>" + when : "") + '</span><span class="amt">' + m(d.cents) + '</span><span class="chev" aria-hidden="true">›</span></button></li>';
  }
  function renderDebts() {
    var html = D.debts.map(debtItem).join("");
    $("#debt-list").innerHTML = html;
    $("#debt-none").hidden = D.debts.length > 0;
    $("#w-debt-list").innerHTML = html;
    $("#w-debt-none").hidden = D.debts.length > 0;
    $("#debts-owed").textContent = m(S.owed);
    $("#debts-mins").textContent = m(minsTotal());
  }
  function renderPlan() {
    var s = D.settings, r = S;
    $("#d-monthly").value = HH.plain(s.monthlyCents);
    $("#d-monthly-hint").textContent = "Your minimums add up to " + m(minsTotal()) + ". Anything more is extra, and goes to one debt at a time.";
    $$('input[name="method"]').forEach(function (x) { x.checked = x.value === s.method; });
    $("#plan-method-note").textContent = s.method === "Snowball" ? "Snowball: the extra goes to the smallest balance first, for quick wins."
      : s.method === "Avalanche" ? "Avalanche: the extra goes to the highest APR first, which costs the least interest."
      : "My own order: the extra goes to the debt at the top of your list first. Move them with the arrows (or drag them on a computer).";
    var msg = planMessage(r);
    $("#plan-free").textContent = r.months ? monthLabel(r.months) : "—";
    $("#plan-months").textContent = r.months ? plural(r.months, "month", "months") : "—";
    $("#plan-interest").textContent = r.months ? m(r.interest) : "—";
    $("#plan-saved").textContent = r.saved != null ? m(r.saved) : "—";
    var mo = r.minOnly, minline = "";
    if (mo.never) minline = "Paying only the minimums, " + mo.debt.name + " would never be paid off: its minimum doesn't cover the interest it gathers.";
    else if (mo.months && r.months) minline = "Paying only the minimums: debt-free " + monthLabel(mo.months) + ", with " + m(mo.interest) + " of interest. Your plan is " +
      (r.sooner > 0 ? plural(r.sooner, "month", "months") + " sooner." : "the same month.");
    $("#plan-minline").textContent = minline;
    $("#plan-minline").hidden = !minline;
    $("#plan-msg").textContent = msg;
    $("#plan-msg").hidden = !msg;
    // the order list
    var L = live(), custom = s.method === "Custom", items;
    if (custom) {
      var ord = customOrder();
      items = L.slice().sort(function (a, b) { return ord.indexOf(a.id) - ord.indexOf(b.id); });
    } else {
      items = L.slice().sort(function (a, b) {
        var pa = r.paidMonth ? r.paidMonth[a.id] : 0, pb = r.paidMonth ? r.paidMonth[b.id] : 0;
        return (pa - pb) || D.debts.indexOf(a) - D.debts.indexOf(b);
      });
    }
    $("#plan-order-note").textContent = custom ? "Top of the list first. Use ↑ and ↓ to move a debt." :
      "In the order they're paid off. Pick My own order to choose it yourself.";
    $("#plan-order").classList.toggle("custom", custom);
    $("#plan-order").innerHTML = items.map(function (d, k) {
      var when = r.paidMonth && r.paidMonth[d.id] ? "paid off " + monthLabel(r.paidMonth[d.id]) : "";
      return '<li data-order="' + d.id + '"' + (custom ? ' draggable="true"' : "") + '><span class="num" aria-hidden="true">' + (k + 1) + '</span><span class="what"><b>' + esc(d.name) +
        '</b><br><span class="small muted">' + m(d.cents) + " · " + pct(d.aprBp) + " APR" + (when ? " · " + when : "") + "</span></span>" +
        (custom ? '<span class="mv"><button type="button" class="btn btn-quiet" data-move="up:' + d.id + '" aria-label="Move ' + esc(d.name) + ' up"' +
          (k === 0 ? " disabled" : "") + '>↑</button><button type="button" class="btn btn-quiet" data-move="down:' + d.id + '" aria-label="Move ' +
          esc(d.name) + ' down"' + (k === items.length - 1 ? " disabled" : "") + ">↓</button></span>" : "") + "</li>";
    }).join("");
  }
  function renderMonths() {
    var r = S, msg = planMessage(r);
    $("#months-msg").textContent = msg;
    $("#months-msg").hidden = !msg;
    if (!r.months) {
      $("#months-table").innerHTML = "";
      $("#months-total").textContent = "";
      $("#months-all").hidden = true;
      return;
    }
    var debts = r.ids.map(function (id) { return byId(D.debts, id); }), rows = r.rows;
    var shown = monthsAll ? rows : rows.slice(0, TABLE_FIRST);
    var h = '<thead><tr><th scope="col">Month</th>' + debts.map(function (d) { return '<th scope="col">' + esc(d.name) + "</th>"; }).join("") +
      '<th scope="col">Interest</th><th scope="col">Balance left</th></tr></thead><tbody>';
    shown.forEach(function (row, k) {
      var prev = k > 0 ? rows[k - 1].bals : debts.map(function (d) { return d.cents; });
      var notes = row.paidNow.map(function (id) { return '<span class="paidnote"><span class="tick" aria-hidden="true">✓</span> ' + esc(byId(D.debts, id).name) + " paid off</span>"; }).join("");
      h += '<tr data-month="' + row.month + '"><td data-label="Month" class="mcell"><b>' + monthLabel(row.month) + "</b>" + notes + "</td>" +
        debts.map(function (d, i) {
          var cell = row.pays[i] === 0 && prev[i] === 0 ? "—" : m(row.pays[i]);
          return '<td data-label="' + esc(d.name) + '">' + cell + "</td>";
        }).join("") +
        '<td data-label="Interest">' + m(row.interest) + '</td><td data-label="Balance left" class="leftcell">' + m(row.left) + "</td></tr>";
    });
    $("#months-table").innerHTML = h + "</tbody>";
    $("#months-total").textContent = "Paid in all " + m(r.total) + " · interest " + m(r.interest) + " · " + plural(r.months, "month", "months") +
      " (" + monthLabel(1) + " to " + monthLabel(r.months) + ")";
    $("#months-all").hidden = rows.length <= TABLE_FIRST;
    $("#months-all").textContent = monthsAll ? "Show the first " + TABLE_FIRST + " months" : "Show all " + rows.length + " months";
  }
  function renderWhatIf() {
    var s = D.settings, base = S, extra = s.whatIfCents, w = S.whatIf;
    if (document.activeElement !== $("#wi-extra")) $("#wi-extra").value = HH.plain(extra).replace(/\.00$/, "");
    var msg = "", sooner = "", saved = "—", num = "—";
    if (base.empty) msg = planMessage(base);
    else if (w.below) msg = "Your monthly amount with this extra is still below the minimums: add " + m(w.below) + ".";
    else if (w.never) msg = "Even with this extra it won't be paid off: add " + m(extraNeeded(D.debts, s.monthlyCents + extra, s.method, customOrder())) + " a month more.";
    else {
      num = monthLabel(w.months);
      if (base.months) {
        var k = base.months - w.months;
        sooner = k > 0 ? plural(k, "month", "months") + " sooner than your plan (" + monthLabel(base.months) + ")" : "The same month as your plan";
        saved = m(base.interest - w.interest);
      } else sooner = "Your plan as it stands doesn't finish. With this extra it would.";
    }
    $("#wi-free").textContent = num;
    $("#wi-sooner").textContent = sooner;
    $("#wi-saved").textContent = saved;
    $("#wi-line").textContent = base.empty ? "" : "Paying " + m(s.monthlyCents + extra) + " a month instead of " + m(s.monthlyCents) + ".";
    $("#wi-msg").textContent = msg;
    $("#wi-msg").hidden = !msg;
    $("#wi-list").innerHTML = live().map(function (d) {
      var now = base.paidMonth && base.paidMonth[d.id] ? monthLabel(base.paidMonth[d.id]) : "—", then = w.paidMonth && w.paidMonth[d.id] ? monthLabel(w.paidMonth[d.id]) : "—";
      return '<li data-wi="' + d.id + '"><span class="what"><b>' + esc(d.name) + '</b><br><span class="small muted">your plan: ' + now + '</span></span><span class="amt">' + then + "</span></li>";
    }).join("") || '<li class="muted">No debts to pay off.</li>';
    $("#wi-apply").textContent = "Use " + m(s.monthlyCents + extra) + " a month in my plan";
    $("#wi-apply").hidden = !(extra > 0 && w.months);
  }
  function renderPayments() {
    var opts = '<option value="all">All debts</option>' + D.debts.map(function (d) { return '<option value="' + d.id + '">' + esc(d.name) + "</option>"; }).join("");
    if (payFilter !== "all" && !byId(D.debts, +payFilter)) payFilter = "all";
    $("#pay-filter").innerHTML = opts;
    $("#pay-filter").value = String(payFilter);
    var list = D.payments.filter(function (p) { return payFilter === "all" || p.debtId === +payFilter; }).sort(byNewest);
    var total = 0;
    list.forEach(function (p) { total += p.cents; });
    $("#pay-total").textContent = list.length ? "You've logged " + m(total) + " across " + plural(list.length, "payment", "payments") + "." : "";
    $("#pay-total").hidden = !list.length;
    $("#pay-list").innerHTML = list.map(function (p) {
      var d = byId(D.debts, p.debtId), name = d ? d.name : "A deleted debt";
      return '<li data-pay="' + p.id + '"><span class="what"><b>' + esc(name) + '</b><br><span class="small muted">' + HH.fmtDate(HH.parseIso(p.date), true) +
        '</span></span><span class="amt"><span class="pa">' + m(p.cents) + '</span> · <span class="pl">' + (p.after === 0 ? 'paid off <span class="tick" aria-hidden="true">✓</span>' :
        m(p.after) + " left") + '</span></span><button type="button" class="btn btn-quiet" data-del-pay="' + p.id + '" aria-label="Delete the ' + esc(m(p.cents)) +
        " payment to " + esc(name) + '">Delete</button></li>';
    }).join("");
    $("#pay-none").hidden = list.length > 0;
  }
  function curChips(name, sel) {
    return CURRENCIES.map(function (c) {
      return '<label class="chip"><input type="radio" name="' + name + '" value="' + esc(c) + '"' + (c === sel ? " checked" : "") + "><span>" + esc(c) + "</span></label>";
    }).join("");
  }
  function renderSettings() {
    var s = D.settings;
    $("#s-cur-chips").innerHTML = curChips("cur", s.currency);
    if (document.activeElement !== $("#s-cur")) $("#s-cur").value = s.currency;
    $$('input[name="theme"]').forEach(function (r) { r.checked = r.value === s.theme; });
    $("#last-backup").textContent = D.meta.lastBackup ? "Last backup: " + HH.fmtLong(HH.parseIso(D.meta.lastBackup)) : "No backup made yet.";
    $("#sample-state").textContent = D.meta.sample ? "Sample data is on: the debts and payments in the app are made up." :
      "Sample data is off. You can load made-up debts and payments to look around while the app is empty.";
    $("#sample-btn").textContent = D.meta.sample ? "Clear the sample data" : "Load sample data";
  }
  function go(id) {
    render();
    HH.show(id);
    $("#tabs").hidden = id === "welcome" || (id === "debt-edit" && debtReturn === "welcome");
  }

  // ── first run ────────────────────────────────────────────────────
  function welcomeStep(k) {
    [1, 2, 3].forEach(function (i) {
      $("#welcome-" + i).hidden = i !== k;
      $("#st" + i).classList.toggle("on", i <= k);
    });
    if (k === 2) {
      var mins = minsTotal();
      $("#w-cur-chips").innerHTML = curChips("w-cur", D.settings.currency);
      $("#w-monthly").value = HH.plain(Math.max(D.settings.monthlyCents, mins));
      $("#w-monthly-hint").textContent = "Your minimums add up to " + m(mins) + ". Anything more is extra, and goes to one debt at a time.";
      $$('input[name="w-method"]').forEach(function (x) { x.checked = x.value === D.settings.method; });
      $("#w-err").hidden = true;
    }
    if (k === 3) {
      render();
      var h = heroFor(S);
      $("#w-free").textContent = h.num;
      $("#w-cap").textContent = h.cap;
    }
    var h1 = $("#welcome-" + k + " h1");
    if (h1) { h1.setAttribute("tabindex", "-1"); h1.focus(); }
  }
  function startWelcome() {
    go("welcome");
    welcomeStep(1);
  }

  // ── sample data (moves with today) ───────────────────────────────
  function loadSample() {
    var t = HH.today(), id = 1;
    var d = blank();
    d.settings.theme = D ? D.settings.theme : "auto";
    d.settings.currency = D ? D.settings.currency : "$";
    d.settings.monthlyCents = 75000;
    d.settings.method = "Snowball";
    // name, start, APR (bp), minimum, payments [days ago, amount]
    var rows = [["Credit card", 310000, 1999, 7500, [[84, 25000], [54, 20000], [24, 20000]]],
                ["Car loan", 980000, 750, 31000, [[80, 31000], [50, 31000], [20, 31000]]],
                ["Store card", 76000, 0, 9500, [[77, 9500], [47, 9500], [17, 9500]]],
                ["Personal loan", 400000, 1190, 12000, [[75, 12000], [45, 12000], [15, 12000]]],
                ["Laptop plan", 60000, 0, 5000, [[70, 20000], [40, 20000], [10, 20000]]]];
    var pays = [];
    d.debts = rows.map(function (r) {
      var debt = { id: id++, name: r[0], cents: r[1], startCents: r[1], aprBp: r[2], minCents: r[3], paidOn: null, celebrated: false, sample: true };
      r[4].forEach(function (p) {
        var before = debt.cents;
        debt.cents -= p[1];
        pays.push({ debtId: debt.id, cents: p[1], date: HH.iso(t - p[0]), before: before, after: debt.cents, sample: true });
        if (debt.cents === 0) debt.paidOn = HH.iso(t - p[0]);
      });
      return debt;
    });
    pays.sort(function (a, b) { return HH.parseIso(a.date) - HH.parseIso(b.date); });
    d.payments = pays.map(function (p) { p.id = id++; return p; });
    d.meta.sample = true;
    d.meta.onboarded = true;
    d.meta.nextId = id;
    D = d;
    monthsAll = false; payFilter = "all";
    save();
    go("home");
    HH.toast("Sample data loaded. Clear it any time.", null, 4000);
  }
  function clearSample() {
    var theme = D.settings.theme, cur = D.settings.currency, next = D.meta.nextId;
    var debts = D.debts.filter(function (x) { return !x.sample; });
    var keep = {};
    debts.forEach(function (x) { keep[x.id] = 1; });
    var pays = D.payments.filter(function (x) { return !x.sample && keep[x.debtId]; });
    D = blank();
    D.settings.theme = theme; D.settings.currency = cur;
    D.debts = debts; D.payments = pays;
    D.meta.nextId = next;
    monthsAll = false; payFilter = "all";
    save();
    startWelcome();
  }

  // ── debts ────────────────────────────────────────────────────────
  function openDebt(d, from) {
    editingDebt = d || null;
    debtReturn = from || "debts";
    $("#debt-title").textContent = d ? "Change debt" : "Add a debt";
    $("#dt-name").value = d ? d.name : "";
    $("#dt-balance").value = d ? HH.plain(d.cents) : "";
    $("#dt-apr").value = d ? (d.aprBp / 100).toFixed(2).replace(/\.?0+$/, "") : "";
    $("#dt-min").value = d ? HH.plain(d.minCents) : "";
    $("#dt-start").textContent = d ? "Started at " + m(Math.max(d.startCents, d.cents)) + ". Type the balance from your latest statement any time: the plan works from it." : "";
    $("#dt-start").hidden = !d;
    $("#dt-err").hidden = true;
    $("#dt-delete").hidden = !d;
    go("debt-edit");
    $("#dt-name").focus();
  }
  function closeDebt() {
    if (debtReturn === "welcome") { go("welcome"); welcomeStep(1); } else go("debts");
  }
  function parseApr(s) {
    s = String(s == null ? "" : s).replace(/[\s%,]/g, "");
    if (!/^(\d+(\.\d{0,2})?|\.\d{1,2})$/.test(s)) return null;
    var p = s.split(".");
    return parseInt(p[0] || "0", 10) * 100 + (p[1] ? parseInt((p[1] + "0").slice(0, 2), 10) : 0);
  }
  function saveDebt(ev) {
    ev.preventDefault();
    var name = $("#dt-name").value.trim().slice(0, 40), cents = HH.parseMoney($("#dt-balance").value), apr = parseApr($("#dt-apr").value);
    var min = HH.parseMoney($("#dt-min").value.trim() === "" ? "0" : $("#dt-min").value);
    var err = !name ? "Give the debt a name, such as Credit card." :
      cents == null || (!editingDebt && cents === 0) ? "Type the balance owing as a number, such as 1200." :
      apr == null || apr > 99999 ? "Type the APR as a number, such as 19.99. Use 0 for an interest-free debt." :
      min == null ? "Type the minimum payment as a number. 0 is fine." : "";
    if (err) { $("#dt-err").textContent = err; $("#dt-err").hidden = false; return; }
    var d = editingDebt || { id: newId(), startCents: cents, paidOn: null, celebrated: false };
    var was = editingDebt ? editingDebt.cents : null;
    d.name = name; d.cents = cents; d.aprBp = apr; d.minCents = min;
    // with no payments logged yet, a new balance is a correction and moves the start with it; after that the start only rises
    var logged = editingDebt && D.payments.some(function (p) { return p.debtId === d.id; });
    d.startCents = logged ? Math.max(d.startCents, cents) : (editingDebt ? cents : d.startCents);
    if (cents === 0 && was !== 0) { d.paidOn = HH.iso(T); d.celebrated = false; }
    if (cents > 0) { d.paidOn = null; d.celebrated = false; }
    if (!editingDebt) { if (D.meta.sample) d.sample = false; D.debts.push(d); }
    save();
    closeDebt();
    HH.toast((editingDebt ? "Changed " : "Added ") + name);
  }
  function deleteDebt() {
    var d = editingDebt, i = D.debts.indexOf(d);
    if (i < 0) return;
    var pays = D.payments.filter(function (p) { return p.debtId === d.id; });
    D.debts.splice(i, 1);
    D.payments = D.payments.filter(function (p) { return p.debtId !== d.id; });
    save();
    closeDebt();
    HH.toast("Deleted " + d.name + (pays.length ? " and its " + plural(pays.length, "payment", "payments") : ""), function () { D.debts.splice(i, 0, d); D.payments = D.payments.concat(pays); save(); render(); });
  }
  function moveDebt(id, dir) {
    var ids = customOrder(), L = ids.filter(function (x) { var d = byId(D.debts, x); return d && d.cents > 0; });
    var k = L.indexOf(id), j = dir === "up" ? k - 1 : k + 1;
    if (k < 0 || j < 0 || j >= L.length) return;
    var a = ids.indexOf(L[k]), b = ids.indexOf(L[j]);
    ids[a] = L[j]; ids[b] = L[k];
    D.settings.customOrder = ids;
    save();
    render();
    var btn = $('[data-move="' + dir + ":" + id + '"]');
    if (btn && !btn.disabled) btn.focus();
  }
  function dropDebt(fromId, toId) {
    if (fromId === toId) return;
    var ids = customOrder(), L = ids.filter(function (x) { var d = byId(D.debts, x); return d && d.cents > 0; });
    var rest = ids.filter(function (x) { return L.indexOf(x) < 0; });
    var from = L.indexOf(fromId), to = L.indexOf(toId);
    if (from < 0 || to < 0) return;
    L.splice(from, 1);
    L.splice(to, 0, fromId);
    D.settings.customOrder = L.concat(rest);
    save();
    render();
  }
  function savePlan() {
    var c = HH.parseMoney($("#d-monthly").value.trim() === "" ? "0" : $("#d-monthly").value);
    if (c == null) { $("#d-err").textContent = "Type the monthly amount as a number, such as 650."; $("#d-err").hidden = false; return; }
    $("#d-err").hidden = true;
    D.settings.monthlyCents = c;
    D.settings.method = ($$('input[name="method"]').filter(function (r) { return r.checked; })[0] || {}).value || "Snowball";
    save();
    render();
  }

  // ── payments ─────────────────────────────────────────────────────
  function openPay(debt, from) {
    var L = live();
    if (!L.length) { HH.toast("Every debt is paid off. There's nothing to log."); return; }
    payReturn = from || "home";
    var pick = debt && debt.cents > 0 ? debt : focusDebt();
    $("#p-debt").innerHTML = L.map(function (d) { return '<option value="' + d.id + '">' + esc(d.name) + "</option>"; }).join("");
    $("#p-debt").value = String(pick.id);
    $("#p-amount").value = "";
    $("#p-balance").value = "";
    HH.setDate($("#p-date"), HH.iso(T));
    $("#p-date").max = HH.iso(T);
    $("#p-day-text").textContent = "Today";
    $("#p-day-wrap").hidden = true;
    $("#p-err").hidden = true;
    owingLine();
    go("pay-edit");
    $("#p-amount").focus();
  }
  function owingLine() {
    var d = byId(D.debts, +$("#p-debt").value);
    $("#p-owing").textContent = d ? d.name + " owes " + m(d.cents) + " now · minimum " + m(d.minCents) : "";
  }
  function savePay(ev) {
    ev.preventDefault();
    var d = byId(D.debts, +$("#p-debt").value), cents = HH.parseMoney($("#p-amount").value), day = HH.parseIso($("#p-date").value);
    var balTxt = $("#p-balance").value.trim(), typed = balTxt === "" ? null : HH.parseMoney(balTxt);
    var err = !d ? "Pick the debt you paid." : cents == null || cents <= 0 ? "Type the amount as a number, such as 75." :
      day == null ? "Pick the day you paid it." : day > T ? "Pick today or an earlier day." :
      balTxt !== "" && typed == null ? "Type the balance after it as a number, or leave it blank." :
      typed == null && cents > d.cents ? "That's more than " + d.name + " owes (" + m(d.cents) + "). Type " + m(d.cents) + " or less." : "";
    if (err) { $("#p-err").textContent = err; $("#p-err").hidden = false; $("#p-amount").focus(); return; }
    var before = { cents: d.cents, startCents: d.startCents, paidOn: d.paidOn, celebrated: d.celebrated };
    var after = typed == null ? d.cents - cents : typed;
    var p = { id: newId(), debtId: d.id, cents: cents, date: HH.iso(day), before: d.cents, after: after };
    if (D.meta.sample) p.sample = false;
    D.payments.push(p);
    d.cents = after;
    d.startCents = Math.max(d.startCents, after);
    if (after === 0) { d.paidOn = HH.iso(day); d.celebrated = false; } else { d.paidOn = null; d.celebrated = false; }
    save();
    go(after === 0 ? "home" : payReturn);
    HH.toast(after === 0 ? "Saved. " + d.name + " is paid off ✓" : "Saved " + m(cents) + " to " + d.name + " · " + m(after) + " left", function () {
      D.payments = D.payments.filter(function (x) { return x.id !== p.id; });
      d.cents = before.cents; d.startCents = before.startCents; d.paidOn = before.paidOn; d.celebrated = before.celebrated;
      save(); render();
    });
  }
  function deletePay(id) {
    var p = byId(D.payments, id);
    if (!p) return;
    var d = byId(D.debts, p.debtId), back = p.before - p.after;
    HH.confirmStep({
      title: "Delete this payment?", yes: "Delete payment", no: "Keep it", danger: true,
      text: d ? "Its " + m(p.cents) + " goes back on " + d.name + "'s balance, which becomes " + m(Math.max(0, d.cents + back)) + "." : "It goes from the log.",
      onYes: function () {
        var i = D.payments.indexOf(p), prev = d ? { cents: d.cents, paidOn: d.paidOn, celebrated: d.celebrated } : null;
        D.payments.splice(i, 1);
        if (d) {
          d.cents = Math.max(0, d.cents + back);
          d.startCents = Math.max(d.startCents, d.cents);
          if (d.cents > 0) { d.paidOn = null; d.celebrated = false; }
        }
        save();
        render();
        HH.toast("Deleted the " + m(p.cents) + " payment" + (d ? " · " + d.name + " owes " + m(d.cents) : ""), function () {
          D.payments.splice(i, 0, p);
          if (d) { d.cents = prev.cents; d.paidOn = prev.paidOn; d.celebrated = prev.celebrated; }
          save(); render();
        });
      }
    });
  }

  // ── what-if ──────────────────────────────────────────────────────
  function setExtra(txt) {
    var c = HH.parseMoney(String(txt).trim() === "" ? "0" : txt);
    if (c == null) { $("#wi-err").textContent = "Type the extra as a number, such as 50."; $("#wi-err").hidden = false; return; }
    $("#wi-err").hidden = true;
    D.settings.whatIfCents = c;
    save();
    render();
  }
  function applyWhatIf() {
    var was = D.settings.monthlyCents, now = was + D.settings.whatIfCents;
    D.settings.monthlyCents = now;
    save();
    go("plan");
    HH.toast("Your plan now pays " + m(now) + " a month", function () { D.settings.monthlyCents = was; save(); render(); });
  }

  // ── settings ─────────────────────────────────────────────────────
  function setCurrency(c) {
    c = String(c || "").trim().slice(0, 4) || "$";
    D.settings.currency = c;
    save();
    render();
    $("#s-saved").textContent = "Saved. Amounts now show as " + m(123456) + ".";
  }

  // ── backup and restore ───────────────────────────────────────────
  function backup() {
    T = HH.today();
    D.meta.lastBackup = HH.iso(T);
    D.meta.reminderDismissed = null;
    save();
    var name = "hollowayhart-debt-payoff-app-backup-" + HH.iso(T) + ".json";
    var mode = HH.saveFile(name, JSON.stringify({ app: APP_ID, schema: SCHEMA, made: HH.iso(T), data: D }, null, 2));
    render();
    HH.toast(HH.savedMessage(mode, name), null, 6000);
  }
  function readBackup(text) {
    var o;
    try { o = JSON.parse(text); } catch (e) { return { error: "broken" }; }
    if (!o || typeof o !== "object") return { error: "broken" };
    if (o.app !== APP_ID) return typeof o.app === "string" && o.app.indexOf("hollowayhart-") === 0 ? { error: "other" } : { error: "broken" };
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
      if (r.error === "other") {
        restoreMsg('<p class="err" id="restore-refused">This backup is from another Holloway &amp; Hart app, not the Debt Payoff App, so it can\'t be ' +
          "restored here. Nothing was changed.</p>");
        return;
      }
      if (r.error === "newer") {
        restoreMsg('<p class="err" id="restore-refused">This backup was made by a newer version of the app, so this copy can\'t read it. ' +
          "Nothing was changed.</p>");
        return;
      }
      if (r.error) {
        restoreMsg('<p class="err" id="restore-refused">This file isn\'t a backup from this app, or it is damaged. Nothing was changed.</p>');
        return;
      }
      pendingRestore = r.data;
      var d = r.data;
      restoreMsg('<div class="banner" id="restore-summary"><strong>This backup has</strong>' +
        plural(d.debts.length, "debt", "debts") + " · " + plural(d.payments.length, "payment", "payments") +
        (r.made != null ? " · made " + HH.fmtLong(r.made) : "") +
        '<p class="small" style="margin-top:6px">Restoring replaces everything in the app now.</p>' +
        '<div class="row-buttons"><button type="button" class="btn btn-primary" id="restore-yes">Replace with this backup</button>' +
        '<button type="button" class="btn btn-quiet" id="restore-no">Cancel</button></div></div>');
      $("#restore-yes").addEventListener("click", function () {
        D = pendingRestore; pendingRestore = null;
        save();
        restoreMsg("");
        monthsAll = false; payFilter = "all";
        if (!D.meta.onboarded) startWelcome(); else go("home");
        HH.toast("Backup restored.");
      });
      $("#restore-no").addEventListener("click", function () { pendingRestore = null; restoreMsg(""); });
    });
  }
  function startFresh() {
    HH.confirmStep({
      title: "Start fresh?", yes: "Next", no: "Keep my data",
      text: "This deletes your debts, your plan and your payments from this browser. If you might want them again, cancel and use Back up now first.",
      onYes: function () {
        HH.confirmStep({
          title: "Delete everything now?", yes: "Yes, delete everything", no: "Cancel", danger: true,
          text: "This can't be undone without a backup.",
          onYes: function () {
            var theme = D.settings.theme;
            D = blank(); D.settings.theme = theme;
            monthsAll = false; payFilter = "all";
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
    $("#pay-btn").addEventListener("click", function () { openPay(null, "home"); });
    $("#pay-add").addEventListener("click", function () { openPay(null, "payments"); });
    $("#pay-form").addEventListener("submit", savePay);
    $("#p-cancel").addEventListener("click", function () { go(payReturn); });
    $("#p-debt").addEventListener("change", owingLine);
    $("#p-day-change").addEventListener("click", function () { $("#p-day-wrap").hidden = false; $("#p-date").focus(); });
    $("#p-date").addEventListener("change", function () {
      var d = HH.parseIso($("#p-date").value);
      $("#p-day-text").textContent = d == null ? "?" : d === T ? "Today" : HH.fmtDate(d, true);
    });
    $("#pay-filter").addEventListener("change", function () { payFilter = $("#pay-filter").value; renderPayments(); });
    $("#debt-add").addEventListener("click", function () { openDebt(null, "debts"); });
    $("#debt-form").addEventListener("submit", saveDebt);
    $("#dt-cancel").addEventListener("click", closeDebt);
    $("#dt-delete").addEventListener("click", deleteDebt);
    $("#d-monthly").addEventListener("change", savePlan);
    $("#d-form").addEventListener("submit", function (ev) { ev.preventDefault(); savePlan(); });
    $$('input[name="method"]').forEach(function (r) { r.addEventListener("change", savePlan); });
    $("#months-all").addEventListener("click", function () { monthsAll = !monthsAll; renderMonths(); });
    $("#wi-extra").addEventListener("change", function () { setExtra($("#wi-extra").value); });
    $("#wi-form").addEventListener("submit", function (ev) { ev.preventDefault(); setExtra($("#wi-extra").value); });
    $("#wi-apply").addEventListener("click", applyWhatIf);
    var order = $("#plan-order");
    order.addEventListener("dragstart", function (ev) {
      var li = ev.target.closest ? ev.target.closest("li[data-order]") : null;
      if (!li || D.settings.method !== "Custom") return;
      dragId = +li.getAttribute("data-order");
      li.classList.add("dragging");
      try { ev.dataTransfer.effectAllowed = "move"; ev.dataTransfer.setData("text/plain", String(dragId)); } catch (e) { /* older browsers */ }
    });
    order.addEventListener("dragover", function (ev) { if (dragId != null) ev.preventDefault(); });
    order.addEventListener("drop", function (ev) {
      var li = ev.target.closest ? ev.target.closest("li[data-order]") : null;
      if (dragId == null || !li) return;
      ev.preventDefault();
      var from = dragId;
      dragId = null;
      dropDebt(from, +li.getAttribute("data-order"));
    });
    order.addEventListener("dragend", function () { dragId = null; $$("#plan-order li.dragging").forEach(function (x) { x.classList.remove("dragging"); }); });
    document.addEventListener("click", function (ev) {
      var t = ev.target.closest ? ev.target.closest("[data-edit-debt],[data-move],[data-del-pay],[data-ack],[data-extra],[data-clear-sample]," +
        "[data-backup],[data-dismiss-backup],[data-go]") : null;
      if (!t || t.disabled) return;
      if (t.hasAttribute("data-edit-debt")) openDebt(byId(D.debts, +t.getAttribute("data-edit-debt")), $("#tabs").hidden ? "welcome" : "debts");
      else if (t.hasAttribute("data-move")) { var mv = t.getAttribute("data-move").split(":"); moveDebt(+mv[1], mv[0]); }
      else if (t.hasAttribute("data-del-pay")) deletePay(+t.getAttribute("data-del-pay"));
      else if (t.hasAttribute("data-ack")) { var d = byId(D.debts, +t.getAttribute("data-ack")); if (d) { d.celebrated = true; save(); render(); } }
      else if (t.hasAttribute("data-extra")) { $("#wi-extra").value = t.getAttribute("data-extra"); setExtra(t.getAttribute("data-extra")); }
      else if (t.hasAttribute("data-clear-sample")) clearSample();
      else if (t.hasAttribute("data-backup")) backup();
      else if (t.hasAttribute("data-dismiss-backup")) { D.meta.reminderDismissed = HH.iso(T); save(); renderBanners(); }
      else if (t.hasAttribute("data-go")) go(t.getAttribute("data-go"));
    });
    document.addEventListener("change", function (ev) {
      var t = ev.target;
      if (t && t.name === "cur") setCurrency(t.value);
      if (t && t.name === "w-cur") { D.settings.currency = t.value; save(); welcomeHint(); }
    });
    $("#s-cur").addEventListener("change", function () { setCurrency($("#s-cur").value); });
    $("#set-form").addEventListener("submit", function (ev) { ev.preventDefault(); setCurrency($("#s-cur").value); });
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
    $("#w-sample").addEventListener("click", loadSample);
    $("#w-debt-add").addEventListener("click", function () { openDebt(null, "welcome"); });
    $("#w-debts-next").addEventListener("click", function () {
      if (!live().length) { $("#w-debt-err").textContent = "Add at least one debt with a balance owing, or try the sample first."; $("#w-debt-err").hidden = false; return; }
      $("#w-debt-err").hidden = true;
      welcomeStep(2);
    });
    $("#w-back").addEventListener("click", function () { welcomeStep(1); });
    $("#w-plan").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var c = HH.parseMoney($("#w-monthly").value), mins = minsTotal();
      var err = c == null ? "Type what you can pay each month as a number, such as 650." :
        c < mins ? "That's below your minimums (" + m(mins) + "). Type " + m(mins) + " or more." : "";
      if (err) { $("#w-err").textContent = err; $("#w-err").hidden = false; return; }
      D.settings.monthlyCents = c;
      D.settings.method = ($$('input[name="w-method"]').filter(function (r) { return r.checked; })[0] || {}).value || "Snowball";
      save();
      welcomeStep(3);
    });
    $("#w-finish").addEventListener("click", function () { D.meta.onboarded = true; save(); go("home"); });
    document.addEventListener("visibilitychange", function () { if (!document.hidden && D.meta.onboarded) render(); });
  }
  function welcomeHint() {
    $("#w-monthly-hint").textContent = "Your minimums add up to " + m(minsTotal()) + ". Anything more is extra, and goes to one debt at a time.";
  }

  // ── start ────────────────────────────────────────────────────────
  function start() {
    var raw = store.read();
    if (raw) {
      var r = migrate(raw);
      if (r.data) D = r.data;
      else {
        try { window.localStorage.setItem("hh138_unreadable_" + HH.iso(HH.today()), JSON.stringify(raw)); } catch (e) { /* nothing more to do */ }
        D = blank();
      }
    } else D = blank();
    wire();
    if (D.meta.onboarded) go("home"); else startWelcome();
  }

  // for the QA runner (qa/app_qa138.py): the same maths the screens use
  window.HH138 = { payoff: payoff, extraNeeded: extraNeeded, minimumsOnly: minimumsOnly, summary: summary, customOrder: customOrder,
    migrate: migrate, SCHEMA: SCHEMA, APP_ID: APP_ID, data: function () { return D; } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
