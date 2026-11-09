window.HH_BUILD = {"id": "71", "version": "09Nov2026.1", "hosted": true};
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
  // Backup: on a touch device that can share a file, the share sheet (Save to Files, email, a cloud drive); otherwise the
  // download as before. Returns "share" or "download" so the app can word its message. A share the buyer cancels is left alone;
  // a share that fails for any other reason falls back to the download.
  function saveFile(name, text) {
    var touch = navigator.maxTouchPoints > 0;
    if (touch && navigator.share && navigator.canShare && typeof File === "function") {
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

/* Product 71: Christmas Gift Tracker App (specs/life/71-christmas-gift-tracker-app.yaml), 8 Nov 2026, on the app chassis
   (apps/core.js: dates as day numbers, money in integer cents, storage with a schema number, Backup / Restore, toast + Undo,
   two-step confirm). One year at a time: people with a budget each (or one overall budget), gifts with a status
   (Idea / Bought / Wrapped / Given); Spent counts Bought, Wrapped and Given; an Idea's price is planned, not spent.
   'Start next year' keeps the people, groups and budgets and moves the year's gifts to Past years (read-only). */
(function () {
  "use strict";
  var SCHEMA = 1;
  var APP_ID = "hollowayhart-gift-tracker";
  var STATUS = ["Idea", "Bought", "Wrapped", "Given"];
  var DEFAULT_GROUPS = ["Family", "Friends", "Work", "Kids", "Other"];
  var REMIND_DAYS = 30;
  var $ = HH.$, $$ = HH.$$, esc = HH.esc;
  var store = new HH.Store("hh71_");
  var D = null;          // the data
  var T = HH.today();    // today, refreshed on every render
  var editingPerson = null, editingGift = null, giftReturn = "gifts", pendingRestore = null, filterPerson = "", filterStatus = "";

  // ── data ──────────────────────────────────────────────────────────
  function blank() {
    var t = HH.today();
    return {
      schema: SCHEMA, year: HH.ymd(t).y,
      settings: { currency: "$", budgetCents: null, groups: DEFAULT_GROUPS.slice(), theme: "auto" },
      people: [], gifts: [], archive: [],
      meta: { created: HH.iso(t), lastBackup: null, reminderDismissed: null, sample: false, onboarded: false, nextId: 1 }
    };
  }
  function isInt(x) { return typeof x === "number" && isFinite(x) && Math.floor(x) === x; }
  function isDate(s) { return HH.parseIso(s) != null; }
  function isMoneyOrNull(x) { return x === null || (isInt(x) && x >= 0); }
  function validYear(people, gifts) {
    if (!Array.isArray(people) || !Array.isArray(gifts)) return false;
    var ids = {};
    for (var i = 0; i < people.length; i++) {
      var p = people[i];
      if (!isInt(p.id) || ids[p.id] || typeof p.name !== "string" || !p.name || typeof p.group !== "string") return false;
      if (!isMoneyOrNull(p.budgetCents)) return false;
      ids[p.id] = true;
    }
    for (var j = 0; j < gifts.length; j++) {
      var g = gifts[j];
      if (!isInt(g.id) || !ids[g.personId] || typeof g.idea !== "string" || !g.idea || !isMoneyOrNull(g.cents)) return false;
      if (typeof g.where !== "string" || STATUS.indexOf(g.status) < 0 || typeof g.card !== "boolean" || typeof g.thanks !== "boolean") return false;
      if (typeof g.note !== "string") return false;
    }
    return true;
  }
  function validate(d) {
    try {
      var s = d.settings, m = d.meta;
      if (d.schema !== SCHEMA || !s || !m || !isInt(d.year) || d.year < 2000 || d.year > 2200) return false;
      if (typeof s.currency !== "string" || s.currency.length > 4 || !isMoneyOrNull(s.budgetCents)) return false;
      if (!Array.isArray(s.groups) || s.groups.length > 30 || !s.groups.every(function (g) { return typeof g === "string" && g; })) return false;
      if (["auto", "light", "dark"].indexOf(s.theme) < 0) return false;
      if (!isDate(m.created) || !(m.lastBackup === null || isDate(m.lastBackup))) return false;
      if (!(m.reminderDismissed === null || isDate(m.reminderDismissed))) return false;
      if (typeof m.sample !== "boolean" || typeof m.onboarded !== "boolean" || !isInt(m.nextId)) return false;
      if (!validYear(d.people, d.gifts) || !Array.isArray(d.archive)) return false;
      for (var k = 0; k < d.archive.length; k++) {
        var a = d.archive[k];
        if (!isInt(a.year) || !validYear(a.people, a.gifts)) return false;
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
  function save() {
    if (!store.write(D)) renderBanners();
  }
  function newId() { return D.meta.nextId++; }
  function hasOwn() {
    return D.people.some(function (p) { return !p.sample; }) || D.gifts.some(function (g) { return !g.sample; });
  }
  function person(id) { return D.people.filter(function (p) { return p.id === id; })[0] || null; }

  // ── the numbers ──────────────────────────────────────────────────
  function totals(people, gifts, settings) {
    var sumBudgets = 0, spent = 0, planned = 0, toBuy = 0, toWrap = 0, toGive = 0;
    people.forEach(function (p) { sumBudgets += p.budgetCents || 0; });
    gifts.forEach(function (g) {
      if (g.status === "Idea") { toBuy++; planned += g.cents || 0; }
      else { spent += g.cents || 0; if (g.status === "Bought") toWrap++; if (g.status !== "Given") toGive++; }
    });
    var total = settings.budgetCents != null ? settings.budgetCents : sumBudgets;
    return { total: total, spent: spent, left: total - spent, planned: planned, toBuy: toBuy, toWrap: toWrap, toGive: toGive,
             sumBudgets: sumBudgets, overall: settings.budgetCents != null };
  }
  function personStats(p, gifts) {
    var mine = gifts.filter(function (g) { return g.personId === p.id; }), spent = 0;
    mine.forEach(function (g) { if (g.status !== "Idea") spent += g.cents || 0; });
    return { mine: mine, spent: spent, allDone: mine.length > 0 && mine.every(function (g) { return g.status === "Given"; }) };
  }
  function countdown(t) {
    var y = HH.ymd(t).y, xmas = HH.dn(y, 12, 25), k = xmas - t;
    if (k === 0) return "Merry Christmas";
    if (k > 0) return k + (k === 1 ? " day" : " days") + " until Christmas";
    return "Christmas is done: start next year from Settings";
  }
  function m(c) { return HH.money(c, D.settings.currency); }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
  function blocks(spent, budget) {
    var n = budget > 0 ? Math.round(Math.max(0, Math.min(1, spent / budget)) * 20) : 0, h = "";
    for (var i = 0; i < 20; i++) h += '<i class="' + (i < n ? "on" : "") + '"></i>';
    return '<span class="blocks" aria-hidden="true">' + h + "</span>";
  }
  function leftText(tt) {
    if (tt.left < 0) return { num: m(-tt.left) + " over", cap: "of your " + m(tt.total) + " budget" };
    return { num: m(tt.left), cap: "of " + m(tt.total) + (tt.overall ? " overall" : " (everyone's budgets added up)") };
  }

  // ── rendering ────────────────────────────────────────────────────
  function render() {
    T = HH.today();
    HH.applyTheme(D.settings.theme);
    renderBanners();
    renderHome();
    renderPeople();
    renderGifts();
    renderShopping();
    renderSettings();
    renderPast();
  }
  function renderBanners() {
    var h = "";
    if (!store.ok) {
      h += '<div class="banner" id="storage-banner" role="alert"><strong>Your browser isn\'t saving data in this window. ' +
        "Use Backup before you close it.</strong>This happens in private windows, or when the browser is set to block site data. " +
        "The app still works until you close it.</div>";
    }
    if (D && D.meta.sample) {
      h += '<div class="banner slim" id="sample-banner"><span><span class="sample-flag">SAMPLE</span> · made-up people and gifts</span>' +
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
    var tt = totals(D.people, D.gifts, D.settings), lt = leftText(tt);
    $("#h-left").textContent = lt.num;
    $("#h-left-cap").textContent = lt.cap;
    $("#h-budget").textContent = m(tt.total);
    $("#h-spent").textContent = m(tt.spent);
    $("#h-planned").textContent = m(tt.planned);
    $("#countdown").textContent = countdown(T);
    $("#c-people").textContent = String(D.people.length);
    $("#c-buy").textContent = String(tt.toBuy);
    $("#c-wrap").textContent = String(tt.toWrap);
    $("#c-give").textContent = String(tt.toGive);
    $("#budget-line").textContent = (tt.overall ? "Overall budget " + m(tt.total) + " (set in Settings; everyone's budgets add up to " +
      m(tt.sumBudgets) + ")" : "Total budget " + m(tt.total) + " = everyone's budgets added up (set one overall budget in Settings " +
      "if you'd rather)") + " − spent " + m(tt.spent) + " (gifts that are Bought, Wrapped or Given) = " + lt.num + ". Ideas are planned, not spent.";
  }
  function personRow(p) {
    var st = personStats(p, D.gifts), b = p.budgetCents;
    var line = b != null ? m(st.spent) + " of " + m(b) : m(st.spent) + " spent · no budget set";
    return '<li data-person="' + p.id + '"><button type="button" class="rowbtn" data-edit-person="' + p.id + '" aria-label="Change ' + esc(p.name) +
      '"><span class="what"><b>' + esc(p.name) + '</b> <span class="tag">' + esc(p.group) + "</span>" +
      (st.allDone ? ' <span class="tag done">✓ all given</span>' : "") + '<br><span class="small muted">' + line + " · " +
      plural(st.mine.length, "gift", "gifts") + "</span><br>" + blocks(st.spent, b || 0) + '</span><span class="chev" aria-hidden="true">›</span></button></li>';
  }
  function renderPeople() {
    $("#people-list").innerHTML = D.people.map(personRow).join("");
    $("#people-none").hidden = D.people.length > 0;
  }
  function giftRow(g, readOnly, people) {
    var p = (people || D.people).filter(function (x) { return x.id === g.personId; })[0];
    var price = g.cents == null ? "no price" : (g.status === "Idea" ? m(g.cents) + " planned" : m(g.cents));
    var inner = '<span class="what"><b>' + esc(g.idea) + "</b><br><span class=\"small muted\">" + esc(p ? p.name : "?") + " · " + esc(g.status) +
      (g.where ? " · " + esc(g.where) : "") + (g.note ? " · " + esc(g.note) : "") + "</span>" +
      (g.card || g.thanks ? "<br>" + (g.card ? '<span class="tag">card sent</span> ' : "") + (g.thanks ? '<span class="tag">thank-you received</span>' : "") : "") +
      '</span><span class="amt">' + price + "</span>";
    if (readOnly) return "<li>" + inner + "</li>";
    return '<li data-gift="' + g.id + '"><button type="button" class="rowbtn" data-edit-gift="' + g.id + '" aria-label="Change ' + esc(g.idea) + '">' +
      inner + '<span class="chev" aria-hidden="true">›</span></button></li>';
  }
  function renderGifts() {
    var sel = $("#f-person"), keep = filterPerson;
    sel.innerHTML = '<option value="">Everyone</option>' + D.people.map(function (p) {
      return '<option value="' + p.id + '">' + esc(p.name) + "</option>";
    }).join("");
    sel.value = keep && person(+keep) ? keep : "";
    filterPerson = sel.value;
    $("#f-status").innerHTML = [""].concat(STATUS).map(function (s, i) {
      return '<label class="chip"><input type="radio" name="fstatus" value="' + esc(s) + '"' + (s === filterStatus ? " checked" : "") +
        '><span>' + (s || "All") + "</span></label>";
    }).join("");
    var list = D.gifts.filter(function (g) {
      return (!filterPerson || g.personId === +filterPerson) && (!filterStatus || g.status === filterStatus);
    }).slice().sort(function (a, b) { return STATUS.indexOf(a.status) - STATUS.indexOf(b.status) || a.id - b.id; });
    $("#gift-list").innerHTML = list.map(function (g) { return giftRow(g, false); }).join("");
    $("#gift-none").hidden = list.length > 0;
    $("#gift-none").textContent = D.gifts.length ? "No gifts match that filter." : "No gifts yet.";
  }
  function renderShopping() {
    var ideas = D.gifts.filter(function (g) { return g.status === "Idea"; });
    var groups = {}, order = [];
    ideas.forEach(function (g) {
      var k = g.where.trim() || "Anywhere";
      if (!groups[k]) { groups[k] = []; order.push(k); }
      groups[k].push(g);
    });
    order.sort(function (a, b) { return a === "Anywhere" ? 1 : b === "Anywhere" ? -1 : a.toLowerCase() < b.toLowerCase() ? -1 : 1; });
    $("#shop-groups").innerHTML = order.map(function (k) {
      var sum = 0;
      groups[k].forEach(function (g) { sum += g.cents || 0; });
      return '<div class="card" data-shop-group="' + esc(k) + '"><h2>' + esc(k) + ' <span class="small muted">' + plural(groups[k].length, "gift", "gifts") + " · " +
        m(sum) + ' planned</span></h2><ul class="list">' + groups[k].map(function (g) {
          var p = person(g.personId);
          return '<li data-shop="' + g.id + '"><span class="what"><b>' + esc(g.idea) + '</b><br><span class="small muted">' + esc(p ? p.name : "?") +
            (g.note ? " · " + esc(g.note) : "") + '</span></span><span class="amt">' + (g.cents == null ? "no price" : m(g.cents)) +
            '</span><button type="button" class="btn btn-quiet" data-bought="' + g.id + '">Bought</button></li>';
        }).join("") + "</ul></div>";
    }).join("");
    $("#shop-none").hidden = ideas.length > 0;
  }
  function groupOptions(current) {
    var gs = D.settings.groups.slice();
    if (current && gs.indexOf(current) < 0) gs.push(current);
    return gs.map(function (g) { return '<option value="' + esc(g) + '"' + (g === current ? " selected" : "") + ">" + esc(g) + "</option>"; }).join("");
  }
  function renderSettings() {
    var s = D.settings;
    $("#s-cur").value = s.currency;
    $("#s-budget").value = s.budgetCents == null ? "" : HH.plain(s.budgetCents);
    $("#s-groups").value = s.groups.join("\n");
    $$('input[name="theme"]').forEach(function (r) { r.checked = r.value === s.theme; });
    $("#last-backup").textContent = D.meta.lastBackup ? "Last backup: " + HH.fmtLong(HH.parseIso(D.meta.lastBackup)) : "No backup made yet.";
    $("#year-line").textContent = "This list is for Christmas " + D.year + ": " + plural(D.people.length, "person", "people") + ", " +
      plural(D.gifts.length, "gift", "gifts") + "." + (D.archive.length ? " Past years kept: " + D.archive.map(function (a) { return a.year; }).join(", ") + "." : "");
    $("#sample-state").textContent = D.meta.sample ? "Sample data is on: the people and gifts in the app are made up." :
      "Sample data is off. You can load made-up people and gifts to look around while the app is empty.";
    $("#sample-btn").textContent = D.meta.sample ? "Clear the sample data" : "Load sample data";
  }
  function renderPast() {
    var years = D.archive.slice().sort(function (a, b) { return b.year - a.year; });
    $("#past-years").innerHTML = years.map(function (a) {
      var tt = totals(a.people, a.gifts, { budgetCents: null }), spent = 0;
      a.gifts.forEach(function (g) { if (g.status !== "Idea") spent += g.cents || 0; });
      return '<div class="card" data-past-year="' + a.year + '"><h2>Christmas ' + a.year + '</h2><p class="small muted">' + plural(a.people.length, "person", "people") +
        " · " + plural(a.gifts.length, "gift", "gifts") + " · " + m(spent) + ' spent</p><ul class="list">' +
        a.gifts.map(function (g) { return giftRow(g, true, a.people); }).join("") + "</ul></div>";
    }).join("");
    $("#past-none").hidden = years.length > 0;
  }
  function go(id) {
    render();
    HH.show(id);
    $("#tabs").hidden = id === "welcome";
  }

  // ── first run ────────────────────────────────────────────────────
  function welcomeStep(k) {
    [1, 2, 3].forEach(function (i) {
      $("#welcome-" + i).hidden = i !== k;
      $("#st" + i).classList.toggle("on", i <= k);
    });
    if (k === 2) $("#w-group").innerHTML = groupOptions(D.settings.groups[0]);
    if (k === 3) {
      var lt = leftText(totals(D.people, D.gifts, D.settings));
      $("#w-left").textContent = lt.num;
      $("#w-cap").textContent = lt.cap;
    }
    var h1 = $("#welcome-" + k + " h1");
    if (h1) { h1.setAttribute("tabindex", "-1"); h1.focus(); }
  }
  function startWelcome() {
    go("welcome");
    $("#w-budget").value = "";
    $("#w-name").value = ""; $("#w-pbudget").value = "";
    welcomeStep(1);
  }
  function moneyOrNull(txt) {
    var t = String(txt || "").trim();
    if (t === "") return null;
    return HH.parseMoney(t);
  }

  // ── sample data (clearly labelled; one tap clears it) ────────────
  function loadSample() {
    var id = 1, d = blank();
    d.settings = { currency: "$", budgetCents: null, groups: DEFAULT_GROUPS.slice(), theme: D ? D.settings.theme : "auto" };
    d.people = [
      ["Mum", "Family", 12000], ["Dad", "Family", 10000], ["Grandma", "Family", 6000], ["Sam", "Kids", 8000],
      ["Priya", "Friends", 4000], ["Leo", "Friends", 3500], ["Amara", "Work", 2500], ["Jack", "Kids", 8000]
    ].map(function (r) { return { id: id++, name: r[0], group: r[1], budgetCents: r[2], sample: true }; });
    var P = {}; d.people.forEach(function (p) { P[p.name] = p.id; });
    d.gifts = [
      ["Mum", "Scarf", 4500, "Department store", "Wrapped", true, false, ""],
      ["Mum", "Cookbook", 3200, "Bookshop", "Bought", false, false, "the one she mentioned"],
      ["Mum", "Candles", 2800, "", "Idea", false, false, ""],
      ["Dad", "Coffee beans", 2400, "Online", "Given", true, true, ""],
      ["Dad", "Gardening gloves", 1900, "Hardware store", "Bought", false, false, ""],
      ["Dad", "Thriller novel", 2200, "Bookshop", "Idea", false, false, ""],
      ["Grandma", "Photo frame", 3500, "Department store", "Wrapped", true, false, "with the holiday photo"],
      ["Sam", "Building blocks", 4900, "Toy shop", "Bought", false, false, ""],
      ["Sam", "Puzzle book", 1500, "Bookshop", "Idea", false, false, ""],
      ["Priya", "Tea set", 3800, "Online", "Idea", false, false, ""],
      ["Leo", "Board game", 3500, "Toy shop", "Wrapped", false, false, ""],
      ["Amara", "Chocolates", 1800, "", "Idea", false, false, "for the office party"],
      ["Jack", "Football", 3000, "Sports shop", "Bought", false, false, ""],
      ["Jack", "Comic books", 2400, "Bookshop", "Idea", false, false, ""]
    ].map(function (r) {
      return { id: id++, personId: P[r[0]], idea: r[1], cents: r[2], where: r[3], status: r[4], card: r[5], thanks: r[6], note: r[7], sample: true };
    });
    d.meta.sample = true;
    d.meta.onboarded = true;
    d.meta.nextId = id;
    D = d;
    save();
    go("home");
    HH.toast("Sample data loaded. Clear it any time.", null, 4000);
  }
  function clearSample() {
    var theme = D.settings.theme, next = D.meta.nextId, groups = D.settings.groups;
    D = blank();
    D.settings.theme = theme; D.settings.groups = groups; D.meta.nextId = next;
    save();
    startWelcome();
  }

  // ── people ───────────────────────────────────────────────────────
  function openPerson(p, from) {
    editingPerson = p || null;
    giftReturn = from || "people";
    $("#person-title").textContent = p ? "Change " + p.name : "Add a person";
    $("#p-name").value = p ? p.name : "";
    $("#p-group").innerHTML = groupOptions(p ? p.group : D.settings.groups[0]);
    $("#p-budget").value = p && p.budgetCents != null ? HH.plain(p.budgetCents) : "";
    $("#p-err").hidden = true;
    $("#p-delete").hidden = !p;
    go("person-edit");
    $("#p-name").focus();
  }
  function savePerson(ev) {
    ev.preventDefault();
    var name = $("#p-name").value.trim().slice(0, 40), budget = moneyOrNull($("#p-budget").value);
    var err = !name ? "Type the person's name." : budget === undefined || (budget !== null && budget == null) ? "Type the budget as a number, or leave it blank." : "";
    if (!err && $("#p-budget").value.trim() !== "" && budget == null) err = "Type the budget as a number, or leave it blank.";
    if (err) { $("#p-err").textContent = err; $("#p-err").hidden = false; return; }
    if (editingPerson) {
      editingPerson.name = name; editingPerson.group = $("#p-group").value; editingPerson.budgetCents = budget;
      if (D.meta.sample) editingPerson.sample = false;
    } else {
      D.people.push({ id: newId(), name: name, group: $("#p-group").value, budgetCents: budget });
    }
    save();
    go(giftReturn === "welcome" ? "welcome" : "people");
    HH.toast((editingPerson ? "Changed " : "Added ") + name + ".", null, 3000);
    editingPerson = null;
  }
  function deletePerson() {
    var p = editingPerson, n = D.gifts.filter(function (g) { return g.personId === p.id; }).length;
    HH.confirmStep({
      title: "Delete " + p.name + "?", yes: "Next", no: "Keep",
      text: n ? "This also deletes " + plural(n, "gift", "gifts") + " for " + p.name + "." : p.name + " has no gifts yet.",
      onYes: function () {
        HH.confirmStep({
          title: "Delete " + p.name + (n ? " and " + plural(n, "gift", "gifts") : "") + " now?", yes: "Yes, delete", no: "Cancel", danger: true,
          text: "You can undo this for a few seconds after.",
          onYes: function () {
            var gone = D.gifts.filter(function (g) { return g.personId === p.id; }), i = D.people.indexOf(p);
            D.people.splice(i, 1);
            D.gifts = D.gifts.filter(function (g) { return g.personId !== p.id; });
            save();
            editingPerson = null;
            go("people");
            HH.toast("Deleted " + p.name + ".", function () {
              D.people.splice(Math.min(i, D.people.length), 0, p); D.gifts = D.gifts.concat(gone); save(); render();
            });
          }
        });
      }
    });
  }

  // ── gifts ────────────────────────────────────────────────────────
  function openGift(g, from, presetPerson) {
    editingGift = g || null;
    giftReturn = from || "gifts";
    $("#gift-title").textContent = g ? "Change gift" : "Add a gift";
    var cur = g ? g.personId : (presetPerson || (D.people[0] ? D.people[0].id : null));
    $("#g-person").innerHTML = D.people.map(function (p) {
      return '<option value="' + p.id + '"' + (p.id === cur ? " selected" : "") + ">" + esc(p.name) + "</option>";
    }).join("");
    $("#g-noone").hidden = D.people.length > 0;
    $("#g-idea").value = g ? g.idea : "";
    $("#g-price").value = g && g.cents != null ? HH.plain(g.cents) : "";
    $("#g-where").value = g ? g.where : "";
    $("#g-status").value = g ? g.status : "Idea";
    $("#g-card").checked = !!(g && g.card);
    $("#g-thanks").checked = !!(g && g.thanks);
    $("#g-note").value = g ? g.note : "";
    $("#g-err").hidden = true;
    $("#g-delete").hidden = !g;
    go("gift-edit");
    $("#g-idea").focus();
  }
  function saveGift(ev) {
    ev.preventDefault();
    var idea = $("#g-idea").value.trim().slice(0, 60), pid = +$("#g-person").value, priceTxt = $("#g-price").value.trim();
    var cents = priceTxt === "" ? null : HH.parseMoney(priceTxt);
    var err = !person(pid) ? "Add a person first on the People screen, then come back." : !idea ? "Type the gift." :
      (priceTxt !== "" && cents == null) ? "Type the price as a number, such as 25 or 25.50, or leave it blank." : "";
    if (err) { $("#g-err").textContent = err; $("#g-err").hidden = false; return; }
    var fields = { personId: pid, idea: idea, cents: cents, where: $("#g-where").value.trim().slice(0, 40), status: $("#g-status").value,
                   card: $("#g-card").checked, thanks: $("#g-thanks").checked, note: $("#g-note").value.trim().slice(0, 80) };
    var back = giftReturn === "shopping" ? "shopping" : giftReturn === "home" ? "home" : "gifts";
    if (editingGift) {
      var before = JSON.parse(JSON.stringify(editingGift)), target = editingGift;
      Object.keys(fields).forEach(function (k) { target[k] = fields[k]; });
      if (D.meta.sample) target.sample = false;
      save();
      go(back);
      HH.toast("Changed " + idea + ".", function () { Object.keys(fields).forEach(function (k) { target[k] = before[k]; }); save(); render(); });
    } else {
      var g = { id: newId() };
      Object.keys(fields).forEach(function (k) { g[k] = fields[k]; });
      D.gifts.push(g);
      save();
      go(back);
      var tt = totals(D.people, D.gifts, D.settings);
      HH.toast("Added " + idea + " · left to spend " + leftText(tt).num, function () {
        D.gifts = D.gifts.filter(function (x) { return x.id !== g.id; }); save(); render();
      });
    }
    editingGift = null;
  }
  function deleteGift() {
    var g = editingGift, i = D.gifts.indexOf(g);
    if (i < 0) return;
    D.gifts.splice(i, 1);
    save();
    editingGift = null;
    go("gifts");
    HH.toast("Deleted " + g.idea + ".", function () { D.gifts.splice(Math.min(i, D.gifts.length), 0, g); save(); render(); });
  }
  function markBought(id) {
    var g = D.gifts.filter(function (x) { return x.id === id; })[0];
    if (!g) return;
    g.status = "Bought";
    if (D.meta.sample) g.sample = false;
    save();
    render();
    HH.toast("Bought: " + g.idea + ".", function () { g.status = "Idea"; save(); render(); });
  }

  // ── settings ─────────────────────────────────────────────────────
  function saveSettings() {
    var s = D.settings, bTxt = $("#s-budget").value.trim(), budget = bTxt === "" ? null : HH.parseMoney(bTxt);
    var groups = $("#s-groups").value.split("\n").map(function (x) { return x.trim().slice(0, 20); }).filter(function (x) { return x; });
    var seen = {}; groups = groups.filter(function (g) { if (seen[g]) return false; seen[g] = true; return true; }).slice(0, 30);
    var err = (bTxt !== "" && budget == null) ? "Type the overall budget as a number, or leave it blank." : !groups.length ? "Keep at least one group." : "";
    if (err) { $("#s-err").textContent = err; $("#s-err").hidden = false; $("#s-saved").textContent = ""; return; }
    $("#s-err").hidden = true;
    s.currency = $("#s-cur").value.trim().slice(0, 4);
    s.budgetCents = budget; s.groups = groups;
    save();
    render();
    $("#s-saved").textContent = "Saved. Left to spend is now " + $("#h-left").textContent + ".";
  }
  function startNextYear() {
    var y = D.year;
    HH.confirmStep({
      title: "Start Christmas " + (y + 1) + "?", yes: "Next", no: "Not yet",
      text: "Your people, groups and budgets stay. This year's " + plural(D.gifts.length, "gift", "gifts") + " move to Past years, where you can still read them.",
      onYes: function () {
        HH.confirmStep({
          title: "Move " + y + " to Past years now?", yes: "Yes, start " + (y + 1), no: "Cancel",
          text: "You can still see " + y + " under Settings → Past years.",
          onYes: function () {
            D.archive.push({ year: y, people: JSON.parse(JSON.stringify(D.people)), gifts: JSON.parse(JSON.stringify(D.gifts)) });
            D.gifts = [];
            D.year = y + 1;
            D.people.forEach(function (p) { delete p.sample; });
            D.meta.sample = false;
            save();
            go("home");
            HH.toast("Christmas " + (y + 1) + " started. " + y + " is under Past years.", null, 5000);
          }
        });
      }
    });
  }

  // ── backup and restore ───────────────────────────────────────────
  function backup() {
    T = HH.today();
    D.meta.lastBackup = HH.iso(T);
    D.meta.reminderDismissed = null;
    save();
    var name = "hollowayhart-gifts-backup-" + HH.iso(T) + ".json";
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
      restoreMsg('<div class="banner" id="restore-summary"><strong>This backup has</strong>Christmas ' + r.data.year + ": " +
        plural(r.data.people.length, "person", "people") + " · " + plural(r.data.gifts.length, "gift", "gifts") +
        (r.data.archive.length ? " · " + plural(r.data.archive.length, "past year", "past years") : "") +
        (r.made != null ? " · made " + HH.fmtLong(r.made) : "") +
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
      title: "Start fresh?", yes: "Next", no: "Keep my list",
      text: "This deletes your people, gifts and past years from this browser. If you might want them again, cancel and use Back up now first.",
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
    $("#add-gift-btn").addEventListener("click", function () { openGift(null, "home"); });
    $("#gift-add").addEventListener("click", function () { openGift(null, "gifts", filterPerson ? +filterPerson : null); });
    $("#gift-form").addEventListener("submit", saveGift);
    $("#g-cancel").addEventListener("click", function () { go(giftReturn === "shopping" ? "shopping" : giftReturn === "home" ? "home" : "gifts"); });
    $("#g-delete").addEventListener("click", deleteGift);
    $("#person-add").addEventListener("click", function () { openPerson(null, "people"); });
    $("#person-form").addEventListener("submit", savePerson);
    $("#p-cancel").addEventListener("click", function () { go(giftReturn === "welcome" ? "welcome" : "people"); });
    $("#p-delete").addEventListener("click", deletePerson);
    $("#f-person").addEventListener("change", function () { filterPerson = $("#f-person").value; renderGifts(); });
    document.addEventListener("change", function (ev) {
      if (ev.target && ev.target.name === "fstatus") { filterStatus = ev.target.value; renderGifts(); }
    });
    document.addEventListener("click", function (ev) {
      var t = ev.target.closest ? ev.target.closest("[data-edit-gift],[data-edit-person],[data-bought],[data-clear-sample],[data-backup],[data-dismiss-backup]") : null;
      if (!t) return;
      if (t.hasAttribute("data-edit-gift")) {
        var id = +t.getAttribute("data-edit-gift");
        openGift(D.gifts.filter(function (g) { return g.id === id; })[0], "gifts");
      } else if (t.hasAttribute("data-edit-person")) {
        var pid = +t.getAttribute("data-edit-person");
        openPerson(person(pid), "people");
      } else if (t.hasAttribute("data-bought")) {
        markBought(+t.getAttribute("data-bought"));
      } else if (t.hasAttribute("data-clear-sample")) {
        clearSample();
      } else if (t.hasAttribute("data-backup")) {
        backup();
      } else if (t.hasAttribute("data-dismiss-backup")) {
        D.meta.reminderDismissed = HH.iso(T); save(); renderBanners();
      }
    });
    ["#s-cur", "#s-budget", "#s-groups"].forEach(function (id) { $(id).addEventListener("change", saveSettings); });
    $("#set-form").addEventListener("submit", function (ev) { ev.preventDefault(); saveSettings(); });
    $$('input[name="theme"]').forEach(function (r) {
      r.addEventListener("change", function () { D.settings.theme = r.value; save(); HH.applyTheme(r.value); });
    });
    $("#backup-btn").addEventListener("click", backup);
    $("#restore-file").addEventListener("change", onRestoreFile);
    $("#next-year-btn").addEventListener("click", startNextYear);
    $("#past-btn").addEventListener("click", function () { go("past"); });
    $("#past-back").addEventListener("click", function () { go("settings"); });
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
    $("#w-budget-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var txt = $("#w-budget").value.trim(), b = txt === "" ? null : HH.parseMoney(txt);
      if (txt !== "" && b == null) { $("#w-err").textContent = "Type the budget as a number, such as 500, or leave it blank."; $("#w-err").hidden = false; return; }
      $("#w-err").hidden = true;
      D.settings.budgetCents = b;
      save();
      welcomeStep(2);
    });
    $("#w-sample").addEventListener("click", loadSample);
    $("#w-person").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var name = $("#w-name").value.trim().slice(0, 40), bt = $("#w-pbudget").value.trim(), b = bt === "" ? null : HH.parseMoney(bt);
      var err = !name ? "Type the person's name." : (bt !== "" && b == null) ? "Type the budget as a number, or leave it blank." : "";
      if (err) { $("#w-perr").textContent = err; $("#w-perr").hidden = false; return; }
      $("#w-perr").hidden = true;
      D.people.push({ id: newId(), name: name, group: $("#w-group").value, budgetCents: b });
      save();
      welcomeStep(3);
    });
    $("#w-person-skip").addEventListener("click", function () { welcomeStep(3); });
    $("#w-finish").addEventListener("click", function () { D.meta.onboarded = true; save(); go("home"); });
    document.addEventListener("visibilitychange", function () { if (!document.hidden && D.meta.onboarded) render(); });
  }

  // ── start ────────────────────────────────────────────────────────
  function start() {
    var raw = store.read();
    if (raw) {
      var r = migrate(raw);
      if (r.data) D = r.data;
      else {
        try { window.localStorage.setItem("hh71_unreadable_" + HH.iso(HH.today()), JSON.stringify(raw)); } catch (e) { /* nothing more to do */ }
        D = blank();
      }
    } else {
      D = blank();
    }
    wire();
    if (D.meta.onboarded) go("home"); else startWelcome();
  }
  window.HH71 = { totals: totals, countdown: countdown, personStats: personStats };
  start();
})();
