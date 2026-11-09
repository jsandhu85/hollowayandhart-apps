window.HH_BUILD = {"id": "72", "version": "09Nov2026.1", "hosted": true};
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

/* Product 72: Budget Planner App (specs/money/72-budget-planner-app.yaml), 8 Nov 2026.
   68's Safe to Spend (the pay-period maths copied unchanged from apps/p68/app.js: 52's rules) plus a monthly category
   budget, a bills calendar, debt payoff (Snowball / Avalanche, the spec's exact month loop), savings goals and net worth.
   Money is integer cents; APRs are basis points (19.99% = 1999); dates are day numbers from HH (apps/core.js). */
(function () {
  "use strict";
  var SCHEMA = 1;
  var APP_ID = "hollowayhart-budget-planner";
  var PAY_FREQ = ["Weekly", "Fortnightly", "Monthly"];
  var BILL_FREQ = ["Weekly", "Fortnightly", "Monthly", "Quarterly", "Yearly", "One-off"];
  var DEFAULT_CATS = ["Housing", "Groceries", "Transport", "Utilities", "Health", "Fun", "Kids", "Pets", "Gifts", "Other"];
  var ASSET_TYPES = ["Cash & savings", "Property", "Investments", "Super & retirement", "Vehicle", "Other"];
  var LIAB_TYPES = ["Mortgage", "Loan", "Credit card", "Other"];
  var METHODS = ["Snowball", "Avalanche"];
  var STEP = { Weekly: 7, Fortnightly: 14 };
  var MONTHS = { Monthly: 1, Quarterly: 3, Yearly: 12 };
  var REMIND_DAYS = 30;
  var CAP_MONTHS = 600;
  var MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var $ = HH.$, $$ = HH.$$, esc = HH.esc;
  var store = new HH.Store("hh72_");
  var D = null;
  var T = HH.today();
  var editingSpend = null, editingBill = null, billReturn = "bills", pendingRestore = null;
  var editingDebt = null, editingGoal = null, moneyGoal = null, editingItem = null, itemKind = "asset";
  var budgetYm = null, calYm = null, openGoalHistory = {};

  // ── data ──────────────────────────────────────────────────────────
  function blank() {
    return {
      schema: SCHEMA,
      settings: { currency: "$", payCents: null, payFreq: "Fortnightly", nextPayday: null, asideCents: 0, theme: "auto",
                  cats: DEFAULT_CATS.slice(), debtMonthlyCents: 0, debtMethod: "Snowball", nwDebts: true },
      bills: [], spends: [], budget: {}, debts: [], goals: [], assets: [], liabilities: [], snapshots: [],
      meta: { created: HH.iso(HH.today()), lastBackup: null, reminderDismissed: null, sample: false, onboarded: false, nextId: 1 }
    };
  }
  function isInt(x) { return typeof x === "number" && isFinite(x) && Math.floor(x) === x; }
  function isDate(s) { return HH.parseIso(s) != null; }
  function isName(s, n) { return typeof s === "string" && s.length > 0 && s.length <= n; }
  function validate(d) {
    try {
      var s = d.settings, m = d.meta, i, x;
      if (d.schema !== SCHEMA || !s || !m) return false;
      if (!["bills", "spends", "debts", "goals", "assets", "liabilities", "snapshots"].every(function (k) { return Array.isArray(d[k]); })) return false;
      if (!d.budget || typeof d.budget !== "object" || Array.isArray(d.budget)) return false;
      if (typeof s.currency !== "string" || s.currency.length > 4) return false;
      if (!(s.payCents === null || (isInt(s.payCents) && s.payCents >= 0))) return false;
      if (PAY_FREQ.indexOf(s.payFreq) < 0) return false;
      if (!(s.nextPayday === null || isDate(s.nextPayday))) return false;
      if (!(isInt(s.asideCents) && s.asideCents >= 0)) return false;
      if (["auto", "light", "dark"].indexOf(s.theme) < 0) return false;
      if (!Array.isArray(s.cats) || !s.cats.length || !s.cats.every(function (c) { return isName(c, 30); })) return false;
      if (!(isInt(s.debtMonthlyCents) && s.debtMonthlyCents >= 0) || METHODS.indexOf(s.debtMethod) < 0 || typeof s.nwDebts !== "boolean") return false;
      if (!isDate(m.created) || !(m.lastBackup === null || isDate(m.lastBackup))) return false;
      if (!(m.reminderDismissed === null || isDate(m.reminderDismissed))) return false;
      if (typeof m.sample !== "boolean" || typeof m.onboarded !== "boolean" || !isInt(m.nextId)) return false;
      for (i = 0; i < d.bills.length; i++) {
        x = d.bills[i];
        if (!isInt(x.id) || !isName(x.name, 40) || !isInt(x.cents) || x.cents <= 0) return false;
        if (BILL_FREQ.indexOf(x.freq) < 0 || !isDate(x.due) || typeof x.auto !== "boolean") return false;
      }
      for (i = 0; i < d.spends.length; i++) {
        x = d.spends[i];
        if (!isInt(x.id) || !isInt(x.cents) || x.cents <= 0 || !isDate(x.date) || typeof x.note !== "string" || typeof x.cat !== "string") return false;
      }
      for (var k in d.budget) if (!(isInt(d.budget[k]) && d.budget[k] >= 0)) return false;
      for (i = 0; i < d.debts.length; i++) {
        x = d.debts[i];
        if (!isInt(x.id) || !isName(x.name, 40) || !isInt(x.cents) || x.cents < 0 || !isInt(x.aprBp) || x.aprBp < 0 || !isInt(x.minCents) || x.minCents < 0) return false;
      }
      for (i = 0; i < d.goals.length; i++) {
        x = d.goals[i];
        if (!isInt(x.id) || !isName(x.name, 40) || !isInt(x.targetCents) || x.targetCents <= 0 || !isInt(x.savedCents) || x.savedCents < 0) return false;
        if (!(x.targetDate === null || isDate(x.targetDate)) || !Array.isArray(x.deposits)) return false;
        for (var j = 0; j < x.deposits.length; j++) if (!isDate(x.deposits[j].date) || !isInt(x.deposits[j].cents)) return false;
      }
      for (i = 0; i < d.assets.length; i++) {
        x = d.assets[i];
        if (!isInt(x.id) || !isName(x.name, 40) || !isName(x.type, 30) || !isInt(x.cents) || x.cents < 0) return false;
      }
      for (i = 0; i < d.liabilities.length; i++) {
        x = d.liabilities[i];
        if (!isInt(x.id) || !isName(x.name, 40) || !isName(x.type, 30) || !isInt(x.cents) || x.cents < 0) return false;
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
  function hasOwn() { return own(D.bills) || own(D.spends) || own(D.debts) || own(D.goals) || own(D.assets) || own(D.liabilities); }
  function byId(list, id) { return list.filter(function (x) { return x.id === id; })[0]; }

  // ── the pay-period maths (68's, unchanged: 52's rules) ───────────
  function payDays(f) { return f === "Weekly" ? 7 : f === "Monthly" ? 0 : 14; }
  function monthDay(y, m, day) { return HH.dn(y, m, Math.min(day, HH.lastDay(y, m))); }
  function period(t, settings) {
    var s = settings || D.settings, N = HH.parseIso(s.nextPayday);
    if (N == null) return null;
    var pd = payDays(s.payFreq), start, next;
    if (pd) {
      start = t - HH.mod(t - N, pd);
      next = start + pd;
    } else {
      var day = HH.ymd(N).d, a = HH.ymd(t), cand = monthDay(a.y, a.m, day);
      if (cand <= t) start = cand;
      else { var p = HH.ymd(HH.dn(a.y, a.m, 1) - 1); start = monthDay(p.y, p.m, day); }
      var b = HH.ymd(start), n = HH.ymd(HH.dn(b.y, b.m, HH.lastDay(b.y, b.m)) + 1);
      next = monthDay(n.y, n.m, day);
    }
    return { start: start, end: next - 1, next: next, days: next - t };
  }
  function occBefore(t, due, freq) {
    if (STEP[freq]) return Math.floor((t - due - 1) / STEP[freq]) + 1;
    if (MONTHS[freq]) {
      var m = MONTHS[freq], kc = Math.floor(HH.monthsBetween(due, t) / m);
      return kc + (HH.addMonths(due, kc * m) < t ? 1 : 0);
    }
    return t > due ? 1 : 0;
  }
  function occAt(due, freq, n) {
    if (STEP[freq]) return due + STEP[freq] * n;
    if (MONTHS[freq]) return HH.addMonths(due, MONTHS[freq] * n);
    return n === 0 ? due : null;
  }
  function inPeriod(b, p) {
    var due = HH.parseIso(b.due), n0 = occBefore(p.start, due, b.freq), n1 = occBefore(p.end + 1, due, b.freq);
    return { count: n1 - n0, first: n1 > n0 ? occAt(due, b.freq, n0) : null };
  }
  function nextDue(b, t) {
    var due = HH.parseIso(b.due);
    return occAt(due, b.freq, occBefore(t, due, b.freq));
  }
  function compute(t) {
    var p = period(t);
    if (!p) return null;
    var pay = D.settings.payCents || 0, aside = D.settings.asideCents || 0;
    var due = [], billsTotal = 0, autoTotal = 0;
    D.bills.forEach(function (b) {
      var r = inPeriod(b, p);
      if (r.count > 0) {
        var c = r.count * b.cents;
        due.push({ bill: b, count: r.count, cents: c, first: r.first });
        billsTotal += c;
        if (b.auto) autoTotal += c;
      }
    });
    due.sort(function (x, y) { return x.first - y.first || x.bill.id - y.bill.id; });
    var upto = Math.min(p.end, t), spent = 0, n = 0, days = {}, cats = {};
    D.spends.forEach(function (x) {
      var d = HH.parseIso(x.date);
      if (d >= p.start && d <= upto) {
        spent += x.cents; n++; days[d] = 1;
        var k = x.cat || "Other";
        cats[k] = (cats[k] || 0) + x.cents;
      }
    });
    var noSpend = 0;
    for (var d = p.start; d < t; d++) if (!days[d]) noSpend++;
    var safeBefore = pay - billsTotal - aside, safe = safeBefore - spent;
    return {
      p: p, pay: pay, aside: aside, due: due, billsTotal: billsTotal, autoTotal: autoTotal, spent: spent, n: n,
      safeBefore: safeBefore, safe: safe, perDay: safe > 0 ? Math.floor(safe / p.days) : 0, noSpend: noSpend, cats: cats
    };
  }

  // ── months ───────────────────────────────────────────────────────
  function ymOf(dayNo) { var a = HH.ymd(dayNo); return a.y + "-" + (a.m < 10 ? "0" : "") + a.m; }
  function ymParts(ym) { return { y: +ym.slice(0, 4), m: +ym.slice(5, 7) }; }
  function ymLabel(ym) { var a = ymParts(ym); return MO[a.m - 1] + " " + a.y; }
  function ymRange(ym) { var a = ymParts(ym); var f = HH.dn(a.y, a.m, 1); return { first: f, last: HH.dn(a.y, a.m, HH.lastDay(a.y, a.m)) }; }
  function ymAdd(ym, k) { var a = ymParts(ym); return ymOf(HH.addMonths(HH.dn(a.y, a.m, 1), k)); }
  function monthsWithSpends() {
    var seen = {};
    D.spends.forEach(function (x) { seen[ymOf(HH.parseIso(x.date))] = 1; });
    seen[ymOf(T)] = 1;
    return Object.keys(seen).sort().reverse();
  }

  // ── the monthly budget ───────────────────────────────────────────
  function budgetRows(ym) {
    var r = ymRange(ym), actual = {}, extra = [];
    D.spends.forEach(function (x) {
      var d = HH.parseIso(x.date);
      if (d >= r.first && d <= r.last) {
        var k = x.cat || "Other";
        actual[k] = (actual[k] || 0) + x.cents;
        if (D.settings.cats.indexOf(k) < 0 && extra.indexOf(k) < 0) extra.push(k);
      }
    });
    extra.sort();
    var rows = D.settings.cats.concat(extra).map(function (c) {
      var planned = D.budget[c] || 0, a = actual[c] || 0;
      return { cat: c, planned: planned, actual: a, left: planned - a };
    });
    var tp = 0, ta = 0;
    rows.forEach(function (x) { tp += x.planned; ta += x.actual; });
    return { rows: rows, planned: tp, actual: ta, range: r };
  }
  function blocks(frac) {
    var on = Math.max(0, Math.min(20, Math.round(frac * 20))), h = '<span class="blocks" aria-hidden="true">';
    for (var i = 0; i < 20; i++) h += '<i class="' + (i < on ? "on" : "") + '"></i>';
    return h + "</span>";
  }

  // ── debt payoff (the spec's month loop, integer cents) ───────────
  function interestOf(cents, aprBp) { return Math.floor((cents * aprBp * 2 + 120000) / 240000); }
  function payoff(debts, monthly, method, cap) {
    cap = cap || CAP_MONTHS;
    var live = debts.filter(function (d) { return d.cents > 0; });
    if (!live.length) return { empty: true };
    var mins = 0;
    live.forEach(function (d) { mins += d.minCents; });
    if (monthly < mins) return { below: mins - monthly, mins: mins };
    var bal = live.map(function (d) { return d.cents; }), paid = live.map(function () { return null; });
    var interest = 0, i, pay, order;
    for (var month = 1; month <= cap; month++) {
      for (i = 0; i < live.length; i++) if (bal[i] > 0) { var it = interestOf(bal[i], live[i].aprBp); bal[i] += it; interest += it; }
      var left = monthly, paidNow = 0;
      for (i = 0; i < live.length; i++) if (bal[i] > 0) { pay = Math.min(live[i].minCents, bal[i], left); bal[i] -= pay; left -= pay; paidNow += pay; }
      order = live.map(function (_d, k) { return k; });
      order.sort(method === "Avalanche" ? function (a, b) { return live[b].aprBp - live[a].aprBp || a - b; }
                                        : function (a, b) { return bal[a] - bal[b] || a - b; });
      for (var o = 0; o < order.length && left > 0; o++) {
        i = order[o];
        if (bal[i] > 0) { pay = Math.min(bal[i], left); bal[i] -= pay; left -= pay; paidNow += pay; }
      }
      for (i = 0; i < live.length; i++) if (bal[i] === 0 && paid[i] === null) paid[i] = month;
      if (bal.every(function (b) { return b === 0; })) {
        var byId_ = {};
        live.forEach(function (d, k) { byId_[d.id] = paid[k]; });
        return { months: month, paidMonth: byId_, interest: interest, lastPayment: paidNow, mins: mins };
      }
    }
    return { never: true, mins: mins };
  }
  function extraNeeded(debts, monthly, method) {
    // the smallest whole-dollar extra that finishes within the cap (binary search on dollars)
    var lo = 1, hi = 1;
    while (payoff(debts, monthly + hi * 100, method).never && hi < 10000000) hi *= 2;
    while (lo < hi) { var mid = Math.floor((lo + hi) / 2); if (payoff(debts, monthly + mid * 100, method).never) lo = mid + 1; else hi = mid; }
    return lo * 100;
  }
  function monthLabel(k) { return ymLabel(ymAdd(ymOf(T), k)); }
  function debtSummary() {
    var s = D.settings, r = payoff(D.debts, s.debtMonthlyCents, s.debtMethod), owed = 0;
    D.debts.forEach(function (d) { owed += d.cents; });
    r.owed = owed;
    if (r.never) r.extra = extraNeeded(D.debts, s.debtMonthlyCents, s.debtMethod);
    return r;
  }

  // ── goals ────────────────────────────────────────────────────────
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
    var a = 0, l = 0, debts = 0;
    D.assets.forEach(function (x) { a += x.cents; });
    D.liabilities.forEach(function (x) { l += x.cents; });
    D.debts.forEach(function (x) { debts += x.cents; });
    if (D.settings.nwDebts) l += debts;
    return { assets: a, liabilities: l, debts: debts, net: a - l };
  }

  // ── wording helpers ──────────────────────────────────────────────
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
  function heroText(c) {
    if (c.safe < 0) return { num: m(-c.safe) + " over", cap: "until payday · " + HH.fmtDate(c.p.next) };
    return { num: m(c.safe), cap: "About " + m(c.perDay) + " a day for " + plural(c.p.days, "day", "days") };
  }
  function pct(bp) { var s = (bp / 100).toFixed(2).replace(/\.?0+$/, ""); return s + "%"; }
  function leftText(left) { return left < 0 ? m(-left) + " over" : m(left) + " left"; }

  // ── rendering ────────────────────────────────────────────────────
  function render() {
    T = HH.today();
    HH.applyTheme(D.settings.theme);
    renderBanners();
    renderHome();
    renderBudget();
    renderBills();
    renderDebts();
    renderGoals();
    renderNetWorth();
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
  function renderHome() {
    var c = compute(T);
    if (!c) return;
    var h = heroText(c);
    $("#safe-amount").textContent = h.num;
    $("#safe-caption").textContent = h.cap;
    $("#next-payday").textContent = HH.fmtDate(c.p.next) + " · " + inDays(c.p.next, T);
    $("#nospend").textContent = String(c.noSpend);
    $("#spent").textContent = m(c.spent) + " · " + plural(c.n, "thing", "things") + " logged";
    $("#bills-summary").innerHTML = c.due.length ? '<span id="bills-count">' + plural(c.due.length, "bill", "bills") +
      '</span> · <span id="bills-total">' + m(c.billsTotal) + '</span> <span class="small muted">due before your next payday</span>'
      : '<span id="bills-count">No bills</span> due before your next payday<span id="bills-total" hidden>' + m(0) + "</span>";
    $("#home-bills").innerHTML = c.due.map(function (x) {
      var when = x.first >= T ? "due " + HH.fmtDate(x.first) + " · " + inDays(x.first, T) : "was due " + HH.fmtDate(x.first);
      return '<li><span class="what"><b>' + esc(x.bill.name) + "</b><br><span class=\"small muted\">" + when +
        (x.count > 1 ? " · " + x.count + " times this pay" : "") + '</span><br><span class="tag">' +
        (x.bill.auto ? "comes out automatically" : "you pay this one") + '</span></span><span class="amt">' + m(x.cents) + "</span></li>";
    }).join("");
    $("#pay-line").textContent = "Pay " + m(c.pay) + " on " + HH.fmtDate(c.p.start) + " · bills due before next pay " +
      m(c.billsTotal) + " · put aside " + m(c.aside) + " = " + m(c.safeBefore) + " safe to spend. " +
      "Then each thing you log comes off it.";
    // the five cards
    var b = budgetRows(ymOf(T));
    $("#hc-budget-line").textContent = ymLabel(ymOf(T)) + ": spent " + m(b.actual) + " of " + m(b.planned) + " planned";
    var rows = billRows(T).filter(function (r) { return r.next != null; }).slice(0, 3);
    $("#hc-bills-list").innerHTML = rows.length ? rows.map(function (r) {
      return "<li><span>" + esc(r.b.name) + ' <span class="muted small">' + HH.fmtDate(r.next) + "</span></span><b>" + m(r.b.cents) + "</b></li>";
    }).join("") : '<li class="muted">No bills yet</li>';
    var ds = debtSummary();
    $("#hc-debts-line").textContent = ds.empty ? "No debts listed" : "Owing " + m(ds.owed) + (ds.months ? " · debt-free " + monthLabel(ds.months) :
      ds.below ? " · monthly amount below the minimums" : ds.never ? " · not paid off at this amount" : "");
    var gs = 0, gt = 0;
    D.goals.forEach(function (g) { gs += g.savedCents; gt += g.targetCents; });
    $("#hc-goals-line").textContent = D.goals.length ? "Saved " + m(gs) + " of " + m(gt) + " across " + plural(D.goals.length, "goal", "goals") : "No goals yet";
    var nw = netWorth(), snap = D.snapshots.length ? D.snapshots[D.snapshots.length - 1] : null;
    $("#hc-nw-line").textContent = (snap ? "Latest snapshot " + m(snap.net) + " · " + HH.fmtLong(HH.parseIso(snap.date)) : "Now " + m(nw.net)) +
      (D.assets.length || D.liabilities.length ? "" : " · nothing listed yet");
  }
  function spendRow(x, showDate) {
    return '<li data-spend="' + x.id + '"><button type="button" class="rowbtn" data-edit-spend="' + x.id + '" aria-label="Change ' +
      esc((x.note || "spending") + " " + m(x.cents)) + '"><span class="what"><b>' + (x.note ? esc(x.note) : '<span class="muted">No note</span>') +
      "</b><br><span class=\"small muted\">" + HH.fmtDate(HH.parseIso(x.date), showDate) + " · " + esc(x.cat || "Other") +
      (HH.parseIso(x.date) > T ? " · a future day: counts from then" : "") +
      '</span></span><span class="amt">' + m(x.cents) + '</span><span class="chev" aria-hidden="true">›</span></button></li>';
  }
  function byNewest(a, b) { return HH.parseIso(b.date) - HH.parseIso(a.date) || b.id - a.id; }
  function renderBudget() {
    var months = monthsWithSpends();
    if (!budgetYm || months.indexOf(budgetYm) < 0) budgetYm = ymOf(T);
    $("#bud-month").innerHTML = months.map(function (ym) { return '<option value="' + ym + '"' + (ym === budgetYm ? " selected" : "") + ">" + ymLabel(ym) + "</option>"; }).join("");
    var b = budgetRows(budgetYm);
    $("#bud-rows").innerHTML = b.rows.map(function (r) {
      var frac = r.planned > 0 ? r.actual / r.planned : (r.actual > 0 ? 1 : 0);
      return '<li data-cat="' + esc(r.cat) + '"><span class="what"><b>' + esc(r.cat) + '</b><br><span class="small muted">' +
        m(r.actual) + " of " + m(r.planned) + " planned · " + leftText(r.left) + "</span><br>" + blocks(frac) + '</span><span class="amt">' +
        m(r.actual) + "</span></li>";
    }).join("");
    $("#bud-planned-total").textContent = m(b.planned);
    $("#bud-actual-total").textContent = m(b.actual);
    $("#bud-left-total").textContent = leftText(b.planned - b.actual);
    var mine = D.spends.filter(function (x) { var d = HH.parseIso(x.date); return d >= b.range.first && d <= b.range.last; }).sort(byNewest);
    $("#bud-spends").innerHTML = mine.map(function (x) { return spendRow(x, false); }).join("");
    $("#bud-spends-none").hidden = mine.length > 0;
    $("#bud-spends-head").textContent = "Spending in " + ymLabel(budgetYm);
  }
  function billRows(t) {
    return D.bills.map(function (b) { return { b: b, next: nextDue(b, t) }; }).sort(function (x, y) {
      if (x.next == null && y.next == null) return x.b.id - y.b.id;
      if (x.next == null) return 1;
      if (y.next == null) return -1;
      return x.next - y.next || x.b.id - y.b.id;
    });
  }
  function billItem(r, t) {
    var b = r.b, when = r.next == null ? "One-off · was due " + HH.fmtDate(HH.parseIso(b.due), true) + " · done"
      : b.freq + " · next due " + HH.fmtDate(r.next) + " · " + inDays(r.next, t);
    return '<li data-bill="' + b.id + '"><button type="button" class="rowbtn" data-edit-bill="' + b.id + '" aria-label="Change ' +
      esc(b.name) + '"><span class="what"><b>' + esc(b.name) + '</b><br><span class="small muted">' + when +
      '</span><br><span class="tag">' + (b.auto ? "comes out automatically" : "you pay this one") + '</span></span><span class="amt">' +
      m(b.cents) + '</span><span class="chev" aria-hidden="true">›</span></button></li>';
  }
  function monthOccurrences(ym) {
    var r = ymRange(ym), byDay = {}, total = 0;
    D.bills.forEach(function (b) {
      var due = HH.parseIso(b.due), n = occBefore(r.first, due, b.freq), d = occAt(due, b.freq, n);
      while (d != null && d <= r.last) {
        if (d >= r.first) { (byDay[d] = byDay[d] || []).push(b); total += b.cents; }
        n++; d = occAt(due, b.freq, n);
      }
    });
    return { byDay: byDay, total: total, range: r };
  }
  function renderBills() {
    var rows = billRows(T);
    $("#bill-list").innerHTML = rows.map(function (r) { return billItem(r, T); }).join("");
    $("#bill-none").hidden = rows.length > 0;
    $("#w-bill-list").innerHTML = $("#bill-list").innerHTML;
    $("#w-bill-none").hidden = rows.length > 0;
    if (!calYm) calYm = ymOf(T);
    var opts = [];
    for (var k = -2; k <= 12; k++) opts.push(ymAdd(ymOf(T), k));
    if (opts.indexOf(calYm) < 0) calYm = ymOf(T);
    $("#cal-month").innerHTML = opts.map(function (ym) { return '<option value="' + ym + '"' + (ym === calYm ? " selected" : "") + ">" + ymLabel(ym) + "</option>"; }).join("");
    var occ = monthOccurrences(calYm), a = ymParts(calYm), first = occ.range.first, last = occ.range.last;
    var h = ["M", "T", "W", "T", "F", "S", "S"].map(function (w) { return '<div class="cal-h">' + w + "</div>"; }).join("");
    var lead = HH.mod(HH.weekday(first) - 1, 7);
    for (var i = 0; i < lead; i++) h += '<div class="cal-d empty"></div>';
    for (var d = first; d <= last; d++) {
      var list = occ.byDay[d] || [];
      h += '<div class="cal-d' + (d === T ? " today" : "") + (list.length ? " has" : "") + '"><span class="n">' + HH.ymd(d).d + "</span>" +
        list.map(function (b) { return '<span class="cb">' + esc(b.name) + "<br>" + m(b.cents) + "</span>"; }).join("") + "</div>";
    }
    $("#cal-grid").innerHTML = h;
    $("#cal-total").textContent = "Bills in " + MO[a.m - 1] + " " + a.y + ": " + m(occ.total);
  }
  function renderDebts() {
    var s = D.settings;
    $("#d-monthly").value = HH.plain(s.debtMonthlyCents);
    $$('input[name="method"]').forEach(function (r) { r.checked = r.value === s.debtMethod; });
    var ds = debtSummary();
    $("#debt-list").innerHTML = D.debts.map(function (d) {
      var when = ds.paidMonth && ds.paidMonth[d.id] ? "paid off " + monthLabel(ds.paidMonth[d.id]) : d.cents === 0 ? "paid off" : "";
      return '<li data-debt="' + d.id + '"><button type="button" class="rowbtn" data-edit-debt="' + d.id + '" aria-label="Change ' + esc(d.name) +
        '"><span class="what"><b>' + esc(d.name) + '</b><br><span class="small muted">' + pct(d.aprBp) + " APR · minimum " + m(d.minCents) +
        (when ? '</span><br><span class="tag">' + when + "</span>" : "</span>") + '</span><span class="amt">' + m(d.cents) +
        '</span><span class="chev" aria-hidden="true">›</span></button></li>';
    }).join("");
    $("#debt-none").hidden = D.debts.length > 0;
    $("#debt-owed").textContent = m(ds.owed || 0);
    var msg = "", free = "—", months = "—", interest = "—";
    if (ds.empty) msg = "Add a debt to see when it could be paid off.";
    else if (ds.below) msg = "Your monthly amount is below the minimums: add " + m(ds.below) + " (the minimums add up to " + m(ds.mins) + ").";
    else if (ds.never) msg = "This won't be paid off at this amount: add " + m(ds.extra) + " a month.";
    else { free = monthLabel(ds.months); months = plural(ds.months, "month", "months"); interest = m(ds.interest); }
    $("#debt-free").textContent = free;
    $("#debt-months").textContent = months;
    $("#debt-interest").textContent = interest;
    $("#debt-msg").textContent = msg;
    $("#debt-msg").hidden = !msg;
    $("#debt-method-note").textContent = s.debtMethod === "Snowball" ? "Snowball: extra money goes to the smallest balance first, for quick wins."
      : "Avalanche: extra money goes to the highest APR first, which costs the least interest.";
  }
  function renderGoals() {
    $("#goal-list").innerHTML = D.goals.map(function (g) {
      var st = goalStats(g);
      var line = st.done ? "Saved · " + m(g.savedCents) + " of " + m(g.targetCents) : m(g.savedCents) + " of " + m(g.targetCents) + " · " + st.pct + "% saved · " + m(st.left) + " left";
      var monthly = st.monthly != null && !st.done ? "Save " + m(st.monthly) + " a month to get there by " + ymLabel(ymOf(HH.parseIso(g.targetDate))) : "";
      var hist = g.deposits.slice().reverse().slice(0, 50).map(function (x) {
        return "<li><span>" + HH.fmtDate(HH.parseIso(x.date), true) + "</span><b>" + m(x.cents) + "</b></li>";
      }).join("");
      return '<li data-goal="' + g.id + '"><div class="goal"><div class="goal-top"><button type="button" class="rowbtn" data-edit-goal="' + g.id +
        '" aria-label="Change ' + esc(g.name) + '"><span class="what"><b>' + esc(g.name) + '</b><br><span class="small muted goal-line">' + line +
        "</span><br>" + blocks(st.frac) + (monthly ? '<br><span class="small goal-monthly">' + monthly + "</span>" : "") +
        '</span><span class="chev" aria-hidden="true">›</span></button></div>' +
        '<div class="row-buttons"><button type="button" class="btn btn-primary" data-goal-money="' + g.id + '">+ Add money</button>' +
        (g.deposits.length ? '<button type="button" class="btn btn-quiet" data-goal-history="' + g.id + '">' +
          (openGoalHistory[g.id] ? "Hide" : "Show") + " " + plural(g.deposits.length, "deposit", "deposits") + "</button>" : "") + "</div>" +
        (openGoalHistory[g.id] ? '<ul class="list small goal-hist">' + hist + "</ul>" : "") + "</div></li>";
    }).join("");
    $("#goal-none").hidden = D.goals.length > 0;
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
    $("#nw-liabs").innerHTML = D.liabilities.map(function (x) { return itemRow(x, "liability"); }).join("") +
      (D.settings.nwDebts && nw.debts > 0 ? '<li id="nw-debts-row"><span class="what"><b>Debts from the Debts screen</b><br><span class="small muted">' +
        plural(D.debts.length, "debt", "debts") + '</span></span><span class="amt">' + m(nw.debts) + "</span></li>" : "");
    $("#nw-liabs-none").hidden = D.liabilities.length > 0 || (D.settings.nwDebts && nw.debts > 0);
    $("#nw-debts").checked = D.settings.nwDebts;
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
  function renderSettings() {
    var s = D.settings;
    $("#s-cur").value = s.currency;
    $("#s-pay").value = s.payCents == null ? "" : HH.plain(s.payCents);
    $("#s-freq").value = s.payFreq;
    $("#s-payday").value = s.nextPayday || "";
    $("#s-aside").value = HH.plain(s.asideCents);
    $("#s-cats").value = s.cats.join("\n");
    $$('input[name="theme"]').forEach(function (r) { r.checked = r.value === s.theme; });
    $("#last-backup").textContent = D.meta.lastBackup ? "Last backup: " + HH.fmtLong(HH.parseIso(D.meta.lastBackup)) : "No backup made yet.";
    $("#sample-state").textContent = D.meta.sample ? "Sample data is on: the numbers in the app are made up." :
      "Sample data is off. You can load made-up numbers to look around while the app is empty.";
    $("#sample-btn").textContent = D.meta.sample ? "Clear the sample data" : "Load sample data";
  }
  function go(id) {
    render();
    HH.show(id);
    $("#tabs").hidden = id === "welcome";
  }

  // ── first run ────────────────────────────────────────────────────
  function welcomeStep(k) {
    [1, 2, 3, 4].forEach(function (i) {
      $("#welcome-" + i).hidden = i !== k;
      $("#st" + i).classList.toggle("on", i <= k);
    });
    if (k === 3) {
      var c = compute(T), h = heroText(c);
      $("#w-safe").textContent = h.num;
      $("#w-cap").textContent = h.cap;
    }
    var h1 = $("#welcome-" + k + " h1");
    if (h1) { h1.setAttribute("tabindex", "-1"); h1.focus(); }
  }
  function startWelcome() {
    go("welcome");
    $("#w-payday").value = "";
    welcomeStep(1);
  }
  function finishWelcome(then) {
    D.meta.onboarded = true;
    save();
    if (then === "budget") { openBudgetEdit(); }
    else if (then === "debt") { openDebt(null); }
    else if (then === "goal") { openGoal(null); }
    else go("home");
  }
  function payErrors(payTxt, payday, asideTxt) {
    if (HH.parseMoney(payTxt) == null || HH.parseMoney(payTxt) === 0) return "Type your take-home pay as a number, such as 2400 or 2400.50.";
    if (!HH.parseIso(payday)) return "Pick your next payday (any payday will do).";
    if (HH.parseMoney(asideTxt === "" ? "0" : asideTxt) == null) return "Type the amount to put aside as a number. 0 is fine.";
    return "";
  }

  // ── sample data (moves with today) ───────────────────────────────
  function loadSample() {
    var t = HH.today(), id = 1;
    var d = blank();
    d.settings = { currency: "$", payCents: 240000, payFreq: "Fortnightly", nextPayday: HH.iso(t + 5), asideCents: 15000,
                   theme: D ? D.settings.theme : "auto", cats: DEFAULT_CATS.slice(), debtMonthlyCents: 65000, debtMethod: "Snowball", nwDebts: true };
    d.bills = [
      ["Rent", 90000, "Fortnightly", 3, true], ["Phone", 6000, "Monthly", -4, true], ["Gym", 2500, "Fortnightly", -2, true],
      ["Internet", 7500, "Monthly", 18, true], ["Car insurance", 11200, "Monthly", 11, true], ["Streaming", 1699, "Monthly", 22, true],
      ["Electricity", 31000, "Quarterly", 40, false], ["Car rego", 82000, "Yearly", 60, false], ["Dentist", 18000, "One-off", 25, false]
    ].map(function (r) { return { id: id++, name: r[0], cents: r[1], freq: r[2], due: HH.iso(t + r[3]), auto: r[4], sample: true }; });
    d.spends = [
      [-1, 1840, "Groceries", "Groceries"], [-2, 650, "Coffee", "Fun"], [-3, 4500, "Fuel", "Transport"], [-4, 3200, "Dinner out", "Fun"],
      [-6, 7420, "Groceries", "Groceries"], [-7, 1200, "", "Other"], [-8, 2995, "Phone case", "Other"], [-9, 2300, "Pharmacy", "Health"],
      [-11, 6890, "Groceries", "Groceries"], [-12, 1500, "Parking", "Transport"], [-13, 4200, "Birthday gift", "Gifts"],
      [-15, 900, "Coffee", "Fun"], [-16, 5600, "Fuel", "Transport"], [-18, 8130, "Groceries", "Groceries"], [-19, 2400, "Movie", "Fun"],
      [-21, 3500, "Pet food", "Pets"], [-22, 1350, "Lunch", "Fun"], [-24, 6620, "Groceries", "Groceries"], [-26, 4800, "Fuel", "Transport"],
      [-27, 1999, "Hardware store", "Housing"], [-29, 900, "", "Other"], [-31, 7310, "Groceries", "Groceries"], [-33, 2650, "Haircut", "Health"],
      [-35, 1800, "Takeaway", "Fun"], [-37, 5200, "Fuel", "Transport"], [-38, 6980, "Groceries", "Groceries"], [-40, 1150, "Lunch", "Fun"],
      [-41, 9800, "Power bill top-up", "Utilities"], [-44, 3600, "School shoes", "Kids"]
    ].map(function (r) { return { id: id++, cents: r[1], date: HH.iso(t + r[0]), note: r[2], cat: r[3], sample: true }; });
    d.budget = { Housing: 10000, Groceries: 60000, Transport: 25000, Utilities: 12000, Health: 8000, Fun: 15000, Kids: 10000, Pets: 6000, Gifts: 5000, Other: 10000 };
    d.debts = [["Credit card", 245000, 1999, 7500], ["Car loan", 890000, 750, 31000], ["Store card", 38000, 0, 9500]]
      .map(function (r) { return { id: id++, name: r[0], cents: r[1], aprBp: r[2], minCents: r[3], sample: true }; });
    d.goals = [
      { id: id++, name: "Holiday", targetCents: 300000, savedCents: 115000, targetDate: HH.iso(HH.addMonths(t, 8)),
        deposits: [{ date: HH.iso(t - 60), cents: 40000 }, { date: HH.iso(t - 30), cents: 40000 }, { date: HH.iso(t - 2), cents: 35000 }], sample: true },
      { id: id++, name: "Emergency fund", targetCents: 500000, savedCents: 220000, targetDate: null,
        deposits: [{ date: HH.iso(t - 45), cents: 120000 }, { date: HH.iso(t - 14), cents: 100000 }], sample: true }
    ];
    d.assets = [["Everyday account", "Cash & savings", 182000], ["Savings", "Cash & savings", 640000], ["Super", "Super & retirement", 4820000], ["Car", "Vehicle", 1400000]]
      .map(function (r) { return { id: id++, name: r[0], type: r[1], cents: r[2], sample: true }; });
    d.liabilities = [];
    d.snapshots = [{ date: HH.iso(t - 61), assets: 6890000, liabilities: 1318000, net: 5572000 },
                   { date: HH.iso(t - 30), assets: 7010000, liabilities: 1245000, net: 5765000 }];
    d.meta.sample = true;
    d.meta.onboarded = true;
    d.meta.nextId = id;
    D = d;
    save();
    go("home");
    HH.toast("Sample data loaded. Clear it any time.", null, 4000);
  }
  function clearSample() {
    var keep = {}, theme = D.settings.theme, next = D.meta.nextId;
    ["bills", "spends", "debts", "goals", "assets", "liabilities"].forEach(function (k) { keep[k] = D[k].filter(function (x) { return !x.sample; }); });
    D = blank();
    D.settings.theme = theme;
    for (var k in keep) D[k] = keep[k];
    D.meta.nextId = next;
    save();
    startWelcome();
  }

  // ── spending ─────────────────────────────────────────────────────
  function catChips() {
    $("#add-cats").innerHTML = D.settings.cats.map(function (c, i) {
      return '<label class="chip"><input type="radio" name="cat" value="' + esc(c) + '" id="cat-' + i + '"><span>' + esc(c) + "</span></label>";
    }).join("");
  }
  function openAdd(spend) {
    editingSpend = spend || null;
    catChips();
    $("#add-title").textContent = spend ? "Change spending" : "Add spending";
    $("#add-amount").value = spend ? HH.plain(spend.cents) : "";
    $("#add-note").value = spend ? spend.note : "";
    var want = spend ? spend.cat : "Other";
    if (D.settings.cats.indexOf(want) < 0) want = D.settings.cats[D.settings.cats.length - 1];
    $$('#add-cats input').forEach(function (i) { i.checked = i.value === want; });
    var day = spend ? HH.parseIso(spend.date) : T;
    $("#add-date").value = HH.iso(day);
    $("#add-date").max = HH.iso(T);
    $("#add-day-text").textContent = day === T ? "Today" : HH.fmtDate(day, true);
    $("#add-day-wrap").hidden = true;
    $("#add-err").hidden = true;
    $("#add-delete").hidden = !spend;
    go("add");
    $("#add-amount").focus();
  }
  function saveSpend(ev) {
    ev.preventDefault();
    var cents = HH.parseMoney($("#add-amount").value), day = HH.parseIso($("#add-date").value);
    var err = cents == null || cents <= 0 ? "Type the amount as a number, such as 12.50." :
      day == null ? "Pick the day you spent it." : day > T ? "Pick today or an earlier day." : "";
    if (err) { $("#add-err").textContent = err; $("#add-err").hidden = false; $("#add-amount").focus(); return; }
    var cat = ($$('#add-cats input').filter(function (i) { return i.checked; })[0] || {}).value || "Other";
    var note = $("#add-note").value.trim().slice(0, 60);
    if (editingSpend) {
      var before = JSON.parse(JSON.stringify(editingSpend));
      editingSpend.cents = cents; editingSpend.date = HH.iso(day); editingSpend.note = note; editingSpend.cat = cat;
      var target = editingSpend;
      save();
      go("budget");
      HH.toast("Changed to " + m(cents), function () {
        target.cents = before.cents; target.date = before.date; target.note = before.note; target.cat = before.cat;
        save(); render();
      });
    } else {
      var x = { id: newId(), cents: cents, date: HH.iso(day), note: note, cat: cat };
      if (D.meta.sample) x.sample = false;
      D.spends.push(x);
      save();
      go("home");
      HH.toast("Saved " + m(cents) + " · Safe to Spend is now " + $("#safe-amount").textContent, function () {
        D.spends = D.spends.filter(function (s) { return s.id !== x.id; });
        save(); render();
      });
    }
  }
  function deleteSpend() {
    var x = editingSpend, i = D.spends.indexOf(x);
    if (i < 0) return;
    D.spends.splice(i, 1);
    save();
    go("budget");
    HH.toast("Deleted " + m(x.cents), function () { D.spends.splice(i, 0, x); save(); render(); });
  }

  // ── the budget (planned amounts) ─────────────────────────────────
  function openBudgetEdit() {
    $("#bud-form-rows").innerHTML = D.settings.cats.map(function (c, i) {
      return '<label for="bud-in-' + i + '">' + esc(c) + ' <span class="hint">planned per month</span></label><input id="bud-in-' + i +
        '" type="text" inputmode="decimal" autocomplete="off" data-cat="' + esc(c) + '" value="' + (D.budget[c] ? HH.plain(D.budget[c]) : "") + '">';
    }).join("");
    $("#bud-err").hidden = true;
    go("budget-edit");
  }
  function saveBudget(ev) {
    ev.preventDefault();
    var next = {}, bad = null;
    $$("#bud-form-rows input").forEach(function (i) {
      var v = i.value.trim(), c = v === "" ? 0 : HH.parseMoney(v);
      if (c == null) bad = i.getAttribute("data-cat");
      else if (c > 0) next[i.getAttribute("data-cat")] = c;
    });
    if (bad) { $("#bud-err").textContent = "Type the amount for " + bad + " as a number, such as 600. Blank means 0."; $("#bud-err").hidden = false; return; }
    D.budget = next;
    save();
    go("budget");
    HH.toast("Budget saved");
  }

  // ── bills ────────────────────────────────────────────────────────
  function openBill(b, from) {
    editingBill = b || null;
    billReturn = from || "bills";
    $("#bill-title").textContent = b ? "Change bill" : "Add a bill";
    $("#b-name").value = b ? b.name : "";
    $("#b-amount").value = b ? HH.plain(b.cents) : "";
    $("#b-freq").value = b ? b.freq : "Monthly";
    $("#b-due").value = b ? (HH.iso(nextDue(b, T) == null ? HH.parseIso(b.due) : nextDue(b, T))) : "";
    $("#b-auto").checked = b ? b.auto : false;
    $("#b-err").hidden = true;
    $("#b-delete").hidden = !b;
    go("bill-edit");
    $("#tabs").hidden = billReturn === "welcome";
    $("#b-name").focus();
  }
  function closeBill() {
    if (billReturn === "welcome") { go("welcome"); welcomeStep(2); } else go("bills");
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
    closeBill();
    HH.toast((editingBill ? "Changed " : "Added ") + name);
  }
  function deleteBill() {
    var b = editingBill, i = D.bills.indexOf(b);
    if (i < 0) return;
    D.bills.splice(i, 1);
    save();
    closeBill();
    HH.toast("Deleted " + b.name, function () { D.bills.splice(i, 0, b); save(); render(); });
  }

  // ── debts ────────────────────────────────────────────────────────
  function openDebt(d) {
    editingDebt = d || null;
    $("#debt-title").textContent = d ? "Change debt" : "Add a debt";
    $("#dt-name").value = d ? d.name : "";
    $("#dt-balance").value = d ? HH.plain(d.cents) : "";
    $("#dt-apr").value = d ? (d.aprBp / 100).toFixed(2).replace(/\.?0+$/, "") : "";
    $("#dt-min").value = d ? HH.plain(d.minCents) : "";
    $("#dt-err").hidden = true;
    $("#dt-delete").hidden = !d;
    go("debt-edit");
    $("#dt-name").focus();
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
    var min = HH.parseMoney($("#dt-min").value === "" ? "0" : $("#dt-min").value);
    var err = !name ? "Give the debt a name, such as Credit card." : cents == null ? "Type the balance as a number, such as 1200." :
      apr == null ? "Type the APR as a number, such as 19.99. Use 0 for an interest-free debt." : min == null ? "Type the minimum payment as a number. 0 is fine." : "";
    if (err) { $("#dt-err").textContent = err; $("#dt-err").hidden = false; return; }
    var d = editingDebt || { id: newId() };
    d.name = name; d.cents = cents; d.aprBp = apr; d.minCents = min;
    if (!editingDebt) { if (D.meta.sample) d.sample = false; D.debts.push(d); }
    save();
    go("debts");
    HH.toast((editingDebt ? "Changed " : "Added ") + name);
  }
  function deleteDebt() {
    var d = editingDebt, i = D.debts.indexOf(d);
    if (i < 0) return;
    D.debts.splice(i, 1);
    save();
    go("debts");
    HH.toast("Deleted " + d.name, function () { D.debts.splice(i, 0, d); save(); render(); });
  }
  function saveDebtSettings() {
    var c = HH.parseMoney($("#d-monthly").value === "" ? "0" : $("#d-monthly").value);
    if (c == null) { $("#d-err").textContent = "Type the monthly amount as a number, such as 650."; $("#d-err").hidden = false; return; }
    $("#d-err").hidden = true;
    D.settings.debtMonthlyCents = c;
    D.settings.debtMethod = ($$('input[name="method"]').filter(function (r) { return r.checked; })[0] || {}).value || "Snowball";
    save();
    renderDebts(); renderHome();
  }

  // ── goals ────────────────────────────────────────────────────────
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
    go("goals");
    HH.toast((editingGoal ? "Changed " : "Added ") + name);
  }
  function deleteGoal() {
    var g = editingGoal, i = D.goals.indexOf(g);
    if (i < 0) return;
    D.goals.splice(i, 1);
    save();
    go("goals");
    HH.toast("Deleted " + g.name, function () { D.goals.splice(i, 0, g); save(); render(); });
  }
  function openMoney(g) {
    moneyGoal = g;
    $("#gm-title").textContent = "Add money to " + g.name;
    $("#gm-amount").value = "";
    $("#gm-err").hidden = true;
    go("goal-money");
    $("#gm-amount").focus();
  }
  function saveMoney(ev) {
    ev.preventDefault();
    var cents = HH.parseMoney($("#gm-amount").value);
    if (cents == null || cents <= 0) { $("#gm-err").textContent = "Type the amount as a number, such as 300."; $("#gm-err").hidden = false; return; }
    var g = moneyGoal, dep = { date: HH.iso(T), cents: cents };
    g.savedCents += cents;
    g.deposits.push(dep);
    save();
    go("goals");
    HH.toast("Added " + m(cents) + " to " + g.name, function () {
      g.savedCents -= cents; g.deposits.splice(g.deposits.indexOf(dep), 1); save(); render();
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
  function saveSettings() {
    var s = D.settings, payTxt = $("#s-pay").value, asideTxt = $("#s-aside").value, payday = $("#s-payday").value;
    var err = payErrors(payTxt, payday, asideTxt);
    var cur = $("#s-cur").value.trim().slice(0, 4);
    if (err) { $("#s-err").textContent = err; $("#s-err").hidden = false; $("#s-saved").textContent = ""; return; }
    $("#s-err").hidden = true;
    s.currency = cur; s.payCents = HH.parseMoney(payTxt); s.payFreq = $("#s-freq").value; s.nextPayday = payday;
    s.asideCents = HH.parseMoney(asideTxt === "" ? "0" : asideTxt);
    save();
    renderBanners(); renderHome(); renderBills(); renderBudget();
    $("#s-saved").textContent = "Saved. Safe to Spend is now " + $("#safe-amount").textContent + ".";
  }
  function saveCats() {
    var lines = $("#s-cats").value.split("\n").map(function (x) { return x.trim().slice(0, 30); }).filter(function (x) { return x; });
    var seen = {}, cats = [];
    lines.forEach(function (c) { if (!seen[c.toLowerCase()]) { seen[c.toLowerCase()] = 1; cats.push(c); } });
    if (!cats.length) cats = DEFAULT_CATS.slice();
    D.settings.cats = cats;
    save();
    renderBudget(); renderHome();
    $("#s-cats-saved").textContent = "Saved " + plural(cats.length, "category", "categories") + ". Spending keeps the category it was given.";
  }

  // ── backup and restore ───────────────────────────────────────────
  function backup() {
    T = HH.today();
    D.meta.lastBackup = HH.iso(T);
    D.meta.reminderDismissed = null;
    save();
    var name = "hollowayhart-budget-app-backup-" + HH.iso(T) + ".json";
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
        plural(d.bills.length, "bill", "bills") + " · " + plural(d.spends.length, "spending entry", "spending entries") + " · " +
        plural(d.debts.length, "debt", "debts") + " · " + plural(d.goals.length, "goal", "goals") + " · " +
        plural(d.assets.length + d.liabilities.length, "net worth item", "net worth items") +
        (r.made != null ? " · made " + HH.fmtLong(r.made) : "") +
        '<p class="small" style="margin-top:6px">Restoring replaces everything in the app now.</p>' +
        '<div class="row-buttons"><button type="button" class="btn btn-primary" id="restore-yes">Replace with this backup</button>' +
        '<button type="button" class="btn btn-quiet" id="restore-no">Cancel</button></div></div>');
      $("#restore-yes").addEventListener("click", function () {
        D = pendingRestore; pendingRestore = null;
        save();
        restoreMsg("");
        if (!D.meta.onboarded || HH.parseIso(D.settings.nextPayday) == null) startWelcome(); else go("home");
        HH.toast("Backup restored.");
      });
      $("#restore-no").addEventListener("click", function () { pendingRestore = null; restoreMsg(""); });
    });
  }
  function startFresh() {
    HH.confirmStep({
      title: "Start fresh?", yes: "Next", no: "Keep my data",
      text: "This deletes your pay, bills, spending, budget, debts, goals and net worth from this browser. If you might want them again, cancel and use Back up now first.",
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
    $$("[data-nav]").forEach(function (b) {
      b.addEventListener("click", function () { go(b.getAttribute("data-nav")); });
    });
    $("#add-btn").addEventListener("click", function () { openAdd(null); });
    $("#add-form").addEventListener("submit", saveSpend);
    $("#add-cancel").addEventListener("click", function () { go(editingSpend ? "budget" : "home"); });
    $("#add-delete").addEventListener("click", deleteSpend);
    $("#add-day-change").addEventListener("click", function () { $("#add-day-wrap").hidden = false; $("#add-date").focus(); });
    $("#add-date").addEventListener("change", function () {
      var d = HH.parseIso($("#add-date").value);
      $("#add-day-text").textContent = d == null ? "?" : d === T ? "Today" : HH.fmtDate(d, true);
    });
    $("#bud-month").addEventListener("change", function () { budgetYm = $("#bud-month").value; renderBudget(); });
    $("#bud-edit-btn").addEventListener("click", openBudgetEdit);
    $("#bud-form").addEventListener("submit", saveBudget);
    $("#bud-cancel").addEventListener("click", function () { go("budget"); });
    $("#bud-add").addEventListener("click", function () { openAdd(null); });
    $("#bill-add").addEventListener("click", function () { openBill(null, "bills"); });
    $("#bill-form").addEventListener("submit", saveBill);
    $("#b-cancel").addEventListener("click", closeBill);
    $("#b-delete").addEventListener("click", deleteBill);
    $("#cal-month").addEventListener("change", function () { calYm = $("#cal-month").value; renderBills(); });
    $("#debt-add").addEventListener("click", function () { openDebt(null); });
    $("#debt-form").addEventListener("submit", saveDebt);
    $("#dt-cancel").addEventListener("click", function () { go("debts"); });
    $("#dt-delete").addEventListener("click", deleteDebt);
    $("#d-monthly").addEventListener("change", saveDebtSettings);
    $("#d-form").addEventListener("submit", function (ev) { ev.preventDefault(); saveDebtSettings(); });
    $$('input[name="method"]').forEach(function (r) { r.addEventListener("change", saveDebtSettings); });
    $("#goal-add").addEventListener("click", function () { openGoal(null); });
    $("#goal-form").addEventListener("submit", saveGoal);
    $("#gl-cancel").addEventListener("click", function () { go("goals"); });
    $("#gl-delete").addEventListener("click", deleteGoal);
    $("#gm-form").addEventListener("submit", saveMoney);
    $("#gm-cancel").addEventListener("click", function () { go("goals"); });
    $("#asset-add").addEventListener("click", function () { openItem("asset", null); });
    $("#liab-add").addEventListener("click", function () { openItem("liability", null); });
    $("#nw-form").addEventListener("submit", saveItem);
    $("#ni-cancel").addEventListener("click", function () { go("networth"); });
    $("#ni-delete").addEventListener("click", deleteItem);
    $("#nw-debts").addEventListener("change", function () { D.settings.nwDebts = $("#nw-debts").checked; save(); renderNetWorth(); renderHome(); });
    $("#nw-snap-btn").addEventListener("click", saveSnapshot);
    document.addEventListener("click", function (ev) {
      var t = ev.target.closest ? ev.target.closest("[data-edit-spend],[data-edit-bill],[data-edit-debt],[data-edit-goal],[data-goal-money]," +
        "[data-goal-history],[data-edit-item],[data-clear-sample],[data-backup],[data-dismiss-backup],[data-go]") : null;
      if (!t) return;
      var id;
      if (t.hasAttribute("data-edit-spend")) openAdd(byId(D.spends, +t.getAttribute("data-edit-spend")));
      else if (t.hasAttribute("data-edit-bill")) openBill(byId(D.bills, +t.getAttribute("data-edit-bill")), $("#tabs").hidden ? "welcome" : "bills");
      else if (t.hasAttribute("data-edit-debt")) openDebt(byId(D.debts, +t.getAttribute("data-edit-debt")));
      else if (t.hasAttribute("data-edit-goal")) openGoal(byId(D.goals, +t.getAttribute("data-edit-goal")));
      else if (t.hasAttribute("data-goal-money")) openMoney(byId(D.goals, +t.getAttribute("data-goal-money")));
      else if (t.hasAttribute("data-goal-history")) { id = +t.getAttribute("data-goal-history"); openGoalHistory[id] = !openGoalHistory[id]; renderGoals(); }
      else if (t.hasAttribute("data-edit-item")) {
        var parts = t.getAttribute("data-edit-item").split(":");
        openItem(parts[0], byId(parts[0] === "liability" ? D.liabilities : D.assets, +parts[1]));
      }
      else if (t.hasAttribute("data-clear-sample")) clearSample();
      else if (t.hasAttribute("data-backup")) backup();
      else if (t.hasAttribute("data-dismiss-backup")) { D.meta.reminderDismissed = HH.iso(T); save(); renderBanners(); }
      else if (t.hasAttribute("data-go")) go(t.getAttribute("data-go"));
    });
    ["#s-cur", "#s-pay", "#s-freq", "#s-payday", "#s-aside"].forEach(function (id) { $(id).addEventListener("change", saveSettings); });
    $("#set-form").addEventListener("submit", function (ev) { ev.preventDefault(); saveSettings(); });
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
    $("#w-pay").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var payTxt = $("#w-amount").value, payday = $("#w-payday").value, asideTxt = $("#w-aside").value;
      var err = payErrors(payTxt, payday, asideTxt);
      if (err) { $("#w-err").textContent = err; $("#w-err").hidden = false; return; }
      $("#w-err").hidden = true;
      var s = D.settings;
      s.payCents = HH.parseMoney(payTxt); s.payFreq = $("#w-freq").value; s.nextPayday = payday;
      s.asideCents = HH.parseMoney(asideTxt === "" ? "0" : asideTxt);
      save();
      renderBills();
      welcomeStep(2);
    });
    $("#w-sample").addEventListener("click", loadSample);
    $("#w-bill-add").addEventListener("click", function () { openBill(null, "welcome"); });
    $("#w-bills-done").addEventListener("click", function () { welcomeStep(3); });
    $("#w-bills-skip").addEventListener("click", function () { welcomeStep(3); });
    $("#w-next3").addEventListener("click", function () { welcomeStep(4); });
    $("#w-setup-budget").addEventListener("click", function () { finishWelcome("budget"); });
    $("#w-setup-debt").addEventListener("click", function () { finishWelcome("debt"); });
    $("#w-setup-goal").addEventListener("click", function () { finishWelcome("goal"); });
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
        try { window.localStorage.setItem("hh72_unreadable_" + HH.iso(HH.today()), JSON.stringify(raw)); } catch (e) { /* nothing more to do */ }
        D = blank();
      }
    } else D = blank();
    wire();
    if (D.meta.onboarded && HH.parseIso(D.settings.nextPayday) != null) go("home"); else startWelcome();
  }

  // for the QA runner (qa/app_qa72.py): the same maths the screens use
  window.HH72 = { period: period, occBefore: occBefore, occAt: occAt, compute: compute, payoff: payoff, extraNeeded: extraNeeded,
    budgetRows: budgetRows, goalStats: goalStats, netWorth: netWorth, migrate: migrate, SCHEMA: SCHEMA, APP_ID: APP_ID,
    data: function () { return D; } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
