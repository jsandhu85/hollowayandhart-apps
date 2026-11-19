window.HH_BUILD = {"id": "137", "version": "18Nov2026.7", "hosted": true};
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

/* Product 137: 2027 Annual Budget App (specs/money/137-2027-annual-budget-app.yaml), 18 Nov 2026.
   The whole year in one app: a plan for every month, budget vs actual by month, a bills calendar (72's bill maths, unchanged),
   sinking funds, savings goals (72's), net worth (72's, no debts screen) and a calm year review. The year is a setting
   (default 2027, or the current year once past 2027). Money is integer cents; dates are day numbers from HH (apps/core.js). */
(function () {
  "use strict";
  var SCHEMA = 1;
  var APP_ID = "hollowayhart-annual-budget";
  var BILL_FREQ = ["Weekly", "Fortnightly", "Monthly", "Quarterly", "Yearly", "One-off"];
  var DEFAULT_CATS = ["Housing", "Groceries", "Transport", "Utilities", "Health", "Fun", "Kids", "Pets", "Gifts", "Other"];
  var ASSET_TYPES = ["Cash & savings", "Property", "Investments", "Super & retirement", "Vehicle", "Other"];
  var LIAB_TYPES = ["Mortgage", "Loan", "Credit card", "Other"];
  var CURRENCIES = ["$", "AU$", "US$", "£", "€"];
  var LISTS = ["spends", "income", "bills", "funds", "goals", "assets", "liabilities", "snapshots"];
  var STEP = { Weekly: 7, Fortnightly: 14 };
  var MONTHS = { Monthly: 1, Quarterly: 3, Yearly: 12 };
  var REMIND_DAYS = 30;
  var MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var $ = HH.$, $$ = HH.$$, esc = HH.esc;
  var store = new HH.Store("hh137_");
  var D = null;
  var T = HH.today();
  var editingEntry = null, entryKind = "spend", editingBill = null, editingFund = null, editingGoal = null;
  var moneyFor = null, editingItem = null, itemKind = "asset", pendingRestore = null;
  var monYm = null, calYm = null, planYm = null, planReturn = "months", openHist = {};

  // ── data ──────────────────────────────────────────────────────────
  function defaultYear() { return Math.max(2027, HH.ymd(HH.today()).y); }
  function blank() {
    return {
      schema: SCHEMA,
      settings: { currency: "$", year: defaultYear(), theme: "auto", cats: DEFAULT_CATS.slice() },
      plan: {}, spends: [], income: [], bills: [], funds: [], goals: [], assets: [], liabilities: [], snapshots: [],
      meta: { created: HH.iso(HH.today()), lastBackup: null, reminderDismissed: null, sample: false, onboarded: false, nextId: 1 }
    };
  }
  function isInt(x) { return typeof x === "number" && isFinite(x) && Math.floor(x) === x; }
  function isCents(x) { return isInt(x) && x >= 0; }
  function isDate(s) { return HH.parseIso(s) != null; }
  function isYm(s) { var mm = /^(\d{4})-(\d{2})$/.exec(String(s || "")); return !!mm && +mm[2] >= 1 && +mm[2] <= 12; }
  function isName(s, n) { return typeof s === "string" && s.length > 0 && s.length <= n; }
  function isMonths12(a) { return Array.isArray(a) && a.length === 12 && a.every(isCents); }
  function validate(d) {
    try {
      var s = d.settings, m = d.meta, i, j, x, k, c;
      if (d.schema !== SCHEMA || !s || !m) return false;
      if (!LISTS.every(function (key) { return Array.isArray(d[key]); })) return false;
      if (!d.plan || typeof d.plan !== "object" || Array.isArray(d.plan)) return false;
      for (k in d.plan) {
        var p = d.plan[k];
        if (!/^\d{4}$/.test(k) || !p || !isMonths12(p.income) || !p.cats || typeof p.cats !== "object" || Array.isArray(p.cats)) return false;
        for (c in p.cats) if (!isMonths12(p.cats[c])) return false;
      }
      if (typeof s.currency !== "string" || s.currency.length > 4) return false;
      if (!isInt(s.year) || s.year < 2000 || s.year > 2100) return false;
      if (["auto", "light", "dark"].indexOf(s.theme) < 0) return false;
      if (!Array.isArray(s.cats) || !s.cats.length || !s.cats.every(function (cat) { return isName(cat, 30); })) return false;
      if (!isDate(m.created) || !(m.lastBackup === null || isDate(m.lastBackup))) return false;
      if (!(m.reminderDismissed === null || isDate(m.reminderDismissed))) return false;
      if (typeof m.sample !== "boolean" || typeof m.onboarded !== "boolean" || !isInt(m.nextId)) return false;
      for (i = 0; i < d.spends.length; i++) {
        x = d.spends[i];
        if (!isInt(x.id) || !isInt(x.cents) || x.cents <= 0 || !isDate(x.date) || typeof x.note !== "string" || typeof x.cat !== "string") return false;
      }
      for (i = 0; i < d.income.length; i++) {
        x = d.income[i];
        if (!isInt(x.id) || !isInt(x.cents) || x.cents <= 0 || !isDate(x.date) || typeof x.note !== "string") return false;
      }
      for (i = 0; i < d.bills.length; i++) {
        x = d.bills[i];
        if (!isInt(x.id) || !isName(x.name, 40) || !isInt(x.cents) || x.cents <= 0) return false;
        if (BILL_FREQ.indexOf(x.freq) < 0 || !isDate(x.due) || typeof x.auto !== "boolean") return false;
      }
      for (i = 0; i < d.funds.length; i++) {
        x = d.funds[i];
        if (!isInt(x.id) || !isName(x.name, 40) || !isInt(x.targetCents) || x.targetCents <= 0 || !isCents(x.savedCents)) return false;
        if (!isYm(x.due) || !Array.isArray(x.log)) return false;
        for (j = 0; j < x.log.length; j++) if (!isDate(x.log[j].date) || !isInt(x.log[j].cents) || x.log[j].cents === 0) return false;
      }
      for (i = 0; i < d.goals.length; i++) {
        x = d.goals[i];
        if (!isInt(x.id) || !isName(x.name, 40) || !isInt(x.targetCents) || x.targetCents <= 0 || !isCents(x.savedCents)) return false;
        if (!(x.targetDate === null || isDate(x.targetDate)) || !Array.isArray(x.deposits)) return false;
        for (j = 0; j < x.deposits.length; j++) if (!isDate(x.deposits[j].date) || !isInt(x.deposits[j].cents)) return false;
      }
      for (i = 0; i < d.assets.length; i++) {
        x = d.assets[i];
        if (!isInt(x.id) || !isName(x.name, 40) || !isName(x.type, 30) || !isCents(x.cents)) return false;
      }
      for (i = 0; i < d.liabilities.length; i++) {
        x = d.liabilities[i];
        if (!isInt(x.id) || !isName(x.name, 40) || !isName(x.type, 30) || !isCents(x.cents)) return false;
      }
      for (i = 0; i < d.snapshots.length; i++) {
        x = d.snapshots[i];
        if (!isDate(x.date) || !isInt(x.assets) || !isInt(x.liabilities) || !isInt(x.net)) return false;
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
  function hasOwn() {
    if (LISTS.slice(0, 7).some(function (k) { return own(D[k]); })) return true;
    return !D.meta.sample && Object.keys(D.plan).some(function (y) { return hasPlan(+y); });
  }
  function byId(list, id) { return list.filter(function (x) { return x.id === id; })[0]; }

  // ── months and years ─────────────────────────────────────────────
  function pad2(x) { return (x < 10 ? "0" : "") + x; }
  function ymKey(y, mo) { return y + "-" + pad2(mo); }
  function ymOf(dayNo) { var a = HH.ymd(dayNo); return ymKey(a.y, a.m); }
  function ymParts(ym) { return { y: +ym.slice(0, 4), m: +ym.slice(5, 7) }; }
  function ymLabel(ym) { var a = ymParts(ym); return MO[a.m - 1] + " " + a.y; }
  function ymIdx(y, mo) { return y * 12 + (mo - 1); }
  function ymFromIdx(i) { var y = Math.floor(i / 12); return ymKey(y, i - y * 12 + 1); }
  function ymRange(ym) { var a = ymParts(ym); return { first: HH.dn(a.y, a.m, 1), last: HH.dn(a.y, a.m, HH.lastDay(a.y, a.m)) }; }
  function yearState(y) { var ty = HH.ymd(T).y; return ty === y ? "now" : ty < y ? "ahead" : "past"; }
  // the month the Home card and the Months picker open on: today's month in the year, January before it, December after it
  function focusMonth(y) { var a = HH.ymd(T); return a.y === y ? a.m : a.y < y ? 1 : 12; }
  function yearOptions() {
    var ty = HH.ymd(T).y, cur = D.settings.year, lo = Math.min(2025, ty - 1, cur), hi = Math.max(2040, ty + 5, cur), out = [];
    for (var y = lo; y <= hi; y++) out.push(y);
    return out;
  }

  // ── the plan ─────────────────────────────────────────────────────
  function zeros() { return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; }
  function pos(x) { return x > 0; }
  function planOf(y) { return D.plan[String(y)] || null; }
  function planInc(y, mo) { var p = planOf(y); return p ? p.income[mo - 1] : 0; }
  function planCat(y, mo, c) { var p = planOf(y); return p && p.cats[c] ? p.cats[c][mo - 1] : 0; }
  function planSpend(y, mo) { var t = 0; D.settings.cats.forEach(function (c) { t += planCat(y, mo, c); }); return t; }
  function hasPlan(y) {
    var p = planOf(y);
    if (!p) return false;
    if (p.income.some(pos)) return true;
    for (var c in p.cats) if (p.cats[c].some(pos)) return true;
    return false;
  }
  function ensurePlan(y) { var k = String(y); if (!D.plan[k]) D.plan[k] = { income: zeros(), cats: {} }; return D.plan[k]; }

  // ── a year in numbers: each month's plan against what was logged ──
  function yearStats(y) {
    var months = [], i;
    for (i = 1; i <= 12; i++) months.push({ m: i, incPlan: planInc(y, i), spPlan: planSpend(y, i), incAct: 0, spAct: 0, cats: {}, n: 0 });
    var catYear = {};
    D.spends.forEach(function (x) {
      var a = HH.ymd(HH.parseIso(x.date));
      if (a.y !== y) return;
      var r = months[a.m - 1], k = x.cat || "Other";
      r.spAct += x.cents; r.n++;
      r.cats[k] = (r.cats[k] || 0) + x.cents;
      catYear[k] = (catYear[k] || 0) + x.cents;
    });
    D.income.forEach(function (x) {
      var a = HH.ymd(HH.parseIso(x.date));
      if (a.y !== y) return;
      months[a.m - 1].incAct += x.cents; months[a.m - 1].n++;
    });
    var out = { y: y, months: months, catYear: catYear, incPlan: 0, spPlan: 0, incAct: 0, spAct: 0, n: 0 };
    months.forEach(function (r) {
      r.left = r.incAct - r.spAct;
      out.incPlan += r.incPlan; out.spPlan += r.spPlan; out.incAct += r.incAct; out.spAct += r.spAct; out.n += r.n;
    });
    out.left = out.incAct - out.spAct;
    return out;
  }
  function monthRows(ys, mo) {
    var r = ys.months[mo - 1], extra = [];
    Object.keys(r.cats).forEach(function (k) { if (D.settings.cats.indexOf(k) < 0) extra.push(k); });
    extra.sort();
    return D.settings.cats.concat(extra).map(function (c) {
      var planned = D.settings.cats.indexOf(c) >= 0 ? planCat(ys.y, mo, c) : 0, a = r.cats[c] || 0;
      return { cat: c, planned: planned, actual: a, left: planned - a };
    });
  }
  function otherYears(y) {
    var seen = {};
    D.spends.concat(D.income).forEach(function (x) { var yy = HH.ymd(HH.parseIso(x.date)).y; if (yy !== y) seen[yy] = (seen[yy] || 0) + 1; });
    return Object.keys(seen).map(function (k) { return { y: +k, n: seen[k] }; }).sort(function (a, b) { return b.y - a.y; });
  }

  // ── the year review (the spec's review_maths) ────────────────────
  function review(ys) {
    var y = ys.y, cur = yearState(y) === "now" ? HH.ymd(T).m : 0;
    var done = ys.months.filter(function (r) { return r.n > 0 && r.m !== cur; });
    var planned = 0, actual = 0, within = 0, best = null, worst = null;
    done.forEach(function (r) { planned += r.spPlan; actual += r.spAct; if (r.spAct <= r.spPlan) within++; });
    if (done.length >= 2) {
      done.forEach(function (r) {
        if (!best || r.left > best.left) best = r;
        if (!worst || r.left < worst.left) worst = r;
      });
    }
    var saved = 0;
    D.goals.forEach(function (g) { g.deposits.forEach(function (x) { if (HH.ymd(HH.parseIso(x.date)).y === y) saved += x.cents; }); });
    D.funds.forEach(function (f) { f.log.forEach(function (x) { if (HH.ymd(HH.parseIso(x.date)).y === y) saved += x.cents; }); });
    var first = HH.dn(y, 1, 1), last = HH.dn(y, 12, 31), before = null, firstIn = null, lastIn = null;
    D.snapshots.slice().sort(function (a, b) { return HH.parseIso(a.date) - HH.parseIso(b.date); }).forEach(function (s) {
      var dd = HH.parseIso(s.date);
      if (dd < first) before = s;
      else if (dd <= last) { if (!firstIn) firstIn = s; lastIn = s; }
    });
    var from = before || firstIn, nw = from && lastIn && from !== lastIn ? { from: from, to: lastIn, change: lastIn.net - from.net } : null;
    return { done: done, planned: planned, actual: actual, within: within, best: best, worst: worst, saved: saved, nw: nw, cur: cur };
  }

  // ── bills (72's maths, unchanged) ────────────────────────────────
  function occBefore(t, due, freq) {
    if (STEP[freq]) return Math.floor((t - due - 1) / STEP[freq]) + 1;
    if (MONTHS[freq]) {
      var mm = MONTHS[freq], kc = Math.floor(HH.monthsBetween(due, t) / mm);
      return kc + (HH.addMonths(due, kc * mm) < t ? 1 : 0);
    }
    return t > due ? 1 : 0;
  }
  function occAt(due, freq, n) {
    if (STEP[freq]) return due + STEP[freq] * n;
    if (MONTHS[freq]) return HH.addMonths(due, MONTHS[freq] * n);
    return n === 0 ? due : null;
  }
  function nextDue(b, t) {
    var due = HH.parseIso(b.due);
    return occAt(due, b.freq, occBefore(t, due, b.freq));
  }
  function monthOccurrences(ym) {
    var r = ymRange(ym), byDay = {}, total = 0, count = 0;
    D.bills.forEach(function (b) {
      var due = HH.parseIso(b.due), n = occBefore(r.first, due, b.freq), dd = occAt(due, b.freq, n);
      while (dd != null && dd <= r.last) {
        if (dd >= r.first) { (byDay[dd] = byDay[dd] || []).push(b); total += b.cents; count++; }
        n++; dd = occAt(due, b.freq, n);
      }
    });
    return { byDay: byDay, total: total, count: count, range: r };
  }
  function yearBills(y) {
    var total = 0, count = 0;
    for (var mo = 1; mo <= 12; mo++) { var o = monthOccurrences(ymKey(y, mo)); total += o.total; count += o.count; }
    return { total: total, count: count };
  }
  function billRows(t) {
    return D.bills.map(function (b) { return { b: b, next: nextDue(b, t) }; }).sort(function (x, y) {
      if (x.next == null && y.next == null) return x.b.id - y.b.id;
      if (x.next == null) return 1;
      if (y.next == null) return -1;
      return x.next - y.next || x.b.id - y.b.id;
    });
  }

  // ── sinking funds and goals ──────────────────────────────────────
  function fundStats(f) {
    var due = ymParts(f.due), a = HH.ymd(T), raw = ymIdx(due.y, due.m) - ymIdx(a.y, a.m);
    var left = Math.max(0, f.targetCents - f.savedCents), months = Math.max(1, raw), frac = Math.min(1, f.savedCents / f.targetCents);
    return { left: left, raw: raw, months: months, monthly: left > 0 ? Math.ceil(left / months) : 0, frac: frac,
             pct: Math.round(frac * 100), ready: f.savedCents >= f.targetCents };
  }
  function fundsTotal() {
    var tot = 0, n = 0;
    D.funds.forEach(function (f) { var s = fundStats(f); if (!s.ready) { tot += s.monthly; n++; } });
    return { total: tot, n: n };
  }
  function goalStats(g) {
    var left = Math.max(0, g.targetCents - g.savedCents), frac = g.targetCents ? Math.min(1, g.savedCents / g.targetCents) : 0;
    var pct = Math.round(frac * 100), monthly = null, months = null;
    if (g.targetDate) {
      months = Math.max(1, HH.monthsBetween(T, HH.parseIso(g.targetDate)));
      monthly = Math.ceil(left / months);
    }
    return { left: left, frac: frac, pct: pct, monthly: monthly, months: months, done: g.savedCents >= g.targetCents };
  }

  // ── net worth ────────────────────────────────────────────────────
  function netWorth() {
    var a = 0, l = 0;
    D.assets.forEach(function (x) { a += x.cents; });
    D.liabilities.forEach(function (x) { l += x.cents; });
    return { assets: a, liabilities: l, net: a - l };
  }

  // ── wording helpers ──────────────────────────────────────────────
  function m(c) { return HH.money(c, D.settings.currency); }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
  function inDays(dd, t) {
    var k = dd - t;
    if (k === 0) return "today";
    if (k === 1) return "tomorrow";
    if (k > 1) return "in " + k + " days";
    if (k === -1) return "yesterday";
    return plural(-k, "day", "days") + " ago";
  }
  function leftText(left) { return left < 0 ? m(-left) + " over" : m(left) + " left"; }
  function leftOver(c) { return c < 0 ? m(-c) + " more out than in" : m(c) + " left over"; }
  function leftPlain(c) { return c < 0 ? m(-c) + " more out than in" : m(c); }
  function blocks(frac) {
    var on = Math.max(0, Math.min(20, Math.round(frac * 20))), h = '<span class="blocks" aria-hidden="true">';
    for (var i = 0; i < 20; i++) h += '<i class="' + (i < on ? "on" : "") + '"></i>';
    return h + "</span>";
  }
  function share(actual, planned) { return planned > 0 ? actual / planned : (actual > 0 ? 1 : 0); }
  function chart(pairs, cls, focusIdx) {
    var max = 1;
    pairs.forEach(function (v) { max = Math.max(max, v[0], v[1]); });
    var hgt = function (v) { return v > 0 ? Math.max(1.5, Math.round(v / max * 1000) / 10) : 0; };
    return pairs.map(function (v, i) {
      return '<div class="col' + (i === focusIdx ? " focus" : "") + '"><div class="bars"><i class="b ' + cls[0] + '" style="height:' + hgt(v[0]) +
        '%"></i><i class="b ' + cls[1] + '" style="height:' + hgt(v[1]) + '%"></i></div><span class="ml">' + MO[i] + "</span></div>";
    }).join("");
  }

  // ── rendering ────────────────────────────────────────────────────
  function render() {
    T = HH.today();
    HH.applyTheme(D.settings.theme);
    var ys = yearStats(D.settings.year);
    renderBanners();
    renderHome(ys);
    renderMonths(ys);
    renderBills();
    renderSavings();
    renderNetWorth();
    renderReview(ys);
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
      h += '<div class="banner slim" id="sample-banner"><span><span class="sample-flag">SAMPLE</span> · a made-up year</span>' +
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
  function renderHome(ys) {
    var y = ys.y, st = yearState(y), fm = focusMonth(y), r = ys.months[fm - 1];
    $("#home-title").textContent = "Your " + y;
    var note = st === "ahead" && ys.n === 0 ? "Plan now: " + y + " starts on " + HH.fmtDate(HH.dn(y, 1, 1), true) + "." :
      st === "past" ? y + " is over. Its numbers stay here; pick another year in Settings." : "";
    $("#yr-note").textContent = note;
    $("#yr-note").hidden = !note;
    $("#yr-left-label").textContent = ys.left >= 0 ? "Left over in " + y : "Spent more than came in, " + y;
    $("#yr-left").textContent = m(Math.abs(ys.left));
    $("#yr-left-cap").textContent = "Income " + m(ys.incAct) + " · spending " + m(ys.spAct);
    var other = otherYears(y), box = $("#other-years");
    box.innerHTML = other.length ? '<span id="other-years-text">Also logged: ' + other.map(function (o) { return plural(o.n, "entry", "entries") + " in " + o.y; }).join(", ") +
      "</span>" + other.slice(0, 2).map(function (o) { return '<button type="button" class="btn btn-quiet" data-show-year="' + o.y + '">Show ' + o.y + "</button>"; }).join("") : "";
    box.hidden = !other.length;
    $("#focus-title").textContent = MONTH[fm - 1] + " " + y;
    $("#focus-spent").textContent = m(r.spAct) + " of " + m(r.spPlan) + " planned";
    $("#focus-blocks").innerHTML = blocks(share(r.spAct, r.spPlan)) + ' <span class="small muted">' + leftText(r.spPlan - r.spAct) + "</span>";
    $("#focus-income").textContent = m(r.incAct) + " of " + m(r.incPlan) + " planned";
    $("#focus-left").textContent = leftPlain(r.left);
    $("#home-chart").innerHTML = chart(ys.months.map(function (x) { return [x.spPlan, x.spAct]; }), ["plan", "act"], st === "now" ? fm - 1 : -1);
    $("#home-chart").setAttribute("aria-label", "Planned spending and spending for each month of " + y + ". The numbers are on the Months and Review tabs.");
    $("#home-chart-cap").textContent = "Each month of " + y + ": what you planned to spend, beside what you spent.";
    $("#plan-year-title").textContent = "Planned for " + y;
    $("#py-income").textContent = m(ys.incPlan);
    $("#py-spend").textContent = m(ys.spPlan);
    $("#py-left").textContent = leftPlain(ys.incPlan - ys.spPlan);
    var rows = billRows(T).filter(function (x) { return x.next != null; }).slice(0, 3);
    $("#hc-bills-list").innerHTML = rows.length ? rows.map(function (x) {
      return "<li><span>" + esc(x.b.name) + ' <span class="muted small">' + HH.fmtDate(x.next) + "</span></span><b>" + m(x.b.cents) + "</b></li>";
    }).join("") : '<li class="muted">No bills yet</li>';
    $("#hc-bills-year").textContent = D.bills.length ? "Bills in " + y + ": " + m(yearBills(y).total) : "";
    var ft = fundsTotal(), gs = 0, gt = 0;
    D.goals.forEach(function (g) { gs += g.savedCents; gt += g.targetCents; });
    $("#hc-funds-line").textContent = !D.funds.length ? "No sinking funds yet" : ft.n ? "Sinking funds: set aside " + m(ft.total) + " a month" : "Sinking funds: all ready";
    $("#hc-goals-line").textContent = D.goals.length ? "Goals: " + m(gs) + " of " + m(gt) + " saved" : "No goals yet";
    var nw = netWorth(), snap = D.snapshots.length ? D.snapshots[D.snapshots.length - 1] : null;
    $("#hc-nw-line").textContent = (snap ? "Latest snapshot " + m(snap.net) + " · " + HH.fmtLong(HH.parseIso(snap.date)) : "Now " + m(nw.net)) +
      (D.assets.length || D.liabilities.length ? "" : " · nothing listed yet");
    var rv = review(ys);
    $("#hc-rev-line").textContent = rv.best ? "Strongest month: " + MONTH[rv.best.m - 1] + ", " + leftOver(rv.best.left) :
      ys.n ? "Your strongest and tightest months show here once two months are over." : "Nothing logged in " + y + " yet.";
  }
  function entryRow(x, kind) {
    var dd = HH.parseIso(x.date), inc = kind === "income";
    return '<li data-entry="' + kind + ":" + x.id + '"><button type="button" class="rowbtn" data-edit-entry="' + kind + ":" + x.id + '" aria-label="Change ' +
      esc((x.note || (inc ? "income" : "spending")) + " " + m(x.cents)) + '"><span class="what"><b>' + (x.note ? esc(x.note) : '<span class="muted">No note</span>') +
      '</b><br><span class="small muted">' + HH.fmtDate(dd) + " · " + (inc ? "income" : esc(x.cat || "Other")) + '</span></span><span class="amt">' +
      (inc ? "+" : "") + m(x.cents) + '</span><span class="chev" aria-hidden="true">›</span></button></li>';
  }
  function byNewest(a, b) { return HH.parseIso(b.x.date) - HH.parseIso(a.x.date) || b.x.id - a.x.id; }
  function renderMonths(ys) {
    var y = ys.y, opts = [], i;
    for (i = 1; i <= 12; i++) opts.push(ymKey(y, i));
    if (!monYm || opts.indexOf(monYm) < 0) monYm = ymKey(y, focusMonth(y));
    $("#mon-month").innerHTML = opts.map(function (ym) { return '<option value="' + ym + '"' + (ym === monYm ? " selected" : "") + ">" + ymLabel(ym) + "</option>"; }).join("");
    var mo = ymParts(monYm).m, r = ys.months[mo - 1];
    $("#mon-income").textContent = m(r.incAct) + " of " + m(r.incPlan) + " planned";
    $("#mon-spend").textContent = m(r.spAct) + " of " + m(r.spPlan) + " planned";
    $("#mon-left").textContent = leftPlain(r.left);
    $("#mon-rows").innerHTML = monthRows(ys, mo).map(function (x) {
      return '<li data-cat="' + esc(x.cat) + '"><span class="what"><b>' + esc(x.cat) + '</b><br><span class="small muted">' +
        m(x.actual) + " of " + m(x.planned) + " planned · " + leftText(x.left) + "</span><br>" + blocks(share(x.actual, x.planned)) +
        '</span><span class="amt">' + m(x.actual) + "</span></li>";
    }).join("");
    $("#mon-planned-total").textContent = m(r.spPlan);
    $("#mon-actual-total").textContent = m(r.spAct);
    $("#mon-left-total").textContent = leftText(r.spPlan - r.spAct);
    var occ = monthOccurrences(monYm);
    $("#mon-bills").textContent = occ.count ? "Bills due in " + ymLabel(monYm) + ": " + m(occ.total) + " across " + plural(occ.count, "payment", "payments") +
      " (see the Bills tab)." : "No bills due in " + ymLabel(monYm) + ".";
    var rg = ymRange(monYm), inMonth = function (x) { var dd = HH.parseIso(x.date); return dd >= rg.first && dd <= rg.last; };
    var list = D.spends.filter(inMonth).map(function (x) { return { x: x, k: "spend" }; })
      .concat(D.income.filter(inMonth).map(function (x) { return { x: x, k: "income" }; })).sort(byNewest);
    $("#mon-entries").innerHTML = list.map(function (e) { return entryRow(e.x, e.k); }).join("");
    $("#mon-entries-none").hidden = list.length > 0;
    $("#mon-entries-head").textContent = "Logged in " + ymLabel(monYm);
    var cp = $("#copy-plan");
    if (!hasPlan(y) && hasPlan(y - 1)) {
      cp.innerHTML = "<strong>No plan for " + y + " yet.</strong>Start from last year's: every month of " + (y - 1) + " is copied to the same month of " + y +
        '. You can change any month after.<div class="row-buttons"><button type="button" class="btn btn-primary" id="copy-plan-btn" data-copy-plan="' +
        (y - 1) + '">Copy ' + (y - 1) + "'s plan</button></div>";
      cp.hidden = false;
    } else if (!hasPlan(y)) {
      cp.innerHTML = "<strong>No plan for " + y + " yet.</strong>Tap Change the plan and type what you expect to come in and go out each month.";
      cp.hidden = false;
    } else { cp.innerHTML = ""; cp.hidden = true; }
  }
  function billItem(r, t) {
    var b = r.b, when = r.next == null ? "One-off · was due " + HH.fmtDate(HH.parseIso(b.due), true) + " · done"
      : b.freq + " · next due " + HH.fmtDate(r.next, HH.ymd(r.next).y !== HH.ymd(t).y) + " · " + inDays(r.next, t);
    return '<li data-bill="' + b.id + '"><button type="button" class="rowbtn" data-edit-bill="' + b.id + '" aria-label="Change ' +
      esc(b.name) + '"><span class="what"><b>' + esc(b.name) + '</b><br><span class="small muted">' + when +
      '</span><br><span class="tag">' + (b.auto ? "comes out automatically" : "you pay this one") + '</span></span><span class="amt">' +
      m(b.cents) + '</span><span class="chev" aria-hidden="true">›</span></button></li>';
  }
  function renderBills() {
    var y = D.settings.year, rows = billRows(T), opts = [], i;
    $("#bill-list").innerHTML = rows.map(function (r) { return billItem(r, T); }).join("");
    $("#bill-none").hidden = rows.length > 0;
    for (i = 1; i <= 12; i++) opts.push(ymKey(y, i));
    if (!calYm || opts.indexOf(calYm) < 0) calYm = ymKey(y, focusMonth(y));
    $("#cal-month").innerHTML = opts.map(function (ym) { return '<option value="' + ym + '"' + (ym === calYm ? " selected" : "") + ">" + ymLabel(ym) + "</option>"; }).join("");
    var occ = monthOccurrences(calYm), first = occ.range.first, last = occ.range.last;
    var h = ["M", "T", "W", "T", "F", "S", "S"].map(function (w) { return '<div class="cal-h">' + w + "</div>"; }).join("");
    var lead = HH.mod(HH.weekday(first) - 1, 7);
    for (i = 0; i < lead; i++) h += '<div class="cal-d empty"></div>';
    for (var dd = first; dd <= last; dd++) {
      var list = occ.byDay[dd] || [];
      h += '<div class="cal-d' + (dd === T ? " today" : "") + (list.length ? " has" : "") + '" data-day="' + HH.ymd(dd).d + '"><span class="n">' + HH.ymd(dd).d + "</span>" +
        list.map(function (b) { return '<span class="cb">' + esc(b.name) + "<br>" + m(b.cents) + "</span>"; }).join("") + "</div>";
    }
    $("#cal-grid").innerHTML = h;
    $("#cal-total").textContent = "Bills in " + ymLabel(calYm) + ": " + m(occ.total);
    var yb = yearBills(y);
    $("#bills-year").textContent = "Bills in " + y + ": " + m(yb.total) + " (about " + m(Math.round(yb.total / 12)) + " a month)";
  }
  function histList(entries, fund) {
    return '<ul class="list small goal-hist">' + entries.slice().reverse().slice(0, 60).map(function (x) {
      return "<li><span>" + HH.fmtDate(HH.parseIso(x.date), true) + "</span><b>" + (x.cents < 0 ? m(-x.cents) + " taken out" : "+" + m(x.cents)) + "</b></li>";
    }).join("") + "</ul>";
  }
  function renderSavings() {
    $("#fund-list").innerHTML = D.funds.map(function (f) {
      var st = fundStats(f), key = "f" + f.id;
      var line = st.ready ? "Ready · " + m(f.savedCents) + " saved of " + m(f.targetCents) + " · due " + ymLabel(f.due)
        : m(f.savedCents) + " of " + m(f.targetCents) + " · " + st.pct + "% saved · due " + ymLabel(f.due);
      var monthly = st.ready ? "Nothing more to set aside." : st.raw >= 1 ? "Set aside " + m(st.monthly) + " a month · " + plural(st.raw, "month", "months") + " to " + ymLabel(f.due)
        : st.raw === 0 ? "Due this month: set aside " + m(st.monthly) : "Was due " + ymLabel(f.due) + ": " + m(st.left) + " still to set aside";
      return '<li data-fund="' + f.id + '"><div class="goal"><button type="button" class="rowbtn" data-edit-fund="' + f.id + '" aria-label="Change ' + esc(f.name) +
        '"><span class="what"><b>' + esc(f.name) + '</b><br><span class="small muted fund-line">' + line + "</span><br>" + blocks(st.frac) +
        '<br><span class="small fund-monthly">' + monthly + '</span></span><span class="chev" aria-hidden="true">›</span></button>' +
        '<div class="row-buttons"><button type="button" class="btn btn-primary" data-fund-money="' + f.id + '">+ Add money</button>' +
        (f.savedCents > 0 ? '<button type="button" class="btn btn-quiet" data-fund-take="' + f.id + '">Take money out</button>' : "") +
        (f.log.length ? '<button type="button" class="btn btn-quiet" data-hist="' + key + '">' + (openHist[key] ? "Hide" : "Show") + " " +
          plural(f.log.length, "entry", "entries") + "</button>" : "") + "</div>" + (openHist[key] ? histList(f.log) : "") + "</div></li>";
    }).join("");
    $("#fund-none").hidden = D.funds.length > 0;
    var ft = fundsTotal();
    $("#funds-total").textContent = !D.funds.length ? "" : ft.n ? "Set aside " + m(ft.total) + " a month across " + plural(ft.n, "sinking fund", "sinking funds") + "."
      : "Every sinking fund is ready.";
    $("#funds-total").hidden = !D.funds.length;
    var gs = 0, gt = 0;
    $("#goal-list").innerHTML = D.goals.map(function (g) {
      var st = goalStats(g), key = "g" + g.id;
      gs += g.savedCents; gt += g.targetCents;
      var line = st.done ? "Saved · " + m(g.savedCents) + " of " + m(g.targetCents) : m(g.savedCents) + " of " + m(g.targetCents) + " · " + st.pct + "% saved · " + m(st.left) + " left";
      var monthly = st.monthly != null && !st.done ? "Save " + m(st.monthly) + " a month to get there by " + ymLabel(ymOf(HH.parseIso(g.targetDate))) : "";
      return '<li data-goal="' + g.id + '"><div class="goal"><button type="button" class="rowbtn" data-edit-goal="' + g.id + '" aria-label="Change ' + esc(g.name) +
        '"><span class="what"><b>' + esc(g.name) + '</b><br><span class="small muted goal-line">' + line + "</span><br>" + blocks(st.frac) +
        (monthly ? '<br><span class="small goal-monthly">' + monthly + "</span>" : "") + '</span><span class="chev" aria-hidden="true">›</span></button>' +
        '<div class="row-buttons"><button type="button" class="btn btn-primary" data-goal-money="' + g.id + '">+ Add money</button>' +
        (g.deposits.length ? '<button type="button" class="btn btn-quiet" data-hist="' + key + '">' + (openHist[key] ? "Hide" : "Show") + " " +
          plural(g.deposits.length, "deposit", "deposits") + "</button>" : "") + "</div>" + (openHist[key] ? histList(g.deposits) : "") + "</div></li>";
    }).join("");
    $("#goal-none").hidden = D.goals.length > 0;
    $("#goals-total").textContent = D.goals.length ? "Saved " + m(gs) + " of " + m(gt) + " across " + plural(D.goals.length, "goal", "goals") + "." : "";
    $("#goals-total").hidden = !D.goals.length;
  }
  function itemRow(x, kind) {
    return '<li data-item="' + x.id + '"><button type="button" class="rowbtn" data-edit-item="' + kind + ":" + x.id + '" aria-label="Change ' + esc(x.name) +
      '"><span class="what"><b>' + esc(x.name) + '</b><br><span class="small muted">' + esc(x.type) + '</span></span><span class="amt">' + m(x.cents) +
      '</span><span class="chev" aria-hidden="true">›</span></button></li>';
  }
  function renderNetWorth() {
    var nw = netWorth();
    $("#nw-assets").innerHTML = D.assets.map(function (x) { return itemRow(x, "asset"); }).join("");
    $("#nw-assets-none").hidden = D.assets.length > 0;
    $("#nw-liabs").innerHTML = D.liabilities.map(function (x) { return itemRow(x, "liability"); }).join("");
    $("#nw-liabs-none").hidden = D.liabilities.length > 0;
    $("#nw-assets-total").textContent = m(nw.assets);
    $("#nw-liabs-total").textContent = m(nw.liabilities);
    $("#nw-net").textContent = m(nw.net);
    var snaps = D.snapshots.slice().reverse();
    $("#nw-snaps").innerHTML = snaps.map(function (s, i) {
      var prev = snaps[i + 1], change = prev ? s.net - prev.net : null;
      return '<li data-snap="' + s.date + '"><span class="what"><b>' + HH.fmtLong(HH.parseIso(s.date)) + '</b><br><span class="small muted">' +
        (change == null ? "first snapshot" : (change >= 0 ? "up " : "down ") + m(Math.abs(change)) + " since " + HH.fmtLong(HH.parseIso(prev.date))) +
        '</span></span><span class="amt">' + m(s.net) + "</span></li>";
    }).join("");
    $("#nw-snaps-none").hidden = snaps.length > 0;
  }
  function renderReview(ys) {
    var y = ys.y, rv = review(ys), w = [], st = yearState(y), curM = st === "now" ? HH.ymd(T).m : 0;
    $("#rev-title").textContent = "Your " + y + " in review";
    $("#rev-income").textContent = m(ys.incAct) + " of " + m(ys.incPlan) + " planned";
    $("#rev-spend").textContent = m(ys.spAct) + " of " + m(ys.spPlan) + " planned";
    $("#rev-left").textContent = leftPlain(ys.left);
    if (!ys.n) {
      w.push("Nothing logged in " + y + " yet. Add what you spend and what comes in, and this page fills in as the months go by.");
    } else {
      var n = rv.done.length;
      if (n) {
        var diff = rv.planned - rv.actual;
        // a year that hasn't started can only hold entries from the sample: its months are 'logged', not 'over'
        w.push("Across the " + (st === "ahead" ? (n === 1 ? "month" : n + " months") + " logged" : (n === 1 ? "month that is" : n + " months that are") + " over") + ", you spent " +
          (diff > 0 ? m(diff) + " less than you planned." : diff < 0 ? m(-diff) + " more than you planned." : "exactly what you planned."));
      } else {
        w.push("The month you're in is still going. Once it's over, this page compares it with your plan.");
      }
      if (rv.best && rv.best !== rv.worst) {
        w.push("Your strongest month was " + MONTH[rv.best.m - 1] + ", with " + leftOver(rv.best.left) + ".");
        w.push("Your tightest month was " + MONTH[rv.worst.m - 1] + ", with " + leftOver(rv.worst.left) + ".");
      } else if (rv.best) {
        w.push("Every month that's over came out the same: " + leftOver(rv.best.left) + ".");
      } else if (n === 1) {
        w.push("Once two months are over, your strongest and tightest months show here.");
      }
      if (n) w.push("You stayed within your spending plan in " + rv.within + " of " + plural(n, "month", "months") + ".");
    }
    w.push(rv.saved > 0 ? "You put " + m(rv.saved) + " into goals and sinking funds." : rv.saved < 0 ? "You took " + m(-rv.saved) +
      " more out of your sinking funds than you put in, which is what they're for." : "Nothing put into goals or sinking funds in " + y + " yet.");
    w.push(rv.nw ? "Your net worth went " + (rv.nw.change >= 0 ? "up " : "down ") + m(Math.abs(rv.nw.change)) + ", from " + m(rv.nw.from.net) + " on " +
      HH.fmtLong(HH.parseIso(rv.nw.from.date)) + " to " + m(rv.nw.to.net) + " on " + HH.fmtLong(HH.parseIso(rv.nw.to.date)) + "."
      : "Save a net worth snapshot now and then (the Worth tab) to see the change across the year.");
    $("#rev-words").innerHTML = w.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("");
    $("#rev-foot").textContent = rv.cur && ys.months[rv.cur - 1].n ? MONTH[rv.cur - 1] + " is still going, so it's left out of these until it's over." : "";
    $("#rev-foot").hidden = !$("#rev-foot").textContent;
    $("#rev-chart").innerHTML = chart(ys.months.map(function (x) { return [x.incAct, x.spAct]; }), ["inc", "out"], st === "now" ? curM - 1 : -1);
    $("#rev-chart").setAttribute("aria-label", "Income and spending for each month of " + y + ". The numbers are in the list below.");
    $("#rev-months").innerHTML = ys.months.map(function (r) {
      var lab = MO[r.m - 1] + " " + y + (r.m === curM ? " · so far" : "");
      if (!r.n) {
        return '<li class="future" data-month="' + r.m + '"><span class="what"><b>' + lab + '</b><br><span class="small muted">' +
          (r.incPlan || r.spPlan ? "Planned: in " + m(r.incPlan) + " · out " + m(r.spPlan) : "Nothing planned or logged") + "</span></span></li>";
      }
      return '<li data-month="' + r.m + '"><span class="what"><b>' + lab + '</b><br><span class="small muted">In ' + m(r.incAct) + " · out " + m(r.spAct) +
        " of " + m(r.spPlan) + " planned</span></span><span class=\"amt\">" + (r.left < 0 ? m(-r.left) + " over" : m(r.left) + " left") + "</span></li>";
    }).join("");
    var cats = Object.keys(ys.catYear).sort(function (a, b) { return ys.catYear[b] - ys.catYear[a] || (a < b ? -1 : 1); });
    var top = cats.length ? ys.catYear[cats[0]] : 1;
    $("#rev-cats").innerHTML = cats.map(function (c) {
      var planned = 0;
      if (D.settings.cats.indexOf(c) >= 0) for (var mo = 1; mo <= 12; mo++) planned += planCat(y, mo, c);
      return '<li data-cat="' + esc(c) + '"><span class="what"><b>' + esc(c) + '</b><br><span class="small muted">of ' + m(planned) + " planned for the year</span><br>" +
        blocks(ys.catYear[c] / top) + '</span><span class="amt">' + m(ys.catYear[c]) + "</span></li>";
    }).join("");
    $("#rev-cats-none").hidden = cats.length > 0;
    $("#rev-cats-head").textContent = "Where it went in " + y;
  }
  function curChips(el, name, cur) {
    el.innerHTML = CURRENCIES.map(function (c) {
      return '<label class="chip"><input type="radio" name="' + name + '" value="' + esc(c) + '"' + (c === cur ? " checked" : "") + "><span>" + esc(c) + "</span></label>";
    }).join("");
  }
  function renderSettings() {
    var s = D.settings;
    $("#s-year").innerHTML = yearOptions().map(function (y) { return '<option value="' + y + '"' + (y === s.year ? " selected" : "") + ">" + y + "</option>"; }).join("");
    curChips($("#s-cur-chips"), "cur", s.currency);
    $("#s-cur").value = s.currency;
    $("#s-cats").value = s.cats.join("\n");
    $$('input[name="theme"]').forEach(function (r) { r.checked = r.value === s.theme; });
    $("#last-backup").textContent = D.meta.lastBackup ? "Last backup: " + HH.fmtLong(HH.parseIso(D.meta.lastBackup)) : "No backup made yet.";
    $("#sample-state").textContent = D.meta.sample ? "Sample data is on: the numbers in the app are a made-up year." :
      "Sample data is off. You can load a made-up year to look around while the app is empty.";
    $("#sample-btn").textContent = D.meta.sample ? "Clear the sample data" : "Load sample data";
  }
  function go(id) {
    render();
    HH.show(id);
    $("#tabs").hidden = id === "welcome";
  }

  // ── first run ────────────────────────────────────────────────────
  function welcomeStep(k) {
    $("#welcome-1").hidden = k !== 1;
    $("#welcome-3").hidden = k !== 3;
    [1, 2, 3].forEach(function (i) { $("#st" + i).classList.toggle("on", i <= k); });
    if (k === 1) {
      $("#w-year").innerHTML = yearOptions().map(function (y) { return '<option value="' + y + '"' + (y === D.settings.year ? " selected" : "") + ">" + y + "</option>"; }).join("");
      curChips($("#w-cur-chips"), "wcur", D.settings.currency);
      $("#w-cur").value = D.settings.currency;
    }
    if (k === 3) {
      var y = D.settings.year, inc = planInc(y, 1), sp = planSpend(y, 1);
      HH.hero($("#w-left"), leftPlain(inc - sp));
      $("#w-cap").textContent = hasPlan(y) ? m(inc) + " in · " + m(sp) + " out" : "No plan yet: add one on the Months tab whenever you're ready.";
    }
    var h1 = $("#welcome-" + k + " h1");
    if (h1) { h1.setAttribute("tabindex", "-1"); h1.focus(); }
  }
  function toWelcome(k) { go("welcome"); welcomeStep(k); }
  function startWelcome() { toWelcome(1); }
  function finishWelcome() {
    D.meta.onboarded = true;
    monYm = calYm = null;
    save();
    go("home");
  }

  // ── sample data: a made-up year (the spec's build.sample) ────────
  function rng(seed) { var s = seed >>> 0; return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
  function loadSample() {
    var t = HH.today(), ta = HH.ymd(t), Y = defaultYear(), id = 1, d = blank(), mo;
    var cut = ta.y === Y ? t : HH.dn(Y, 12, 31), K = ta.y === Y ? ta.m : 12, r = rng(Y * 7919 + 137);
    d.settings.year = Y;
    d.settings.theme = D ? D.settings.theme : "auto";
    var c$ = function (x) { return Math.round(x * 100); };
    var day = function (mm, dd) { return HH.dn(Y, mm, Math.min(dd, HH.lastDay(Y, mm))); };
    var sp = function (mm, dd, cents, note, cat) { var n = day(mm, dd); if (n <= cut) d.spends.push({ id: id++, cents: cents, date: HH.iso(n), note: note, cat: cat, sample: true }); };
    var inc = function (mm, dd, cents, note) { var n = day(mm, dd); if (n <= cut) d.income.push({ id: id++, cents: cents, date: HH.iso(n), note: note, sample: true }); };
    var gifts = { 3: 6000, 6: 8000, 8: 5000, 10: 7000, 12: 62000 };
    for (mo = 1; mo <= K; mo++) {
      inc(mo, 1, 260000, "Pay");
      inc(mo, 15, 260000, "Pay");
      if (mo === 7) inc(mo, 14, 82000, "Tax refund");
      if (mo === 10) inc(mo, 9, 24000, "Market stall");
      if (mo === 12) inc(mo, 18, 100000, "Bonus");
      sp(mo, 1, 195000, "Rent", "Housing");
      [3, 10, 17, 24].forEach(function (dd) { sp(mo, dd, c$(150 + r() * 60 + (mo === 12 ? 45 : 0)), "Groceries", "Groceries"); });
      [5, 14, 23].forEach(function (dd) { sp(mo, dd, c$(62 + r() * 26), "Fuel", "Transport"); });
      sp(mo, 8, 11200, "Car insurance", "Transport");
      sp(mo, 12, 6500, "Phone", "Utilities");
      sp(mo, 20, 7900, "Internet", "Utilities");
      if (mo % 3 === 2) sp(mo, 28, 34000, "Electricity", "Utilities");
      if (mo % 3 === 0) sp(mo, 15, 18000, "Water", "Utilities");
      sp(mo, 9, c$(18 + r() * 30), "Pharmacy", "Health");
      sp(mo, 4, 2500, "Gym", "Health");
      sp(mo, 18, 2500, "Gym", "Health");
      if (mo === 6) sp(mo, 14, 18000, "Dentist", "Health");
      sp(mo, 7, c$(55 + r() * 55), "Dinner out", "Fun");
      sp(mo, 22, 1699, "Streaming", "Fun");
      sp(mo, 2, c$(9 + r() * 8), "Coffee", "Fun");
      sp(mo, 16, c$(9 + r() * 8), "Coffee", "Fun");
      if (mo % 2 === 1) sp(mo, 19, 3400, "Movies", "Fun");
      if (mo === 4) sp(mo, 26, 14000, "Concert", "Fun");
      if (mo === 7) sp(mo, 10, 38000, "Weekend away", "Fun");
      var kid = c$(35 + r() * 55);
      sp(mo, 13, mo === 1 ? 28000 : mo === 12 ? 12000 : kid, mo === 1 ? "School shoes and books" : mo === 12 ? "School concert" : "School things", "Kids");
      sp(mo, 11, c$(52 + r() * 14), "Pet food", "Pets");
      if (mo === 10) sp(mo, 21, 26000, "Vet", "Pets");
      if (gifts[mo]) sp(mo, 18, gifts[mo], mo === 12 ? "Christmas presents" : "Birthday gift", "Gifts");
      var oth = c$(30 + r() * 60);
      sp(mo, 25, oth, mo % 2 ? "Hardware store" : "", "Other");
    }
    var plan = { income: [], cats: {} };
    var base = { Housing: 195000, Groceries: 74000, Transport: 33000, Utilities: 28000, Health: 11000, Fun: 19000, Kids: 10000, Pets: 7000, Gifts: 6000, Other: 7000 };
    for (mo = 1; mo <= 12; mo++) {
      plan.income.push(520000);
      for (var c in base) (plan.cats[c] = plan.cats[c] || []).push(mo === 12 && c === "Groceries" ? 90000 : mo === 12 && c === "Gifts" ? 62000 : base[c]);
    }
    d.plan[String(Y)] = plan;
    d.bills = [["Rent", 195000, "Monthly", 1, 1, true], ["Phone", 6500, "Monthly", 1, 12, true], ["Internet", 7900, "Monthly", 1, 20, true],
      ["Car insurance", 11200, "Monthly", 1, 8, true], ["Streaming", 1699, "Monthly", 1, 22, true], ["Gym", 2500, "Fortnightly", 1, 4, true],
      ["Electricity", 34000, "Quarterly", 2, 28, false], ["Water", 18000, "Quarterly", 3, 15, false], ["Home insurance", 138000, "Yearly", 6, 30, false],
      ["Car rego", 82000, "Yearly", 9, 10, false], ["Dentist", 18000, "One-off", 6, 14, false]
    ].map(function (b) { return { id: id++, name: b[0], cents: b[1], freq: b[2], due: HH.iso(HH.dn(Y, b[3], b[4])), auto: b[5], sample: true }; });
    // sinking funds and goals count from the real today, so their monthly amounts read true whenever the sample is opened
    var tym = ymIdx(ta.y, ta.m);
    var fund = function (name, target, k, log) {
      var saved = 0;
      log.forEach(function (x) { saved += x[1]; });
      return { id: id++, name: name, targetCents: target, due: ymFromIdx(tym + k), savedCents: saved,
               log: log.map(function (x) { return { date: HH.iso(t + x[0]), cents: x[1] }; }), sample: true };
    };
    d.funds = [fund("Home insurance", 138000, 4, [[-70, 23000], [-40, 23000], [-10, 23000]]), fund("Car rego", 82000, 8, [[-45, 10000], [-15, 10000]]),
      fund("Christmas", 120000, ta.m === 12 ? 12 : 12 - ta.m, [[-75, 30000], [-45, 30000], [-15, 30000]]), fund("Vet visit", 30000, 10, [[-20, 6000]])];
    var em = [];
    for (mo = 1; mo <= K; mo++) { var n = day(mo, 16); if (n <= cut) em.push({ date: HH.iso(n), cents: 25000 }); }
    var emSaved = 200000;
    em.forEach(function (x) { emSaved += x.cents; });
    d.goals = [
      { id: id++, name: "Emergency fund", targetCents: 1000000, savedCents: emSaved, targetDate: null, deposits: em, sample: true },
      { id: id++, name: "Holiday", targetCents: 400000, savedCents: 125000, targetDate: HH.iso(HH.addMonths(t, 8)),
        deposits: [{ date: HH.iso(t - 60), cents: 50000 }, { date: HH.iso(t - 30), cents: 40000 }, { date: HH.iso(t - 5), cents: 35000 }], sample: true },
      { id: id++, name: "New laptop", targetCents: 180000, savedCents: 45000, targetDate: HH.iso(HH.addMonths(t, 5)),
        deposits: [{ date: HH.iso(t - 20), cents: 45000 }], sample: true }
    ];
    d.assets = [["Everyday account", "Cash & savings", 320000], ["Savings", "Cash & savings", 1240000], ["Super", "Super & retirement", 6400000], ["Car", "Vehicle", 1400000]]
      .map(function (x) { return { id: id++, name: x[0], type: x[1], cents: x[2], sample: true }; });
    d.liabilities = [["Car loan", "Loan", 860000], ["Credit card", "Credit card", 145000]]
      .map(function (x) { return { id: id++, name: x[0], type: x[1], cents: x[2], sample: true }; });
    d.snapshots = [[Y - 1, 12, 31, 8840000, 1260000], [Y, 3, 31, 8995000, 1190000], [Y, 6, 30, 9120000, 1115000], [Y, 9, 30, 9010000, 1040000],
      [Y, 12, 31, 9360000, 1005000]].filter(function (x) { return HH.dn(x[0], x[1], x[2]) <= cut; })
      .map(function (x) { return { date: HH.iso(HH.dn(x[0], x[1], x[2])), assets: x[3], liabilities: x[4], net: x[3] - x[4] }; });
    d.meta.sample = true;
    d.meta.onboarded = true;
    d.meta.nextId = id;
    D = d;
    monYm = calYm = null;
    openHist = {};
    save();
    go("home");
    HH.toast("Sample data loaded: a made-up year. Clear it any time.", null, 4000);
  }
  function clearSample() {
    var keep = {}, theme = D.settings.theme, next = D.meta.nextId;
    LISTS.slice(0, 7).forEach(function (k) { keep[k] = D[k].filter(function (x) { return !x.sample; }); });
    D = blank();
    D.settings.theme = theme;
    for (var k in keep) D[k] = keep[k];
    D.meta.nextId = next;
    monYm = calYm = null;
    save();
    startWelcome();
  }

  // ── spending and income ──────────────────────────────────────────
  function catChips() {
    $("#add-cats").innerHTML = D.settings.cats.map(function (c, i) {
      return '<label class="chip"><input type="radio" name="cat" value="' + esc(c) + '" id="cat-' + i + '"><span>' + esc(c) + "</span></label>";
    }).join("");
  }
  function setKind(kind) {
    entryKind = kind;
    $$('input[name="kind"]').forEach(function (i) { i.checked = i.value === kind; });
    var inc = kind === "income";
    $("#add-title").textContent = (editingEntry ? "Change " : "Add ") + (inc ? "income" : "spending");
    $("#add-note-label").innerHTML = (inc ? "Where from?" : "What was it?") + ' <span class="hint">Optional</span>';
    $("#add-cats-wrap").hidden = inc;
  }
  function openAdd(entry, kind) {
    editingEntry = entry ? entry.x : null;
    catChips();
    var x = editingEntry;
    $("#add-amount").value = x ? HH.plain(x.cents) : "";
    $("#add-note").value = x ? x.note : "";
    var want = x && x.cat ? x.cat : "Other";
    if (D.settings.cats.indexOf(want) < 0) want = D.settings.cats[D.settings.cats.length - 1];
    $$("#add-cats input").forEach(function (i) { i.checked = i.value === want; });
    var dd = x ? HH.parseIso(x.date) : T;
    HH.setDate($("#add-date"), HH.iso(dd));
    $("#add-date").max = HH.iso(T);
    $("#add-day-text").textContent = dd === T ? "Today" : HH.fmtDate(dd, true);
    $("#add-day-wrap").hidden = true;
    $("#add-err").hidden = true;
    $("#add-delete").hidden = !x;
    go("add");
    setKind(entry ? entry.k : (kind || "spend"));
    $("#add-amount").focus();
  }
  function entryList(kind) { return kind === "income" ? D.income : D.spends; }
  function findEntry(key) {
    var p = String(key).split(":"), x = byId(entryList(p[0]), +p[1]);
    return x ? { x: x, k: p[0] } : null;
  }
  function saveEntry(ev) {
    ev.preventDefault();
    var cents = HH.parseMoney($("#add-amount").value), dd = HH.parseIso($("#add-date").value);
    var err = cents == null || cents <= 0 ? "Type the amount as a number, such as 12.50." :
      dd == null ? "Pick the day." : dd > T ? "Pick today or an earlier day." : "";
    if (err) { $("#add-err").textContent = err; $("#add-err").hidden = false; $("#add-amount").focus(); return; }
    var kind = entryKind, cat = kind === "income" ? null : (($$("#add-cats input").filter(function (i) { return i.checked; })[0] || {}).value || "Other");
    var note = $("#add-note").value.trim().slice(0, 60), y = HH.ymd(dd).y, where = MO[HH.ymd(dd).m - 1] + " " + y;
    var fresh = function (id) { var o = { id: id, cents: cents, date: HH.iso(dd), note: note }; if (cat) o.cat = cat; return o; };
    if (editingEntry) {
      var old = editingEntry;
      var from = D.spends.indexOf(old) >= 0 ? "spend" : "income", list = entryList(from), at = list.indexOf(old);
      var before = JSON.parse(JSON.stringify(old)), nx = fresh(old.id);
      if (old.sample !== undefined) nx.sample = old.sample;
      list.splice(at, 1);
      entryList(kind).push(nx);
      save();
      if (y === D.settings.year) monYm = ymOf(dd);
      go("months");
      HH.toast("Changed to " + m(cents), function () {
        var l2 = entryList(kind), i2 = l2.indexOf(nx);
        if (i2 >= 0) l2.splice(i2, 1);
        list.splice(at, 0, before);
        save(); render();
      });
    } else {
      var x = fresh(newId());
      if (D.meta.sample) x.sample = false;
      entryList(kind).push(x);
      save();
      go("home");
      var msg = y !== D.settings.year ? "Saved " + m(cents) + " for " + HH.fmtDate(dd, true) + ". It counts in " + y + ", not " + D.settings.year + "."
        : "Saved " + m(cents) + " · " + (kind === "income" ? "income" : cat) + ", " + where;
      HH.toast(msg, function () {
        var l2 = entryList(kind), i2 = l2.indexOf(x);
        if (i2 >= 0) l2.splice(i2, 1);
        save(); render();
      });
    }
  }
  function deleteEntry() {
    var x = editingEntry, kind = D.spends.indexOf(x) >= 0 ? "spend" : "income", list = entryList(kind), i = list.indexOf(x);
    if (i < 0) return;
    list.splice(i, 1);
    save();
    go("months");
    HH.toast("Deleted " + m(x.cents), function () { list.splice(i, 0, x); save(); render(); });
  }

  // ── the plan ─────────────────────────────────────────────────────
  function readPlanForm() {
    var out = { income: 0, cats: {}, bad: null }, v = $("#plan-income").value.trim(), c = v === "" ? 0 : HH.parseMoney(v);
    if (c == null) out.bad = "income"; else out.income = c;
    $$("#plan-rows input").forEach(function (i) {
      var t = i.value.trim(), cc = t === "" ? 0 : HH.parseMoney(t);
      if (cc == null) { if (!out.bad) out.bad = i.getAttribute("data-cat"); }
      else out.cats[i.getAttribute("data-cat")] = cc;
    });
    return out;
  }
  function updatePlanSum() {
    var f = readPlanForm(), sp = 0;
    if (f.bad) { $("#plan-sum").textContent = ""; return; }
    for (var c in f.cats) sp += f.cats[c];
    $("#plan-sum").textContent = "This plan: " + m(f.income) + " in, " + m(sp) + " out, " + leftOver(f.income - sp) + " a month.";
  }
  function scopeChoice() { return ($$('input[name="scope"]').filter(function (r) { return r.checked; })[0] || {}).value || "one"; }
  function openPlan(ym, from) {
    planYm = ym;
    planReturn = from || "months";
    var a = ymParts(ym), y = a.y, mo = a.m, welcome = planReturn === "welcome";
    $("#plan-title").textContent = welcome ? "Plan a typical month" : "Plan for " + ymLabel(ym);
    $("#plan-intro").textContent = welcome ? "What you expect to come in each month, and what you plan to spend in each category. It's copied to every month of " + y +
      ", and you can change any month later. Blank means 0." : "What you expect to come in and what you plan to spend. Blank means 0. Change the categories themselves in Settings.";
    $("#plan-steps").hidden = !welcome;
    var inc = planInc(y, mo);
    $("#plan-income").value = inc ? HH.plain(inc) : "";
    $("#plan-rows").innerHTML = D.settings.cats.map(function (c, i) {
      var v = planCat(y, mo, c);
      return '<label for="plan-in-' + i + '">' + esc(c) + '</label><input id="plan-in-' + i + '" type="text" inputmode="decimal" autocomplete="off" data-cat="' +
        esc(c) + '" value="' + (v ? HH.plain(v) : "") + '" placeholder="0">';
    }).join("");
    $("#scope-one").textContent = "Just " + ymLabel(ym);
    $("#scope-rest").textContent = MO[mo - 1] + " to Dec " + y;
    $("#scope-all").textContent = "Every month of " + y;
    $("#scope-rest-chip").hidden = mo === 1 || mo === 12;
    $("#plan-scope-wrap").hidden = welcome;
    var def = welcome || !hasPlan(y) ? "all" : "one";
    $$('input[name="scope"]').forEach(function (r) { r.checked = r.value === def; });
    $("#plan-cancel").textContent = welcome ? "Skip for now" : "Cancel";
    $("#plan-save").textContent = welcome ? "Save and carry on" : "Save plan";
    $("#plan-err").hidden = true;
    go("plan-edit");
    $("#tabs").hidden = welcome;
    updatePlanSum();
  }
  function savePlan(ev) {
    ev.preventDefault();
    var f = readPlanForm(), welcome = planReturn === "welcome";
    if (f.bad) {
      $("#plan-err").textContent = "Type the amount for " + (f.bad === "income" ? "income" : f.bad) + " as a number, such as 600. Blank means 0.";
      $("#plan-err").hidden = false;
      return;
    }
    var a = ymParts(planYm), y = a.y, scope = welcome ? "all" : scopeChoice();
    var lo = scope === "all" ? 1 : a.m, hi = scope === "one" ? a.m : 12, p = ensurePlan(y);
    for (var mo = lo; mo <= hi; mo++) {
      p.income[mo - 1] = f.income;
      D.settings.cats.forEach(function (c) { if (!p.cats[c]) p.cats[c] = zeros(); p.cats[c][mo - 1] = f.cats[c] || 0; });
    }
    save();
    if (welcome) { toWelcome(3); return; }
    monYm = planYm;
    go("months");
    HH.toast("Plan saved for " + (scope === "one" ? ymLabel(planYm) : scope === "rest" ? MO[a.m - 1] + " to Dec " + y : "every month of " + y));
  }
  function copyPlan(fromY) {
    var src = planOf(fromY), y = D.settings.year;
    if (!src) return;
    D.plan[String(y)] = JSON.parse(JSON.stringify(src));
    save();
    go("months");
    HH.toast("Copied " + fromY + "'s plan to " + y + ".");
  }

  // ── bills ────────────────────────────────────────────────────────
  function openBill(b) {
    editingBill = b || null;
    $("#bill-title").textContent = b ? "Change bill" : "Add a bill";
    $("#b-name").value = b ? b.name : "";
    $("#b-amount").value = b ? HH.plain(b.cents) : "";
    $("#b-freq").value = b ? b.freq : "Monthly";
    HH.setDate($("#b-due"), b ? HH.iso(nextDue(b, T) == null ? HH.parseIso(b.due) : nextDue(b, T)) : "");
    $("#b-auto").checked = b ? b.auto : false;
    $("#b-err").hidden = true;
    $("#b-delete").hidden = !b;
    go("bill-edit");
    $("#b-name").focus();
  }
  function saveBill(ev) {
    ev.preventDefault();
    var name = $("#b-name").value.trim().slice(0, 40), cents = HH.parseMoney($("#b-amount").value), due = HH.parseIso($("#b-due").value);
    var err = !name ? "Give the bill a name, such as Rent." : cents == null || cents <= 0 ? "Type the amount as a number, such as 49.95." :
      due == null ? "Pick the next date it's due (any date it was or will be due)." : "";
    if (err) { $("#b-err").textContent = err; $("#b-err").hidden = false; return; }
    var b = editingBill || { id: newId() };
    b.name = name; b.cents = cents; b.freq = $("#b-freq").value; b.due = HH.iso(due); b.auto = $("#b-auto").checked;
    if (!editingBill) { if (D.meta.sample) b.sample = false; D.bills.push(b); }
    save();
    go("bills");
    HH.toast((editingBill ? "Changed " : "Added ") + name);
  }
  function deleteBill() {
    var b = editingBill, i = D.bills.indexOf(b);
    if (i < 0) return;
    D.bills.splice(i, 1);
    save();
    go("bills");
    HH.toast("Deleted " + b.name, function () { D.bills.splice(i, 0, b); save(); render(); });
  }

  // ── sinking funds ────────────────────────────────────────────────
  function dueOptions(cur) {
    var a = HH.ymd(T), lo = Math.min(ymIdx(a.y, a.m), ymIdx(D.settings.year, 1)), hi = ymIdx(D.settings.year + 2, 12), out = [];
    for (var i = lo; i <= hi; i++) out.push(ymFromIdx(i));
    if (cur && out.indexOf(cur) < 0) { out.push(cur); out.sort(); }
    return out;
  }
  function openFund(f) {
    editingFund = f || null;
    var due = f ? f.due : ymKey(D.settings.year, 12);
    $("#fund-title").textContent = f ? "Change sinking fund" : "Add a sinking fund";
    $("#f-name").value = f ? f.name : "";
    $("#f-target").value = f ? HH.plain(f.targetCents) : "";
    $("#f-saved").value = f ? HH.plain(f.savedCents) : "";
    $("#f-due").innerHTML = dueOptions(due).map(function (ym) { return '<option value="' + ym + '"' + (ym === due ? " selected" : "") + ">" + ymLabel(ym) + "</option>"; }).join("");
    $("#f-err").hidden = true;
    $("#f-delete").hidden = !f;
    go("fund-edit");
    $("#f-name").focus();
  }
  function saveFund(ev) {
    ev.preventDefault();
    var name = $("#f-name").value.trim().slice(0, 40), target = HH.parseMoney($("#f-target").value);
    var saved = HH.parseMoney($("#f-saved").value === "" ? "0" : $("#f-saved").value), due = $("#f-due").value;
    var err = !name ? "Give the fund a name, such as Car rego." : target == null || target <= 0 ? "Type what it will cost as a number, such as 850." :
      saved == null ? "Type what you've saved so far as a number. 0 is fine." : !isYm(due) ? "Pick the month it's due." : "";
    if (err) { $("#f-err").textContent = err; $("#f-err").hidden = false; return; }
    var f = editingFund || { id: newId(), log: [] };
    f.name = name; f.targetCents = target; f.savedCents = saved; f.due = due;
    if (!editingFund) { if (D.meta.sample) f.sample = false; D.funds.push(f); }
    save();
    go("savings");
    HH.toast((editingFund ? "Changed " : "Added ") + name);
  }
  function deleteFund() {
    var f = editingFund, i = D.funds.indexOf(f);
    if (i < 0) return;
    D.funds.splice(i, 1);
    save();
    go("savings");
    HH.toast("Deleted " + f.name, function () { D.funds.splice(i, 0, f); save(); render(); });
  }

  // ── goals (72's) ─────────────────────────────────────────────────
  function openGoal(g) {
    editingGoal = g || null;
    $("#goal-title").textContent = g ? "Change goal" : "Add a goal";
    $("#gl-name").value = g ? g.name : "";
    $("#gl-target").value = g ? HH.plain(g.targetCents) : "";
    $("#gl-saved").value = g ? HH.plain(g.savedCents) : "";
    $("#gl-date").value = g && g.targetDate ? g.targetDate : "";
    $("#gl-err").hidden = true;
    $("#gl-delete").hidden = !g;
    go("goal-edit");
    $("#gl-name").focus();
  }
  function saveGoal(ev) {
    ev.preventDefault();
    var name = $("#gl-name").value.trim().slice(0, 40), target = HH.parseMoney($("#gl-target").value);
    var saved = HH.parseMoney($("#gl-saved").value === "" ? "0" : $("#gl-saved").value), dateTxt = $("#gl-date").value;
    var err = !name ? "Give the goal a name, such as Holiday." : target == null || target <= 0 ? "Type the target as a number, such as 3000." :
      saved == null ? "Type what you've saved so far as a number. 0 is fine." : dateTxt && !HH.parseIso(dateTxt) ? "Pick a target date, or leave it blank." : "";
    if (err) { $("#gl-err").textContent = err; $("#gl-err").hidden = false; return; }
    var g = editingGoal || { id: newId(), deposits: [] };
    g.name = name; g.targetCents = target; g.savedCents = saved; g.targetDate = dateTxt || null;
    if (!editingGoal) { if (D.meta.sample) g.sample = false; D.goals.push(g); }
    save();
    go("savings");
    HH.toast((editingGoal ? "Changed " : "Added ") + name);
  }
  function deleteGoal() {
    var g = editingGoal, i = D.goals.indexOf(g);
    if (i < 0) return;
    D.goals.splice(i, 1);
    save();
    go("savings");
    HH.toast("Deleted " + g.name, function () { D.goals.splice(i, 0, g); save(); render(); });
  }

  // ── money in and out of a fund or a goal ─────────────────────────
  function openMoney(kind, item, sign) {
    moneyFor = { kind: kind, item: item, sign: sign };
    $("#money-title").textContent = sign > 0 ? "Add money to " + item.name : "Take money out of " + item.name;
    $("#money-label").textContent = sign > 0 ? "How much did you put away?" : "How much did you take out?";
    $("#money-holds").textContent = kind === "fund" ? "It holds " + m(item.savedCents) + " now." : "";
    $("#money-save").textContent = sign > 0 ? "Add it" : "Take it out";
    $("#money-amount").value = "";
    $("#money-err").hidden = true;
    go("money");
    $("#money-amount").focus();
  }
  function saveMoney(ev) {
    ev.preventDefault();
    var f = moneyFor, cents = HH.parseMoney($("#money-amount").value);
    var err = cents == null || cents <= 0 ? "Type the amount as a number, such as 100." :
      f.sign < 0 && cents > f.item.savedCents ? "That's more than this fund holds (" + m(f.item.savedCents) + "). Type " + m(f.item.savedCents) + " or less." : "";
    if (err) { $("#money-err").textContent = err; $("#money-err").hidden = false; return; }
    var entry = { date: HH.iso(T), cents: f.sign * cents }, log = f.kind === "fund" ? f.item.log : f.item.deposits;
    f.item.savedCents += f.sign * cents;
    log.push(entry);
    save();
    go("savings");
    HH.toast((f.sign > 0 ? "Added " + m(cents) + " to " : "Took " + m(cents) + " out of ") + f.item.name, function () {
      f.item.savedCents -= f.sign * cents;
      var i = log.indexOf(entry);
      if (i >= 0) log.splice(i, 1);
      save(); render();
    });
  }

  // ── net worth ────────────────────────────────────────────────────
  function openItem(kind, x) {
    itemKind = kind;
    editingItem = x || null;
    var liab = kind === "liability";
    $("#nw-title").textContent = (x ? "Change " : "Add ") + (liab ? "a liability" : "an asset");
    $("#ni-type").innerHTML = (liab ? LIAB_TYPES : ASSET_TYPES).map(function (t) { return "<option>" + esc(t) + "</option>"; }).join("");
    $("#ni-name").value = x ? x.name : "";
    $("#ni-type").value = x ? x.type : (liab ? LIAB_TYPES[0] : ASSET_TYPES[0]);
    $("#ni-value").value = x ? HH.plain(x.cents) : "";
    $("#ni-label").textContent = liab ? "What you owe" : "What it's worth";
    $("#ni-err").hidden = true;
    $("#ni-delete").hidden = !x;
    go("nw-edit");
    $("#ni-name").focus();
  }
  function saveItem(ev) {
    ev.preventDefault();
    var name = $("#ni-name").value.trim().slice(0, 40), cents = HH.parseMoney($("#ni-value").value);
    var err = !name ? "Give it a name, such as Savings." : cents == null ? "Type the value as a number, such as 10000." : "";
    if (err) { $("#ni-err").textContent = err; $("#ni-err").hidden = false; return; }
    var list = itemKind === "liability" ? D.liabilities : D.assets;
    var x = editingItem || { id: newId() };
    x.name = name; x.type = $("#ni-type").value; x.cents = cents;
    if (!editingItem) { if (D.meta.sample) x.sample = false; list.push(x); }
    save();
    go("networth");
    HH.toast((editingItem ? "Changed " : "Added ") + name);
  }
  function deleteItem() {
    var list = itemKind === "liability" ? D.liabilities : D.assets, x = editingItem, i = list.indexOf(x);
    if (i < 0) return;
    list.splice(i, 1);
    save();
    go("networth");
    HH.toast("Deleted " + x.name, function () { list.splice(i, 0, x); save(); render(); });
  }
  function saveSnapshot() {
    var nw = netWorth(), s = { date: HH.iso(T), assets: nw.assets, liabilities: nw.liabilities, net: nw.net };
    D.snapshots = D.snapshots.filter(function (x) { return x.date !== s.date; });
    D.snapshots.push(s);
    D.snapshots.sort(function (a, b) { return HH.parseIso(a.date) - HH.parseIso(b.date); });
    save();
    render();
    HH.toast("Snapshot saved: " + m(nw.net) + " on " + HH.fmtLong(T));
  }

  // ── settings ─────────────────────────────────────────────────────
  function setYear(y) {
    D.settings.year = y;
    monYm = calYm = null;
    save();
    render();
  }
  function setCurrency(cur) {
    D.settings.currency = String(cur).trim().slice(0, 4);
    save();
    render();
    $("#s-cur-saved").textContent = "Saved. Amounts now read like " + m(123450) + ".";
  }
  function saveCats() {
    var lines = $("#s-cats").value.split("\n").map(function (x) { return x.trim().slice(0, 30); }).filter(function (x) { return x; });
    var seen = {}, cats = [];
    lines.forEach(function (c) { if (!seen[c.toLowerCase()]) { seen[c.toLowerCase()] = 1; cats.push(c); } });
    if (!cats.length) cats = DEFAULT_CATS.slice();
    D.settings.cats = cats;
    save();
    render();
    $("#s-cats-saved").textContent = "Saved " + plural(cats.length, "category", "categories") + ". Spending keeps the category it was given.";
  }

  // ── backup and restore ───────────────────────────────────────────
  function backup() {
    T = HH.today();
    D.meta.lastBackup = HH.iso(T);
    D.meta.reminderDismissed = null;
    save();
    var name = "hollowayhart-annual-budget-app-backup-" + HH.iso(T) + ".json";
    var mode = HH.saveFile(name, JSON.stringify({ app: APP_ID, schema: SCHEMA, made: HH.iso(T), data: D }, null, 2));
    render();
    HH.toast(HH.savedMessage(mode, name), null, 6000);
  }
  function readBackup(text) {
    var o;
    try { o = JSON.parse(text); } catch (e) { return { error: "broken" }; }
    if (!o || typeof o !== "object") return { error: "broken" };
    if (typeof o.app === "string" && o.app !== APP_ID && /^hollowayhart-/.test(o.app)) return { error: "other" };
    if (o.app !== APP_ID || !o.data) return { error: "broken" };
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
        restoreMsg('<p class="err" id="restore-refused">This backup is from a different Holloway &amp; Hart app, so this app can\'t load it. Nothing was changed.</p>');
        return;
      }
      if (r.error) {
        restoreMsg('<p class="err" id="restore-refused">This file isn\'t a backup from this app, or it is damaged. Nothing was changed.</p>');
        return;
      }
      pendingRestore = r.data;
      var d = r.data, years = Object.keys(d.plan).filter(function (k) { var p = d.plan[k]; return p.income.some(pos) || Object.keys(p.cats).some(function (c) { return p.cats[c].some(pos); }); }).sort();
      restoreMsg('<div class="banner" id="restore-summary"><strong>This backup has</strong>' +
        plural(d.spends.length, "spending entry", "spending entries") + " · " + plural(d.income.length, "income entry", "income entries") + " · " +
        plural(d.bills.length, "bill", "bills") + " · " + plural(d.funds.length, "sinking fund", "sinking funds") + " · " +
        plural(d.goals.length, "goal", "goals") + " · " + plural(d.assets.length + d.liabilities.length, "net worth item", "net worth items") +
        (years.length ? " · a plan for " + years.join(", ") : "") + (r.made != null ? " · made " + HH.fmtLong(r.made) : "") +
        '<p class="small" style="margin-top:6px">Restoring replaces everything in the app now.</p>' +
        '<div class="row-buttons"><button type="button" class="btn btn-primary" id="restore-yes">Replace with this backup</button>' +
        '<button type="button" class="btn btn-quiet" id="restore-no">Cancel</button></div></div>');
      $("#restore-yes").addEventListener("click", function () {
        D = pendingRestore; pendingRestore = null;
        monYm = calYm = null;
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
      text: "This deletes your plan, spending, income, bills, sinking funds, goals and net worth from this browser. If you might want them again, cancel and use Back up now first.",
      onYes: function () {
        HH.confirmStep({
          title: "Delete everything now?", yes: "Yes, delete everything", no: "Cancel", danger: true,
          text: "This can't be undone without a backup.",
          onYes: function () {
            var theme = D.settings.theme;
            D = blank(); D.settings.theme = theme;
            monYm = calYm = null;
            save();
            startWelcome();
            HH.toast("Everything was deleted. Starting fresh.");
          }
        });
      }
    });
  }

  // ── wiring ───────────────────────────────────────────────────────
  function checkedIn(el) { return ($$("input", el).filter(function (i) { return i.checked; })[0] || {}).value; }
  function wire() {
    $$("[data-nav]").forEach(function (b) {
      b.addEventListener("click", function () { go(b.getAttribute("data-nav")); });
    });
    $("#add-btn").addEventListener("click", function () { openAdd(null, "spend"); });
    $("#inc-btn").addEventListener("click", function () { openAdd(null, "income"); });
    $("#mon-add").addEventListener("click", function () { openAdd(null, "spend"); });
    $("#mon-inc").addEventListener("click", function () { openAdd(null, "income"); });
    $$('input[name="kind"]').forEach(function (r) { r.addEventListener("change", function () { if (r.checked) setKind(r.value); }); });
    $("#add-form").addEventListener("submit", saveEntry);
    $("#add-cancel").addEventListener("click", function () { go(editingEntry ? "months" : "home"); });
    $("#add-delete").addEventListener("click", deleteEntry);
    $("#add-day-change").addEventListener("click", function () { $("#add-day-wrap").hidden = false; $("#add-date").focus(); });
    $("#add-date").addEventListener("change", function () {
      var dd = HH.parseIso($("#add-date").value);
      $("#add-day-text").textContent = dd == null ? "?" : dd === T ? "Today" : HH.fmtDate(dd, true);
    });
    $("#mon-month").addEventListener("change", function () { monYm = $("#mon-month").value; render(); });
    $("#mon-plan-btn").addEventListener("click", function () { openPlan(monYm, "months"); });
    $("#plan-form").addEventListener("submit", savePlan);
    $("#plan-form").addEventListener("input", updatePlanSum);
    $("#plan-cancel").addEventListener("click", function () { if (planReturn === "welcome") toWelcome(3); else go("months"); });
    $("#bill-add").addEventListener("click", function () { openBill(null); });
    $("#bill-form").addEventListener("submit", saveBill);
    $("#b-cancel").addEventListener("click", function () { go("bills"); });
    $("#b-delete").addEventListener("click", deleteBill);
    $("#cal-month").addEventListener("change", function () { calYm = $("#cal-month").value; renderBills(); });
    $("#fund-add").addEventListener("click", function () { openFund(null); });
    $("#fund-form").addEventListener("submit", saveFund);
    $("#f-cancel").addEventListener("click", function () { go("savings"); });
    $("#f-delete").addEventListener("click", deleteFund);
    $("#goal-add").addEventListener("click", function () { openGoal(null); });
    $("#goal-form").addEventListener("submit", saveGoal);
    $("#gl-cancel").addEventListener("click", function () { go("savings"); });
    $("#gl-delete").addEventListener("click", deleteGoal);
    $("#money-form").addEventListener("submit", saveMoney);
    $("#money-cancel").addEventListener("click", function () { go("savings"); });
    $("#asset-add").addEventListener("click", function () { openItem("asset", null); });
    $("#liab-add").addEventListener("click", function () { openItem("liability", null); });
    $("#nw-form").addEventListener("submit", saveItem);
    $("#ni-cancel").addEventListener("click", function () { go("networth"); });
    $("#ni-delete").addEventListener("click", deleteItem);
    $("#nw-snap-btn").addEventListener("click", saveSnapshot);
    document.addEventListener("click", function (ev) {
      var t = ev.target.closest ? ev.target.closest("[data-edit-entry],[data-edit-bill],[data-edit-fund],[data-edit-goal],[data-fund-money],[data-fund-take]," +
        "[data-goal-money],[data-hist],[data-edit-item],[data-clear-sample],[data-backup],[data-dismiss-backup],[data-show-year],[data-copy-plan],[data-go]") : null;
      if (!t) return;
      var k;
      if (t.hasAttribute("data-edit-entry")) { var e = findEntry(t.getAttribute("data-edit-entry")); if (e) openAdd(e); }
      else if (t.hasAttribute("data-edit-bill")) openBill(byId(D.bills, +t.getAttribute("data-edit-bill")));
      else if (t.hasAttribute("data-edit-fund")) openFund(byId(D.funds, +t.getAttribute("data-edit-fund")));
      else if (t.hasAttribute("data-edit-goal")) openGoal(byId(D.goals, +t.getAttribute("data-edit-goal")));
      else if (t.hasAttribute("data-fund-money")) openMoney("fund", byId(D.funds, +t.getAttribute("data-fund-money")), 1);
      else if (t.hasAttribute("data-fund-take")) openMoney("fund", byId(D.funds, +t.getAttribute("data-fund-take")), -1);
      else if (t.hasAttribute("data-goal-money")) openMoney("goal", byId(D.goals, +t.getAttribute("data-goal-money")), 1);
      else if (t.hasAttribute("data-hist")) { k = t.getAttribute("data-hist"); openHist[k] = !openHist[k]; renderSavings(); }
      else if (t.hasAttribute("data-edit-item")) {
        var parts = t.getAttribute("data-edit-item").split(":");
        openItem(parts[0], byId(parts[0] === "liability" ? D.liabilities : D.assets, +parts[1]));
      }
      else if (t.hasAttribute("data-clear-sample")) clearSample();
      else if (t.hasAttribute("data-backup")) backup();
      else if (t.hasAttribute("data-dismiss-backup")) { D.meta.reminderDismissed = HH.iso(T); save(); renderBanners(); }
      else if (t.hasAttribute("data-show-year")) { setYear(+t.getAttribute("data-show-year")); go("home"); }
      else if (t.hasAttribute("data-copy-plan")) copyPlan(+t.getAttribute("data-copy-plan"));
      else if (t.hasAttribute("data-go")) go(t.getAttribute("data-go"));
    });
    $("#s-year").addEventListener("change", function () {
      setYear(+$("#s-year").value);
      $("#s-year-saved").textContent = "Showing " + D.settings.year + ". Every year's plan and entries are kept.";
    });
    $("#s-cur-chips").addEventListener("change", function () { var v = checkedIn($("#s-cur-chips")); if (v != null) setCurrency(v); });
    $("#s-cur").addEventListener("change", function () { setCurrency($("#s-cur").value); });
    $("#s-cats").addEventListener("change", saveCats);
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
    $("#w-cur-chips").addEventListener("change", function () { var v = checkedIn($("#w-cur-chips")); if (v != null) $("#w-cur").value = v; });
    $("#w-cur").addEventListener("input", function () {
      var v = $("#w-cur").value.trim();
      $$("#w-cur-chips input").forEach(function (i) { i.checked = i.value === v; });
    });
    $("#w-year-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      D.settings.year = +$("#w-year").value;
      D.settings.currency = $("#w-cur").value.trim().slice(0, 4);
      save();
      openPlan(ymKey(D.settings.year, 1), "welcome");
    });
    $("#w-sample").addEventListener("click", loadSample);
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
        try { window.localStorage.setItem("hh137_unreadable_" + HH.iso(HH.today()), JSON.stringify(raw)); } catch (e) { /* nothing more to do */ }
        D = blank();
      }
    } else D = blank();
    wire();
    if (D.meta.onboarded) go("home"); else startWelcome();
  }

  // for the QA runner (qa/app_qa137.py): the same maths the screens use
  window.HH137 = { yearStats: yearStats, review: review, fundStats: fundStats, goalStats: goalStats, monthOccurrences: monthOccurrences,
    yearBills: yearBills, focusMonth: focusMonth, netWorth: netWorth, migrate: migrate, validate: validate, SCHEMA: SCHEMA, APP_ID: APP_ID,
    data: function () { return D; } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
