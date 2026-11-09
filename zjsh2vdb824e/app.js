window.HH_BUILD = {"id": "68", "version": "09Nov2026.1", "hosted": true};
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

/* Product 68: ADHD Budget Planner App (specs/money/68-budget-planner-app.yaml), 7 Nov 2026.
   The method and the maths are 52's (specs/money/52-adhd-budget-planner.yaml, settings.calculated):
   Safe to Spend = pay this pay − bills due this pay − put aside − spent so far this pay; a day = Safe to Spend ÷ days to payday.
   Pay period: from the last payday on or before today to the day before the next one (weekly / fortnightly by days,
   monthly on the same day of the month, short months clamped). Bills repeat both ways from the date typed (02's occurrence
   maths; a One-off once). Money is integer cents; dates are day numbers from HH (apps/core.js). */
(function () {
  "use strict";
  var SCHEMA = 2;
  var APP_ID = "hollowayhart-adhd-budget";
  var PAY_FREQ = ["Weekly", "Fortnightly", "Monthly"];
  var BILL_FREQ = ["Weekly", "Fortnightly", "Monthly", "Quarterly", "Yearly", "One-off"];
  var CATS = ["Food", "Fun", "Transport", "Shopping", "Home", "Health", "Kids & Pets", "Other"];
  var STEP = { Weekly: 7, Fortnightly: 14 };
  var MONTHS = { Monthly: 1, Quarterly: 3, Yearly: 12 };
  var REMIND_DAYS = 30;
  var $ = HH.$, $$ = HH.$$, esc = HH.esc;
  var store = new HH.Store("hh68_");
  var D = null;          // the data
  var T = HH.today();    // today, refreshed on every render
  var editingSpend = null, editingBill = null, billReturn = "bills", pendingRestore = null;

  // ── data ──────────────────────────────────────────────────────────
  function blank() {
    return {
      schema: SCHEMA,
      settings: { currency: "$", payCents: null, payFreq: "Fortnightly", nextPayday: null, asideCents: 0, theme: "auto" },
      bills: [], spends: [],
      meta: { created: HH.iso(HH.today()), lastBackup: null, reminderDismissed: null, sample: false, onboarded: false, nextId: 1 }
    };
  }
  function isInt(x) { return typeof x === "number" && isFinite(x) && Math.floor(x) === x; }
  function isDate(s) { return HH.parseIso(s) != null; }
  function validate(d) {
    try {
      var s = d.settings, m = d.meta;
      if (d.schema !== SCHEMA || !s || !m || !Array.isArray(d.bills) || !Array.isArray(d.spends)) return false;
      if (typeof s.currency !== "string" || s.currency.length > 4) return false;
      if (!(s.payCents === null || (isInt(s.payCents) && s.payCents >= 0))) return false;
      if (PAY_FREQ.indexOf(s.payFreq) < 0) return false;
      if (!(s.nextPayday === null || isDate(s.nextPayday))) return false;
      if (!(isInt(s.asideCents) && s.asideCents >= 0)) return false;
      if (["auto", "light", "dark"].indexOf(s.theme) < 0) return false;
      if (!isDate(m.created) || !(m.lastBackup === null || isDate(m.lastBackup))) return false;
      if (!(m.reminderDismissed === null || isDate(m.reminderDismissed))) return false;
      if (typeof m.sample !== "boolean" || typeof m.onboarded !== "boolean" || !isInt(m.nextId)) return false;
      for (var i = 0; i < d.bills.length; i++) {
        var b = d.bills[i];
        if (!isInt(b.id) || typeof b.name !== "string" || !b.name || !isInt(b.cents) || b.cents <= 0) return false;
        if (BILL_FREQ.indexOf(b.freq) < 0 || !isDate(b.due) || typeof b.auto !== "boolean") return false;
      }
      for (var j = 0; j < d.spends.length; j++) {
        var x = d.spends[j];
        if (!isInt(x.id) || !isInt(x.cents) || x.cents <= 0 || !isDate(x.date) || typeof x.note !== "string") return false;
        if (typeof x.cat !== "string" || (x.cat && CATS.indexOf(x.cat) < 0)) return false;
      }
      return true;
    } catch (e) { return false; }
  }
  // version 1 was the first draft of this format (money in dollars, no ids); kept so a v1 backup still restores
  function from1(o) {
    var c = function (x) { return typeof x === "number" && isFinite(x) ? Math.round(x * 100) : NaN; };
    var s = o.settings || {}, out = blank(), id = 1;
    out.settings = {
      currency: typeof s.currency === "string" ? s.currency : "$",
      payCents: s.pay == null ? null : c(s.pay), payFreq: s.payFreq, nextPayday: s.nextPayday || null,
      asideCents: s.aside == null ? 0 : c(s.aside), theme: s.theme || "auto"
    };
    out.bills = (o.bills || []).map(function (b) {
      return { id: id++, name: b.name, cents: c(b.amount), freq: b.freq, due: b.due, auto: !!b.auto };
    });
    out.spends = (o.spends || []).map(function (x) {
      return { id: id++, cents: c(x.amount), date: x.date, note: x.note || "", cat: x.cat || "" };
    });
    var m = o.meta || {};
    out.meta = {
      created: m.created || out.meta.created, lastBackup: m.lastBackup || null, reminderDismissed: null,
      sample: !!m.sample, onboarded: m.onboarded !== false, nextId: id
    };
    return out;
  }
  function migrate(obj) {
    if (!obj || typeof obj !== "object") return { error: "broken" };
    var v = obj.schema;
    if (!isInt(v) || v < 1) return { error: "broken" };
    if (v > SCHEMA) return { error: "newer", version: v };
    var d = JSON.parse(JSON.stringify(obj));
    if (v === 1) d = from1(d);
    return validate(d) ? { data: d } : { error: "broken" };
  }
  function save() {
    if (!store.write(D)) renderBanners();
  }
  function newId() { return D.meta.nextId++; }
  function hasOwn() {
    return D.bills.some(function (b) { return !b.sample; }) || D.spends.some(function (x) { return !x.sample; });
  }

  // ── the maths (52's rules) ───────────────────────────────────────
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
  function occBefore(t, due, freq) {                // repeats strictly before day t, counted both ways from `due`
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
        var k = x.cat || "Not sorted";
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

  // ── rendering ────────────────────────────────────────────────────
  function render() {
    T = HH.today();
    HH.applyTheme(D.settings.theme);
    renderBanners();
    renderHome();
    renderBills();
    renderHistory();
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
  }
  function spendRow(x, showDate) {
    return '<li data-spend="' + x.id + '"><button type="button" class="rowbtn" data-edit-spend="' + x.id + '" aria-label="Change ' +
      esc((x.note || "spending") + " " + m(x.cents)) + '"><span class="what"><b>' + (x.note ? esc(x.note) : '<span class="muted">No note</span>') +
      "</b><br><span class=\"small muted\">" +
      (showDate ? HH.fmtDate(HH.parseIso(x.date), true) : HH.fmtDate(HH.parseIso(x.date))) + (x.cat ? " · " + esc(x.cat) : "") +
      (HH.parseIso(x.date) > T ? " · a future day: counts from then" : "") +
      '</span></span><span class="amt">' + m(x.cents) + '</span><span class="chev" aria-hidden="true">›</span></button></li>';
  }
  function byNewest(a, b) { return HH.parseIso(b.date) - HH.parseIso(a.date) || b.id - a.id; }
  function renderHistory() {
    var c = compute(T);
    if (!c) return;
    var p = c.p, mine = [], old = [];
    D.spends.forEach(function (x) {
      var d = HH.parseIso(x.date);
      if (d >= p.start) mine.push(x); else old.push(x);
    });
    mine.sort(byNewest); old.sort(byNewest);
    $("#hist-head").textContent = "This pay · " + HH.fmtShort(p.start) + " – " + HH.fmtShort(p.end);
    $("#hist-list").innerHTML = mine.map(function (x) { return spendRow(x, false); }).join("");
    $("#hist-none").hidden = mine.length > 0;
    var keys = Object.keys(c.cats).sort(function (a, b) { return c.cats[b] - c.cats[a] || (a < b ? -1 : 1); });
    var top = keys.length ? c.cats[keys[0]] : 0;
    $("#cat-bars").innerHTML = keys.length ? keys.map(function (k) {
      var pct = top ? Math.round(c.cats[k] / top * 100) : 0;
      return '<div class="stat" style="display:block"><div style="display:flex;justify-content:space-between;gap:10px">' +
        "<span>" + esc(k) + "</span><b>" + m(c.cats[k]) + '</b></div><div class="bar" aria-hidden="true"><i style="width:' +
        pct + '%"></i></div></div>';
    }).join("") + '<p class="small muted" style="margin-top:8px">Adds up to ' + m(c.spent) + ", everything spent this pay.</p>"
      : '<p class="muted small">Nothing logged this pay yet.</p>';
    $("#hist-earlier").hidden = old.length === 0;
    $("#hist-earlier-sum").textContent = "Earlier spending (" + old.length + ")";
    $("#hist-old").innerHTML = old.slice(0, 400).map(function (x) { return spendRow(x, true); }).join("");
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
  function renderBills() {
    var rows = billRows(T);
    $("#bill-list").innerHTML = rows.map(function (r) { return billItem(r, T); }).join("");
    $("#bill-none").hidden = rows.length > 0;
    $("#w-bill-list").innerHTML = $("#bill-list").innerHTML;
    $("#w-bill-none").hidden = rows.length > 0;
  }
  function renderSettings() {
    var s = D.settings;
    $("#s-cur").value = s.currency;
    $("#s-pay").value = s.payCents == null ? "" : HH.plain(s.payCents);
    $("#s-freq").value = s.payFreq;
    $("#s-payday").value = s.nextPayday || "";
    $("#s-aside").value = HH.plain(s.asideCents);
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
    [1, 2, 3].forEach(function (i) {
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
  function payErrors(payTxt, payday, asideTxt) {
    if (HH.parseMoney(payTxt) == null || HH.parseMoney(payTxt) === 0) return "Type your take-home pay as a number, such as 2400 or 2400.50.";
    if (!HH.parseIso(payday)) return "Pick your next payday (any payday will do).";
    if (HH.parseMoney(asideTxt === "" ? "0" : asideTxt) == null) return "Type the amount to put aside as a number. 0 is fine.";
    return "";
  }

  // ── sample data (moves with today, like the spreadsheets' sample) ──
  function loadSample() {
    var t = HH.today(), id = 1;
    var d = blank();
    d.settings = { currency: "$", payCents: 240000, payFreq: "Fortnightly", nextPayday: HH.iso(t + 5), asideCents: 15000, theme: D ? D.settings.theme : "auto" };
    d.bills = [
      ["Rent", 90000, "Fortnightly", 3, true], ["Phone", 6000, "Monthly", -4, true], ["Gym", 2500, "Fortnightly", -2, true],
      ["Internet", 7500, "Monthly", 18, true], ["Car insurance", 11200, "Monthly", 11, true], ["Streaming", 1699, "Monthly", 22, true],
      ["Electricity", 31000, "Quarterly", 40, false], ["Car rego", 82000, "Yearly", 60, false], ["Dentist", 18000, "One-off", 25, false]
    ].map(function (r) { return { id: id++, name: r[0], cents: r[1], freq: r[2], due: HH.iso(t + r[3]), auto: r[4], sample: true }; });
    d.spends = [
      [-1, 1840, "Groceries", "Food"], [-2, 650, "Coffee", "Food"], [-3, 4500, "Fuel", "Transport"], [-4, 3200, "Dinner out", "Fun"],
      [-6, 7420, "Groceries", "Food"], [-7, 1200, "", ""], [-8, 2995, "Phone case", "Shopping"], [-9, 2300, "Pharmacy", "Health"],
      [-11, 6890, "Groceries", "Food"], [-12, 1500, "Parking", "Transport"], [-13, 4200, "Birthday gift", "Shopping"],
      [-15, 900, "Coffee", "Food"], [-16, 5600, "Fuel", "Transport"], [-18, 8130, "Groceries", "Food"], [-19, 2400, "Movie", "Fun"],
      [-21, 3500, "Pet food", "Kids & Pets"], [-22, 1350, "Lunch", "Food"], [-24, 6620, "Groceries", "Food"], [-26, 4800, "Fuel", "Transport"],
      [-27, 1999, "Hardware store", "Home"], [-29, 900, "", ""], [-31, 7310, "Groceries", "Food"], [-33, 2650, "Haircut", "Health"],
      [-35, 1800, "Takeaway", "Fun"], [-37, 5200, "Fuel", "Transport"], [-38, 6980, "Groceries", "Food"], [-40, 1150, "Lunch", "Food"]
    ].map(function (r) { return { id: id++, cents: r[1], date: HH.iso(t + r[0]), note: r[2], cat: r[3], sample: true }; });
    d.meta.sample = true;
    d.meta.onboarded = true;
    d.meta.nextId = id;
    D = d;
    save();
    go("home");
    HH.toast("Sample data loaded. Clear it any time.", null, 4000);
  }
  function clearSample() {
    var keepBills = D.bills.filter(function (b) { return !b.sample; }), keepSpends = D.spends.filter(function (x) { return !x.sample; });
    var theme = D.settings.theme, next = D.meta.nextId;
    D = blank();
    D.settings.theme = theme;
    D.bills = keepBills;
    D.spends = keepSpends;
    D.meta.nextId = next;
    save();
    startWelcome();
  }

  // ── spending ─────────────────────────────────────────────────────
  function openAdd(spend) {
    editingSpend = spend || null;
    $("#add-title").textContent = spend ? "Change spending" : "Add spending";
    $("#add-amount").value = spend ? HH.plain(spend.cents) : "";
    $("#add-note").value = spend ? spend.note : "";
    $$('#add-cats input').forEach(function (i) { i.checked = !!spend && i.value === spend.cat; });
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
    var cat = ($$('#add-cats input').filter(function (i) { return i.checked; })[0] || {}).value || "";
    var note = $("#add-note").value.trim().slice(0, 60);
    if (editingSpend) {
      var before = JSON.parse(JSON.stringify(editingSpend));
      editingSpend.cents = cents; editingSpend.date = HH.iso(day); editingSpend.note = note; editingSpend.cat = cat;
      var target = editingSpend;
      save();
      go("history");
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
    go("history");
    HH.toast("Deleted " + m(x.cents), function () { D.spends.splice(i, 0, x); save(); render(); });
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
    renderBanners(); renderHome(); renderBills(); renderHistory();
    $("#s-saved").textContent = "Saved. Safe to Spend is now " + $("#safe-amount").textContent + ".";
  }

  // ── backup and restore ───────────────────────────────────────────
  function backup() {
    T = HH.today();
    D.meta.lastBackup = HH.iso(T);
    D.meta.reminderDismissed = null;
    save();
    var name = "hollowayhart-budget-backup-" + HH.iso(T) + ".json";
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
      var ds = r.data.spends.map(function (x) { return HH.parseIso(x.date); });
      var range = ds.length ? "from " + HH.fmtLong(Math.min.apply(null, ds)) + " to " + HH.fmtLong(Math.max.apply(null, ds)) : "none";
      restoreMsg('<div class="banner" id="restore-summary"><strong>This backup has</strong>' +
        plural(r.data.bills.length, "bill", "bills") + " · " + plural(r.data.spends.length, "spending entry", "spending entries") +
        (ds.length ? " " + range : "") + (r.made != null ? " · made " + HH.fmtLong(r.made) : "") +
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
      text: "This deletes your pay, bills and spending from this browser. If you might want them again, cancel and use Back up now first.",
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
    $("#add-cats").innerHTML = CATS.map(function (c, i) {
      return '<label class="chip"><input type="checkbox" value="' + esc(c) + '" id="cat-' + i + '"><span>' + esc(c) + "</span></label>";
    }).join("");
    $$("#add-cats input").forEach(function (i) {
      i.addEventListener("change", function () {
        if (i.checked) $$("#add-cats input").forEach(function (o) { if (o !== i) o.checked = false; });
      });
    });
    $$("[data-nav]").forEach(function (b) {
      b.addEventListener("click", function () { go(b.getAttribute("data-nav")); });
    });
    $("#add-btn").addEventListener("click", function () { openAdd(null); });
    $("#add-form").addEventListener("submit", saveSpend);
    $("#add-cancel").addEventListener("click", function () { go(editingSpend ? "history" : "home"); });
    $("#add-delete").addEventListener("click", deleteSpend);
    $("#add-day-change").addEventListener("click", function () { $("#add-day-wrap").hidden = false; $("#add-date").focus(); });
    $("#add-date").addEventListener("change", function () {
      var d = HH.parseIso($("#add-date").value);
      $("#add-day-text").textContent = d == null ? "?" : d === T ? "Today" : HH.fmtDate(d, true);
    });
    $("#bill-add").addEventListener("click", function () { openBill(null, "bills"); });
    $("#bill-form").addEventListener("submit", saveBill);
    $("#b-cancel").addEventListener("click", closeBill);
    $("#b-delete").addEventListener("click", deleteBill);
    document.addEventListener("click", function (ev) {
      var t = ev.target.closest ? ev.target.closest("[data-edit-spend],[data-edit-bill],[data-clear-sample],[data-backup],[data-dismiss-backup]") : null;
      if (!t) return;
      if (t.hasAttribute("data-edit-spend")) {
        var id = +t.getAttribute("data-edit-spend");
        openAdd(D.spends.filter(function (x) { return x.id === id; })[0]);
      } else if (t.hasAttribute("data-edit-bill")) {
        var bid = +t.getAttribute("data-edit-bill");
        openBill(D.bills.filter(function (b) { return b.id === bid; })[0], $("#tabs").hidden ? "welcome" : "bills");
      } else if (t.hasAttribute("data-clear-sample")) {
        clearSample();
      } else if (t.hasAttribute("data-backup")) {
        backup();
      } else if (t.hasAttribute("data-dismiss-backup")) {
        D.meta.reminderDismissed = HH.iso(T); save(); renderBanners();
      }
    });
    ["#s-cur", "#s-pay", "#s-freq", "#s-payday", "#s-aside"].forEach(function (id) { $(id).addEventListener("change", saveSettings); });
    $("#set-form").addEventListener("submit", function (ev) { ev.preventDefault(); saveSettings(); });
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
    $("#w-finish").addEventListener("click", function () { D.meta.onboarded = true; save(); go("home"); });
    // a long-open tab crosses midnight: redraw with the new today when the app comes back into view
    document.addEventListener("visibilitychange", function () { if (!document.hidden && D.meta.onboarded) render(); });
  }

  // ── start ────────────────────────────────────────────────────────
  function start() {
    var raw = store.read();
    if (raw) {
      var r = migrate(raw);
      if (r.data) D = r.data;
      else {
        // never lose data silently: keep the unreadable copy under its own key and start clean
        try { window.localStorage.setItem("hh68_unreadable_" + HH.iso(HH.today()), JSON.stringify(raw)); } catch (e) { /* nothing more to do */ }
        D = blank();
      }
      if (r.data && raw.schema !== SCHEMA) save();
    } else D = blank();
    wire();
    if (D.meta.onboarded && HH.parseIso(D.settings.nextPayday) != null) go("home"); else startWelcome();
  }

  // for the QA runner (qa/app_qa.py): the same maths the screens use
  window.HH68 = { period: period, occBefore: occBefore, occAt: occAt, compute: compute, migrate: migrate, SCHEMA: SCHEMA, APP_ID: APP_ID,
    data: function () { return D; } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
