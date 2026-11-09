window.HH_BUILD = {"id": "73", "version": "09Nov2026.1", "hosted": true};
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

/* Product 73: ADHD Life Planner App (specs/life/73-adhd-life-planner-app.yaml), 8 Nov 2026.
   Today's three things, an Also-today list, a brain dump with a Later list, routines, habits with streaks, a focus timer
   that keeps time from its start timestamp, and a dopamine menu. Dates are day numbers from HH (apps/core.js); the day
   changes with the device's calendar date, and unfinished items roll into the new day marked 'from yesterday'. */
(function () {
  "use strict";
  var SCHEMA = 1;
  var APP_ID = "hollowayhart-life-planner";
  var MENU_KEYS = ["quick", "medium", "big", "rewards"];
  var MENU_NAMES = { quick: "Quick (5 minutes)", medium: "Medium (20 minutes)", big: "Big (an hour or more)", rewards: "Rewards" };
  var MENU_SAMPLE = {
    quick: ["Step outside for fresh air", "Stretch for five minutes", "Make a cup of tea", "Text a friend"],
    medium: ["Walk around the block", "Tidy one surface", "Play one favourite album", "Water the plants"],
    big: ["Cook something new", "A long walk somewhere green", "Visit a library or bookshop", "Start a puzzle"],
    rewards: ["A favourite snack", "An episode of something good", "A long bath", "Half an hour of a game"]
  };
  var MOODS = ["Rough", "Low", "Okay", "Good", "Great"];
  var MOOD_FACES = ["☹", "😕", "😐", "🙂", "😄"];
  var DAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var REMIND_DAYS = 30;
  var $ = HH.$, $$ = HH.$$, esc = HH.esc;
  var store = new HH.Store("hh73_");
  var D = null;
  var T = HH.today();
  var editingRoutine = null, editingHabit = null, editingMenu = null, pendingRestore = null, yearHabit = null;
  var focusTick = null, soundsPlayed = 0, dumpReturn = "dump";

  // ── data ──────────────────────────────────────────────────────────
  function blank() {
    return {
      schema: SCHEMA,
      settings: { theme: "auto", weekStart: "Mon", sound: false, focusWork: 25, focusBreak: 5 },
      days: {}, habits: [], routines: [], dump: [], menu: sampleMenu(),
      focus: { sessions: {}, run: null },
      meta: { created: HH.iso(HH.today()), lastBackup: null, reminderDismissed: null, sample: false, onboarded: false, nextId: 1,
              lastOpen: HH.iso(HH.today()) }
    };
  }
  function sampleMenu() {
    var m = {};
    MENU_KEYS.forEach(function (k) { m[k] = MENU_SAMPLE[k].map(function (t) { return { text: t, sample: true }; }); });
    return m;
  }
  function isInt(x) { return typeof x === "number" && isFinite(x) && Math.floor(x) === x; }
  function isDate(s) { return HH.parseIso(s) != null; }
  function isText(s, n) { return typeof s === "string" && s.length > 0 && s.length <= n; }
  function validItem(x) {
    return isInt(x.id) && isText(x.text, 120) && typeof x.done === "boolean" && (x.from === null || isDate(x.from));
  }
  function validate(d) {
    try {
      var s = d.settings, m = d.meta, k, i, x;
      if (d.schema !== SCHEMA || !s || !m || !d.days || typeof d.days !== "object" || !d.focus || !d.menu) return false;
      if (["auto", "light", "dark"].indexOf(s.theme) < 0 || ["Mon", "Sun"].indexOf(s.weekStart) < 0 || typeof s.sound !== "boolean") return false;
      if (!isInt(s.focusWork) || s.focusWork < 1 || s.focusWork > 180 || !isInt(s.focusBreak) || s.focusBreak < 1 || s.focusBreak > 60) return false;
      for (k in d.days) {
        if (!isDate(k)) return false;
        var day = d.days[k];
        if (!Array.isArray(day.top) || !Array.isArray(day.also) || day.top.length > 3) return false;
        if (!day.top.every(validItem) || !day.also.every(validItem)) return false;
        if (!(day.mood === null || (isInt(day.mood) && day.mood >= 1 && day.mood <= 5))) return false;
        if (!day.routineTicks || typeof day.routineTicks !== "object") return false;
      }
      if (!Array.isArray(d.habits) || !Array.isArray(d.routines) || !Array.isArray(d.dump)) return false;
      for (i = 0; i < d.habits.length; i++) {
        x = d.habits[i];
        if (!isInt(x.id) || !isText(x.name, 40) || !isInt(x.target) || x.target < 1 || x.target > 7 || !Array.isArray(x.ticks)) return false;
        if (!x.ticks.every(isDate)) return false;
      }
      for (i = 0; i < d.routines.length; i++) {
        x = d.routines[i];
        if (!isInt(x.id) || !isText(x.name, 40) || !Array.isArray(x.steps) || !x.steps.length || !Array.isArray(x.days)) return false;
        if (!x.steps.every(function (t) { return isText(t, 80); }) || !x.days.every(function (w) { return isInt(w) && w >= 0 && w <= 6; })) return false;
      }
      for (i = 0; i < d.dump.length; i++) {
        x = d.dump[i];
        if (!isInt(x.id) || !isText(x.text, 200) || !isDate(x.created)) return false;
        if (!(x.when === null || x.when === "someday" || isDate(x.when))) return false;
      }
      for (i = 0; i < MENU_KEYS.length; i++) {
        var list = d.menu[MENU_KEYS[i]];
        if (!Array.isArray(list) || !list.every(function (it) { return isText(it.text, 80) && typeof it.sample === "boolean"; })) return false;
      }
      if (!d.focus.sessions || typeof d.focus.sessions !== "object") return false;
      if (!(d.focus.run === null || (typeof d.focus.run === "object" && isInt(d.focus.run.start)))) return false;
      if (!isDate(m.created) || !(m.lastBackup === null || isDate(m.lastBackup)) || !(m.reminderDismissed === null || isDate(m.reminderDismissed))) return false;
      if (typeof m.sample !== "boolean" || typeof m.onboarded !== "boolean" || !isInt(m.nextId) || !isDate(m.lastOpen)) return false;
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
  function hasOwn() {
    var any = D.habits.some(function (h) { return !h.sample; }) || D.routines.some(function (r) { return !r.sample; }) ||
      D.dump.some(function (x) { return !x.sample; }) || MENU_KEYS.some(function (k) { return D.menu[k].some(function (it) { return !it.sample; }); });
    for (var k in D.days) if (D.days[k].top.some(function (x) { return !x.sample; }) || D.days[k].also.some(function (x) { return !x.sample; })) any = true;
    return any;
  }
  function day(n) {
    var k = HH.iso(n);
    if (!D.days[k]) D.days[k] = { top: [], also: [], routineTicks: {}, mood: null };
    return D.days[k];
  }
  function byId(list, id) { return list.filter(function (x) { return x.id === id; })[0]; }

  // ── the day change: unfinished things come along, done things stay in their day ──
  function rollover(t) {
    var last = HH.parseIso(D.meta.lastOpen);
    if (last == null || last >= t) { D.meta.lastOpen = HH.iso(t); return; }
    var today = day(t);
    var keys = Object.keys(D.days).filter(function (k) { return HH.parseIso(k) < t; }).sort();
    keys.forEach(function (k) {
      var d = D.days[k], carryTop = [], carryAlso = [];
      d.top = d.top.filter(function (x) { if (x.done) return true; carryTop.push(x); return false; });
      d.also = d.also.filter(function (x) { if (x.done) return true; carryAlso.push(x); return false; });
      carryTop.forEach(function (x) {
        x.from = x.from || k;
        if (today.top.length < 3) today.top.push(x); else today.also.push(x);
      });
      carryAlso.forEach(function (x) { x.from = x.from || k; today.also.push(x); });
    });
    // Later items whose day has come
    D.dump.forEach(function (x) {
      var w = HH.parseIso(x.when);
      if (w != null && w <= t && !x.moved) {
        today.also.push({ id: newId(), text: x.text, done: false, from: "later", sample: !!x.sample });
        x.moved = true;
      }
    });
    D.dump = D.dump.filter(function (x) { return !x.moved; });
    D.meta.lastOpen = HH.iso(t);
    save();
  }

  // ── habits ───────────────────────────────────────────────────────
  function ticked(h, n) { return h.ticks.indexOf(HH.iso(n)) >= 0; }
  function streak(h, t) {
    var start = ticked(h, t) ? t : t - 1, n = 0, d = start;
    while (ticked(h, d)) { n++; d--; }
    return n;
  }
  function weekStartDay(t) {
    var ws = D.settings.weekStart === "Sun" ? 0 : 1;
    return t - HH.mod(HH.weekday(t) - ws, 7);
  }
  function weekTicks(h, t) {
    var s = weekStartDay(t), out = [];
    for (var i = 0; i < 7; i++) out.push(ticked(h, s + i));
    return out;
  }

  // ── routines ─────────────────────────────────────────────────────
  function routinesFor(n) {
    var wd = HH.weekday(n);
    return D.routines.filter(function (r) { return r.days.indexOf(wd) >= 0; });
  }
  function routineDone(r, n) {
    var tk = day(n).routineTicks[r.id] || [];
    return tk.filter(function (i) { return i < r.steps.length; }).length;
  }

  // ── the focus timer: time from the start stamp, never a ticking counter ──
  function focusState(now) {
    var r = D.focus.run;
    if (!r) return null;
    var workMs = r.work * 60000, breakMs = r.brk * 60000;
    var elapsed = (r.pausedAt != null ? r.pausedAt : now) - r.start - r.pausedTotal;
    if (elapsed < workMs) return { phase: "work", left: workMs - elapsed, paused: r.pausedAt != null };
    if (!r.counted) { r.counted = true; var k = HH.iso(HH.today()); D.focus.sessions[k] = (D.focus.sessions[k] || 0) + 1; r.breakStart = r.start + r.pausedTotal + workMs; save(); if (D.settings.sound) beep(); }
    if (elapsed < workMs + breakMs) return { phase: "break", left: workMs + breakMs - elapsed, paused: r.pausedAt != null };
    return { phase: "done", left: 0, paused: false };
  }
  function beep() {
    soundsPlayed++;
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      var ctx = new Ctx(), o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 660; g.gain.value = 0.08;
      o.connect(g); g.connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + 0.25);
    } catch (e) { /* no sound device: nothing more to do */ }
  }
  function mmss(ms) {
    var s = Math.ceil(ms / 1000), m = Math.floor(s / 60);
    return m + ":" + (s % 60 < 10 ? "0" : "") + (s % 60);
  }

  // ── wording helpers ──────────────────────────────────────────────
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
  function fromText(x) {
    if (!x.from) return "";
    if (x.from === "later") return "from your Later list";
    var f = HH.parseIso(x.from);
    return f === T - 1 ? "from yesterday" : "from " + HH.fmtDate(f);
  }

  // ── rendering ────────────────────────────────────────────────────
  function render() {
    T = HH.today();
    rollover(T);
    HH.applyTheme(D.settings.theme);
    renderBanners();
    renderToday();
    renderDump();
    renderRoutines();
    renderHabits();
    renderFocus();
    renderMenu();
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
  function itemRow(x, where) {
    var from = fromText(x);
    return '<li class="plain" data-item="' + x.id + '"><label class="tick"><input type="checkbox" data-tick="' + where + ":" + x.id + '"' + (x.done ? " checked" : "") +
      '><span class="what' + (x.done ? " done" : "") + '">' + esc(x.text) + (from ? ' <span class="small muted">· ' + from + "</span>" : "") +
      '</span></label><button type="button" class="btn-link small" data-remove="' + where + ":" + x.id + '" aria-label="Remove ' + esc(x.text) + '">Remove</button></li>';
  }
  function renderToday() {
    var d = day(T);
    $("#today-date").textContent = HH.fmtDate(T, true);
    var h = "";
    for (var i = 0; i < 3; i++) {
      var x = d.top[i];
      h += x ? itemRow(x, "top") : '<li class="plain empty"><form class="inline" data-add="top"><input type="text" maxlength="120" placeholder="' +
        (i === 0 ? "The one thing that matters most" : "Another thing for today") + '" aria-label="Top 3 slot ' + (i + 1) + '"><button class="btn btn-quiet" type="submit">Add</button></form></li>';
    }
    $("#top3").innerHTML = h;
    $("#also-list").innerHTML = d.also.map(function (x) { return itemRow(x, "also"); }).join("");
    $("#also-none").hidden = d.also.length > 0;
    var rs = routinesFor(T);
    $("#today-routines").innerHTML = rs.map(function (r) {
      var done = routineDone(r, T);
      return '<li class="plain"><button type="button" class="rowbtn" data-open-routine="' + r.id + '"><span class="what"><b>' + esc(r.name) +
        '</b><br><span class="small muted">done ' + done + " of " + r.steps.length + '</span></span><span class="chev" aria-hidden="true">›</span></button></li>';
    }).join("");
    $("#today-routines-none").hidden = rs.length > 0;
    $("#today-habits").innerHTML = D.habits.map(function (hb) {
      var on = ticked(hb, T);
      return '<button type="button" class="habit' + (on ? " on" : "") + '" data-habit-tick="' + hb.id + ":0" + '" aria-pressed="' + on + '">' +
        '<span class="hname">' + esc(hb.name) + '</span><span class="small">' + (on ? "done today" : "tap when done") + " · streak " + streak(hb, T) + "</span></button>";
    }).join("");
    $("#today-habits-none").hidden = D.habits.length > 0;
    $$("#mood input").forEach(function (r) { r.checked = d.mood === +r.value; });
    var n = d.top.filter(function (x) { return x.done; }).length + d.also.filter(function (x) { return x.done; }).length;
    $("#today-done").textContent = n ? plural(n, "thing", "things") + " done today" : "";
  }
  function renderDump() {
    var inbox = D.dump.filter(function (x) { return x.when === null; });
    $("#dump-list").innerHTML = inbox.map(function (x) {
      return '<li class="plain" data-dump="' + x.id + '"><span class="what">' + esc(x.text) + '</span><span class="row-buttons mini">' +
        '<button type="button" class="btn btn-quiet" data-dump-today="' + x.id + '">Today</button>' +
        '<button type="button" class="btn btn-quiet" data-dump-date="' + x.id + '">A date</button>' +
        '<button type="button" class="btn btn-quiet" data-dump-someday="' + x.id + '">Someday</button>' +
        '<button type="button" class="btn-link small" data-dump-remove="' + x.id + '">Remove</button></span></li>';
    }).join("");
    $("#dump-none").hidden = inbox.length > 0;
    var later = D.dump.filter(function (x) { return x.when !== null; });
    var groups = {};
    later.forEach(function (x) { (groups[x.when] = groups[x.when] || []).push(x); });
    var keys = Object.keys(groups).filter(function (k) { return k !== "someday"; }).sort();
    if (groups.someday) keys.push("someday");
    $("#later-list").innerHTML = keys.map(function (k) {
      return '<li class="plain group" data-later-group="' + k + '"><b>' + (k === "someday" ? "Someday" : HH.fmtDate(HH.parseIso(k), true)) + "</b><ul class=\"list\">" +
        groups[k].map(function (x) {
          return '<li class="plain"><span class="what">' + esc(x.text) + '</span><span class="row-buttons mini">' +
            '<button type="button" class="btn btn-quiet" data-dump-today="' + x.id + '">Today</button>' +
            '<button type="button" class="btn btn-quiet" data-dump-date="' + x.id + '">A date</button>' +
            '<button type="button" class="btn-link small" data-dump-remove="' + x.id + '">Remove</button></span></li>';
        }).join("") + "</ul></li>";
    }).join("");
    $("#later-none").hidden = later.length > 0;
  }
  function renderRoutines() {
    $("#routine-list").innerHTML = D.routines.map(function (r) {
      var days = r.days.length === 7 ? "every day" : r.days.map(function (w) { return DAY_ABBR[w]; }).join(" ");
      var today = r.days.indexOf(HH.weekday(T)) >= 0;
      return '<li class="plain" data-routine="' + r.id + '"><button type="button" class="rowbtn" data-open-routine="' + r.id + '"><span class="what"><b>' + esc(r.name) +
        '</b><br><span class="small muted">' + plural(r.steps.length, "step", "steps") + " · " + days + (today ? " · today: done " + routineDone(r, T) + " of " + r.steps.length : "") +
        '</span></span><span class="chev" aria-hidden="true">›</span></button></li>';
    }).join("");
    $("#routine-none").hidden = D.routines.length > 0;
  }
  function dots(flags) {
    return '<span class="dots" aria-hidden="true">' + flags.map(function (f) { return '<i class="' + (f ? "on" : "") + '"></i>'; }).join("") + "</span>";
  }
  function renderHabits() {
    $("#habit-list").innerHTML = D.habits.map(function (h) {
      var wk = weekTicks(h, T), n = wk.filter(Boolean).length, st = streak(h, T);
      return '<li class="plain" data-habit="' + h.id + '"><div class="goal"><div class="goal-top"><button type="button" class="rowbtn" data-edit-habit="' + h.id +
        '"><span class="what"><b>' + esc(h.name) + '</b><br><span class="small muted habit-line">this week ' + n + " of 7 days · aiming for " + h.target +
        " a week · streak " + plural(st, "day", "days") + "</span><br>" + dots(wk) + '</span><span class="chev" aria-hidden="true">›</span></button></div>' +
        '<div class="row-buttons"><button type="button" class="btn ' + (ticked(h, T) ? "btn-primary" : "btn-quiet") + '" data-habit-tick="' + h.id + ':0">' +
        (ticked(h, T) ? "✓ Today" : "Tick today") + '</button><button type="button" class="btn ' + (ticked(h, T - 1) ? "btn-primary" : "btn-quiet") +
        '" data-habit-tick="' + h.id + ':1">' + (ticked(h, T - 1) ? "✓ Yesterday" : "Tick yesterday") +
        '</button><button type="button" class="btn btn-quiet" data-habit-year="' + h.id + '">Year</button></div></div></li>';
    }).join("");
    $("#habit-none").hidden = D.habits.length > 0;
  }
  function renderYear(h) {
    var a = HH.ymd(T), first = HH.dn(a.y, 1, 1), last = HH.dn(a.y, 12, 31);
    var ws = D.settings.weekStart === "Sun" ? 0 : 1, lead = HH.mod(HH.weekday(first) - ws, 7);
    var cols = Math.ceil((lead + (last - first + 1)) / 7), html = "";
    for (var row = 0; row < 7; row++) {
      html += '<div class="yrow">';
      for (var c = 0; c < cols; c++) {
        var d = first - lead + c * 7 + row, cls = "";
        if (d >= first && d <= last) cls = ticked(h, d) ? "on" : (d > T ? "future" : "");
        else cls = "none";
        html += '<i class="' + cls + '"></i>';
      }
      html += "</div>";
    }
    $("#year-title").textContent = h.name + " · " + a.y;
    $("#year-grid").innerHTML = html;
    var n = h.ticks.filter(function (k) { var d = HH.parseIso(k); return d >= first && d <= last; }).length;
    $("#year-note").textContent = plural(n, "day", "days") + " ticked this year · each dot is a day, left to right by week";
  }
  function renderFocus() {
    var s = D.settings;
    $("#f-work").value = s.focusWork;
    $("#f-break").value = s.focusBreak;
    $("#f-sound").checked = s.sound;
    var d = day(T), tasks = d.top.concat(d.also).filter(function (x) { return !x.done; });
    var cur = D.focus.run ? D.focus.run.taskId : null;
    $("#f-task").innerHTML = '<option value="">No task picked</option>' + tasks.map(function (x) {
      return '<option value="' + x.id + '"' + (x.id === cur ? " selected" : "") + ">" + esc(x.text) + "</option>";
    }).join("");
    $("#f-sessions").textContent = plural(D.focus.sessions[HH.iso(T)] || 0, "session", "sessions") + " finished today";
    tickFocus();
  }
  function tickFocus() {
    var st = focusState(Date.now());
    var running = !!D.focus.run;
    $("#f-start").hidden = running && !(st && st.paused);
    $("#f-pause").hidden = !running || (st && (st.paused || st.phase === "done"));
    $("#f-reset").hidden = !running;
    $("#f-start").textContent = running ? "Continue" : "Start";
    if (!st) { $("#f-time").textContent = mmss(D.settings.focusWork * 60000); $("#f-phase").textContent = "Ready when you are"; return; }
    $("#f-time").textContent = mmss(st.left);
    $("#f-phase").textContent = st.phase === "work" ? (st.paused ? "Paused" : "Focus") : st.phase === "break" ? (st.paused ? "Break, paused" : "Break") : "Done. Nice work.";
    if (st.phase === "done") { D.focus.run = null; save(); clearInterval(focusTick); focusTick = null; $("#f-start").hidden = false; $("#f-pause").hidden = true; $("#f-reset").hidden = true; $("#f-start").textContent = "Start"; }
    $("#f-sessions").textContent = plural(D.focus.sessions[HH.iso(T)] || 0, "session", "sessions") + " finished today";
  }
  function renderMenu() {
    MENU_KEYS.forEach(function (k) {
      $("#menu-" + k).innerHTML = D.menu[k].map(function (it, i) {
        return '<li class="plain"><span class="what">' + esc(it.text) + (it.sample ? ' <span class="tag">SAMPLE</span>' : "") +
          '</span><button type="button" class="btn-link small" data-menu-edit="' + k + ":" + i + '">Change</button></li>';
      }).join("");
    });
    $("#pick-result").hidden = true;
  }
  function renderSettings() {
    var s = D.settings;
    $$('input[name="theme"]').forEach(function (r) { r.checked = r.value === s.theme; });
    $$('input[name="weekstart"]').forEach(function (r) { r.checked = r.value === s.weekStart; });
    $("#last-backup").textContent = D.meta.lastBackup ? "Last backup: " + HH.fmtLong(HH.parseIso(D.meta.lastBackup)) : "No backup made yet.";
    $("#sample-state").textContent = D.meta.sample ? "Sample entries are on: everything in the app is made up." :
      "Sample entries are off. You can load made-up entries to look around while the app is empty.";
    $("#sample-btn").textContent = D.meta.sample ? "Clear the sample entries" : "Load sample entries";
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
    var h1 = $("#welcome-" + k + " h1");
    if (h1) { h1.setAttribute("tabindex", "-1"); h1.focus(); }
  }
  function startWelcome() {
    go("welcome");
    ["#w-top1", "#w-top2", "#w-top3", "#w-habit"].forEach(function (id) { $(id).value = ""; });
    welcomeStep(1);
  }

  // ── sample ───────────────────────────────────────────────────────
  function loadSample() {
    var t = HH.today(), d = blank(), id = 1;
    d.settings.theme = D ? D.settings.theme : "auto";
    var td = { top: [{ id: id++, text: "Book the dentist", done: true, from: null, sample: true },
                     { id: id++, text: "Reply to the school email", done: false, from: null, sample: true },
                     { id: id++, text: "20 minutes on the tax folder", done: false, from: HH.iso(t - 1), sample: true }],
               also: [{ id: id++, text: "Buy cat food", done: false, from: null, sample: true }, { id: id++, text: "Charge the headphones", done: true, from: null, sample: true },
                      { id: id++, text: "Text Sam back", done: false, from: HH.iso(t - 1), sample: true }], routineTicks: {}, mood: 4 };
    d.days[HH.iso(t)] = td;
    d.days[HH.iso(t - 1)] = { top: [{ id: id++, text: "Pay the electricity bill", done: true, from: null, sample: true }], also: [], routineTicks: {}, mood: 3 };
    d.routines = [
      { id: id++, name: "Morning", steps: ["Water and tablets", "Open the blinds", "Five minutes of stretching", "Look at Today"], days: [1, 2, 3, 4, 5, 6, 0], sample: true },
      { id: id++, name: "Leaving the house", steps: ["Keys, wallet, phone", "Lights off", "Lock the door"], days: [1, 2, 3, 4, 5], sample: true },
      { id: id++, name: "Evening", steps: ["Dishes in the sink or dishwasher", "Tomorrow's Top 3", "Phone on charge", "Lights down"], days: [1, 2, 3, 4, 5, 6, 0], sample: true }
    ];
    td.routineTicks[d.routines[0].id] = [0, 1, 2];
    var walk = [], water = [], read = [];
    for (var k = 1; k <= 40; k++) { if (k % 3 !== 0) walk.push(HH.iso(t - k)); if (k % 2 === 0 || k < 6) water.push(HH.iso(t - k)); if (k % 4 === 1) read.push(HH.iso(t - k)); }
    walk.push(HH.iso(t - 1), HH.iso(t - 2)); water.push(HH.iso(t));
    d.habits = [
      { id: id++, name: "Walk outside", target: 5, ticks: walk.filter(function (v, i, a) { return a.indexOf(v) === i; }), sample: true },
      { id: id++, name: "Drink water", target: 7, ticks: water.filter(function (v, i, a) { return a.indexOf(v) === i; }), sample: true },
      { id: id++, name: "Read ten pages", target: 3, ticks: read, sample: true }
    ];
    d.dump = [
      { id: id++, text: "Look up a new GP", created: HH.iso(t - 2), when: null, sample: true },
      { id: id++, text: "Birthday present for Alex", created: HH.iso(t - 1), when: HH.iso(t + 3), sample: true },
      { id: id++, text: "Sort the photos", created: HH.iso(t - 5), when: "someday", sample: true },
      { id: id++, text: "Ask about the parking permit", created: HH.iso(t), when: null, sample: true },
      { id: id++, text: "Plan a weekend away", created: HH.iso(t - 9), when: "someday", sample: true }
    ];
    d.focus.sessions[HH.iso(t)] = 2;
    d.meta.sample = true;
    d.meta.onboarded = true;
    d.meta.nextId = id;
    D = d;
    save();
    go("today");
    HH.toast("Sample entries loaded. Clear them any time.", null, 4000);
  }
  function clearSample() {
    var theme = D.settings.theme, next = D.meta.nextId, keep = blank();
    keep.settings.theme = theme;
    keep.meta.nextId = next;
    D.habits.filter(function (h) { return !h.sample; }).forEach(function (h) { keep.habits.push(h); });
    D.routines.filter(function (r) { return !r.sample; }).forEach(function (r) { keep.routines.push(r); });
    D.dump.filter(function (x) { return !x.sample; }).forEach(function (x) { keep.dump.push(x); });
    for (var k in D.days) {
      var dd = D.days[k], top = dd.top.filter(function (x) { return !x.sample; }), also = dd.also.filter(function (x) { return !x.sample; });
      if (top.length || also.length) keep.days[k] = { top: top, also: also, routineTicks: {}, mood: null };
    }
    MENU_KEYS.forEach(function (mk) { var own = D.menu[mk].filter(function (it) { return !it.sample; }); if (own.length) keep.menu[mk] = own; });
    D = keep;
    save();
    startWelcome();
  }

  // ── today ────────────────────────────────────────────────────────
  function addItem(where, text) {
    text = text.trim().slice(0, 120);
    if (!text) return;
    var d = day(T), x = { id: newId(), text: text, done: false, from: null };
    if (D.meta.sample) x.sample = false;
    if (where === "top" && d.top.length < 3) d.top.push(x); else d.also.push(x);
    save();
    renderToday(); renderFocus();
  }
  function findItem(where, id) {
    var d = day(T), list = where === "top" ? d.top : d.also;
    return { list: list, x: byId(list, id) };
  }

  // ── brain dump ───────────────────────────────────────────────────
  function addDump(text) {
    text = text.trim().slice(0, 200);
    if (!text) return;
    var x = { id: newId(), text: text, created: HH.iso(T), when: null };
    if (D.meta.sample) x.sample = false;
    D.dump.push(x);
    save();
    renderDump();
  }
  function dumpToToday(x) {
    D.dump = D.dump.filter(function (y) { return y !== x; });
    var it = { id: newId(), text: x.text, done: false, from: null };
    if (D.meta.sample) it.sample = false;
    day(T).also.push(it);
    save();
    renderDump(); renderToday();
    HH.toast("Moved to Today");
  }

  // ── routines ─────────────────────────────────────────────────────
  function openRoutine(r) {
    editingRoutine = r;
    $("#r-title").textContent = r.name;
    var tk = day(T).routineTicks[r.id] || [];
    var today = r.days.indexOf(HH.weekday(T)) >= 0;
    $("#r-today-note").textContent = today ? "Today: done " + routineDone(r, T) + " of " + r.steps.length : "Not one of this routine's days, but you can still tick it.";
    $("#r-steps").innerHTML = r.steps.map(function (s, i) {
      return '<li class="plain"><label class="tick"><input type="checkbox" data-rstep="' + i + '"' + (tk.indexOf(i) >= 0 ? " checked" : "") + '><span class="what' +
        (tk.indexOf(i) >= 0 ? " done" : "") + '">' + esc(s) + "</span></label></li>";
    }).join("");
    go("routine");
  }
  function openRoutineEdit(r) {
    editingRoutine = r || null;
    $("#re-title").textContent = r ? "Change routine" : "Add a routine";
    $("#re-name").value = r ? r.name : "";
    $("#re-steps").value = r ? r.steps.join("\n") : "";
    $$("#re-days input").forEach(function (i) { i.checked = r ? r.days.indexOf(+i.value) >= 0 : true; });
    $("#re-err").hidden = true;
    $("#re-delete").hidden = !r;
    go("routine-edit");
    $("#re-name").focus();
  }
  function saveRoutine(ev) {
    ev.preventDefault();
    var name = $("#re-name").value.trim().slice(0, 40);
    var steps = $("#re-steps").value.split("\n").map(function (s) { return s.trim().slice(0, 80); }).filter(Boolean);
    var days = $$("#re-days input").filter(function (i) { return i.checked; }).map(function (i) { return +i.value; });
    var err = !name ? "Give the routine a name, such as Morning." : !steps.length ? "Type at least one step, one per line." : !days.length ? "Pick at least one day." : "";
    if (err) { $("#re-err").textContent = err; $("#re-err").hidden = false; return; }
    var r = editingRoutine || { id: newId() };
    r.name = name; r.steps = steps; r.days = days;
    if (!editingRoutine) { if (D.meta.sample) r.sample = false; D.routines.push(r); }
    save();
    go("routines");
    HH.toast((editingRoutine ? "Changed " : "Added ") + name);
  }
  function deleteRoutine() {
    var r = editingRoutine, i = D.routines.indexOf(r);
    if (i < 0) return;
    D.routines.splice(i, 1);
    save();
    go("routines");
    HH.toast("Removed " + r.name, function () { D.routines.splice(i, 0, r); save(); render(); });
  }

  // ── habits ───────────────────────────────────────────────────────
  function openHabit(h) {
    editingHabit = h || null;
    $("#he-title").textContent = h ? "Change habit" : "Add a habit";
    $("#he-name").value = h ? h.name : "";
    $("#he-target").value = h ? String(h.target) : "5";
    $("#he-err").hidden = true;
    $("#he-delete").hidden = !h;
    go("habit-edit");
    $("#he-name").focus();
  }
  function saveHabitForm(ev) {
    ev.preventDefault();
    var name = $("#he-name").value.trim().slice(0, 40), target = +$("#he-target").value;
    var err = !name ? "Give the habit a name, such as Walk outside." : !(target >= 1 && target <= 7) ? "Pick how many days a week, 1 to 7." : "";
    if (err) { $("#he-err").textContent = err; $("#he-err").hidden = false; return; }
    var h = editingHabit || { id: newId(), ticks: [] };
    h.name = name; h.target = target;
    if (!editingHabit) { if (D.meta.sample) h.sample = false; D.habits.push(h); }
    save();
    go("habits");
    HH.toast((editingHabit ? "Changed " : "Added ") + name);
  }
  function deleteHabit() {
    var h = editingHabit, i = D.habits.indexOf(h);
    if (i < 0) return;
    D.habits.splice(i, 1);
    save();
    go("habits");
    HH.toast("Removed " + h.name, function () { D.habits.splice(i, 0, h); save(); render(); });
  }
  function toggleTick(h, back) {
    var n = T - back, k = HH.iso(n), i = h.ticks.indexOf(k);
    if (i >= 0) h.ticks.splice(i, 1); else h.ticks.push(k);
    h.ticks.sort();
    save();
    renderToday(); renderHabits();
  }

  // ── dopamine menu ────────────────────────────────────────────────
  function pick(list, rng) {
    var items = D.menu[list];
    if (!items.length) return null;
    var r = (rng || Math.random)();
    return items[Math.min(items.length - 1, Math.floor(r * items.length))];
  }
  function openMenuEdit(k, i) {
    editingMenu = { k: k, i: i };
    var it = i == null ? null : D.menu[k][i];
    $("#me-title").textContent = (it ? "Change an item in " : "Add to ") + MENU_NAMES[k];
    $("#me-text").value = it ? it.text : "";
    $("#me-err").hidden = true;
    $("#me-delete").hidden = !it;
    go("menu-edit");
    $("#me-text").focus();
  }
  function saveMenuItem(ev) {
    ev.preventDefault();
    var text = $("#me-text").value.trim().slice(0, 80);
    if (!text) { $("#me-err").textContent = "Type the thing, such as Walk around the block."; $("#me-err").hidden = false; return; }
    var list = D.menu[editingMenu.k];
    if (editingMenu.i == null) list.push({ text: text, sample: false }); else list[editingMenu.i] = { text: text, sample: false };
    save();
    go("menu");
  }
  function deleteMenuItem() {
    D.menu[editingMenu.k].splice(editingMenu.i, 1);
    save();
    go("menu");
  }

  // ── settings, backup, restore ────────────────────────────────────
  function backup() {
    T = HH.today();
    D.meta.lastBackup = HH.iso(T);
    D.meta.reminderDismissed = null;
    save();
    var name = "hollowayhart-life-planner-backup-" + HH.iso(T) + ".json";
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
      var d = r.data, n = 0;
      for (var k in d.days) n += d.days[k].top.length + d.days[k].also.length;
      restoreMsg('<div class="banner" id="restore-summary"><strong>This backup has</strong>' + plural(n, "thing", "things") + " on its days · " +
        plural(d.habits.length, "habit", "habits") + " · " + plural(d.routines.length, "routine", "routines") + " · " + plural(d.dump.length, "brain dump line", "brain dump lines") +
        (r.made != null ? " · made " + HH.fmtLong(r.made) : "") +
        '<p class="small" style="margin-top:6px">Restoring replaces everything in the app now.</p>' +
        '<div class="row-buttons"><button type="button" class="btn btn-primary" id="restore-yes">Replace with this backup</button>' +
        '<button type="button" class="btn btn-quiet" id="restore-no">Cancel</button></div></div>');
      $("#restore-yes").addEventListener("click", function () {
        D = pendingRestore; pendingRestore = null;
        save();
        restoreMsg("");
        if (!D.meta.onboarded) startWelcome(); else go("today");
        HH.toast("Backup restored.");
      });
      $("#restore-no").addEventListener("click", function () { pendingRestore = null; restoreMsg(""); });
    });
  }
  function startFresh() {
    HH.confirmStep({
      title: "Start fresh?", yes: "Next", no: "Keep my entries",
      text: "This deletes your days, habits, routines, brain dump and menu from this browser. If you might want them again, cancel and use Back up now first.",
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
    $("#mood").innerHTML = MOODS.map(function (m, i) {
      return '<label class="chip"><input type="radio" name="mood" value="' + (i + 1) + '"><span><span class="face" aria-hidden="true">' + MOOD_FACES[i] + "</span> " + m + "</span></label>";
    }).join("");
    $$("#mood input").forEach(function (r) { r.addEventListener("change", function () { day(T).mood = +r.value; save(); }); });
    $("#also-form").addEventListener("submit", function (ev) { ev.preventDefault(); addItem("also", $("#also-input").value); $("#also-input").value = ""; });
    $("#dump-form").addEventListener("submit", function (ev) { ev.preventDefault(); addDump($("#dump-input").value); $("#dump-input").value = ""; $("#dump-input").focus(); });
    $("#dump-input").addEventListener("keydown", function (ev) { if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); addDump($("#dump-input").value); $("#dump-input").value = ""; } });
    $("#dd-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var x = byId(D.dump, +$("#dd-id").value), w = HH.parseIso($("#dd-date").value);
      if (!x) { go(dumpReturn); return; }
      if (w == null) { $("#dd-err").hidden = false; return; }
      if (w <= T) { D.dump = D.dump.filter(function (y) { return y !== x; }); var it = { id: newId(), text: x.text, done: false, from: null }; if (D.meta.sample) it.sample = false; day(T).also.push(it); }
      else x.when = HH.iso(w);
      save();
      go(dumpReturn);
      HH.toast(w <= T ? "Moved to Today" : "Saved for " + HH.fmtDate(w));
    });
    $("#dd-cancel").addEventListener("click", function () { go(dumpReturn); });
    $("#routine-add").addEventListener("click", function () { openRoutineEdit(null); });
    $("#r-edit").addEventListener("click", function () { openRoutineEdit(editingRoutine); });
    $("#r-back").addEventListener("click", function () { go("routines"); });
    $("#re-form").addEventListener("submit", saveRoutine);
    $("#re-cancel").addEventListener("click", function () { go("routines"); });
    $("#re-delete").addEventListener("click", deleteRoutine);
    $("#habit-add").addEventListener("click", function () { openHabit(null); });
    $("#he-form").addEventListener("submit", saveHabitForm);
    $("#he-cancel").addEventListener("click", function () { go("habits"); });
    $("#he-delete").addEventListener("click", deleteHabit);
    $("#year-back").addEventListener("click", function () { go("habits"); });
    // focus
    $("#f-start").addEventListener("click", function () {
      var r = D.focus.run;
      if (r && r.pausedAt != null) { r.pausedTotal += Date.now() - r.pausedAt; r.pausedAt = null; }
      else if (!r) {
        D.focus.run = { start: Date.now(), work: D.settings.focusWork, brk: D.settings.focusBreak, pausedAt: null, pausedTotal: 0, counted: false,
                        taskId: $("#f-task").value ? +$("#f-task").value : null };
      }
      save();
      if (!focusTick) focusTick = setInterval(tickFocus, 500);
      tickFocus();
    });
    $("#f-pause").addEventListener("click", function () { var r = D.focus.run; if (r && r.pausedAt == null) { r.pausedAt = Date.now(); save(); tickFocus(); } });
    $("#f-reset").addEventListener("click", function () { D.focus.run = null; save(); clearInterval(focusTick); focusTick = null; tickFocus(); });
    $("#f-work").addEventListener("change", function () { var v = Math.max(1, Math.min(180, Math.round(+$("#f-work").value) || 25)); D.settings.focusWork = v; $("#f-work").value = v; save(); tickFocus(); });
    $("#f-break").addEventListener("change", function () { var v = Math.max(1, Math.min(60, Math.round(+$("#f-break").value) || 5)); D.settings.focusBreak = v; $("#f-break").value = v; save(); });
    $("#f-sound").addEventListener("change", function () { D.settings.sound = $("#f-sound").checked; save(); });
    $("#f-task").addEventListener("change", function () { if (D.focus.run) { D.focus.run.taskId = $("#f-task").value ? +$("#f-task").value : null; save(); } });
    // menu
    $("#pick-btn").addEventListener("click", function () {
      var k = $("#pick-list").value, it = pick(k);
      $("#pick-result").hidden = false;
      $("#pick-result").textContent = it ? it.text : "That list is empty. Add something to it first.";
    });
    $$("[data-menu-add]").forEach(function (b) { b.addEventListener("click", function () { openMenuEdit(b.getAttribute("data-menu-add"), null); }); });
    $("#me-form").addEventListener("submit", saveMenuItem);
    $("#me-cancel").addEventListener("click", function () { go("menu"); });
    $("#me-delete").addEventListener("click", deleteMenuItem);
    // delegated clicks
    document.addEventListener("click", function (ev) {
      var t = ev.target.closest ? ev.target.closest("[data-remove],[data-dump-today],[data-dump-date],[data-dump-someday],[data-dump-remove],[data-open-routine]," +
        "[data-edit-habit],[data-habit-tick],[data-habit-year],[data-menu-edit],[data-clear-sample],[data-backup],[data-dismiss-backup]") : null;
      if (!t) return;
      var id, parts;
      if (t.hasAttribute("data-remove")) {
        parts = t.getAttribute("data-remove").split(":"); var f = findItem(parts[0], +parts[1]);
        if (f.x) { var i = f.list.indexOf(f.x); f.list.splice(i, 1); save(); renderToday(); renderFocus();
          HH.toast("Removed " + f.x.text, function () { f.list.splice(i, 0, f.x); save(); renderToday(); renderFocus(); }); }
      } else if (t.hasAttribute("data-dump-today")) { var x1 = byId(D.dump, +t.getAttribute("data-dump-today")); if (x1) dumpToToday(x1); }
      else if (t.hasAttribute("data-dump-date")) {
        id = +t.getAttribute("data-dump-date"); var x2 = byId(D.dump, id);
        dumpReturn = "dump";
        $("#dd-id").value = id; $("#dd-text").textContent = x2 ? x2.text : ""; $("#dd-date").value = HH.iso(T + 1); $("#dd-err").hidden = true;
        go("dump-date");
      } else if (t.hasAttribute("data-dump-someday")) { var x3 = byId(D.dump, +t.getAttribute("data-dump-someday")); if (x3) { x3.when = "someday"; save(); renderDump(); } }
      else if (t.hasAttribute("data-dump-remove")) {
        var x4 = byId(D.dump, +t.getAttribute("data-dump-remove")), j = D.dump.indexOf(x4);
        if (x4) { D.dump.splice(j, 1); save(); renderDump(); HH.toast("Removed " + x4.text, function () { D.dump.splice(j, 0, x4); save(); renderDump(); }); }
      } else if (t.hasAttribute("data-open-routine")) { var r = byId(D.routines, +t.getAttribute("data-open-routine")); if (r) openRoutine(r); }
      else if (t.hasAttribute("data-edit-habit")) openHabit(byId(D.habits, +t.getAttribute("data-edit-habit")));
      else if (t.hasAttribute("data-habit-tick")) { parts = t.getAttribute("data-habit-tick").split(":"); var h = byId(D.habits, +parts[0]); if (h) toggleTick(h, +parts[1]); }
      else if (t.hasAttribute("data-habit-year")) { yearHabit = byId(D.habits, +t.getAttribute("data-habit-year")); if (yearHabit) { renderYear(yearHabit); go("habit-year"); } }
      else if (t.hasAttribute("data-menu-edit")) { parts = t.getAttribute("data-menu-edit").split(":"); openMenuEdit(parts[0], +parts[1]); }
      else if (t.hasAttribute("data-clear-sample")) clearSample();
      else if (t.hasAttribute("data-backup")) backup();
      else if (t.hasAttribute("data-dismiss-backup")) { D.meta.reminderDismissed = HH.iso(T); save(); renderBanners(); }
    });
    document.addEventListener("change", function (ev) {
      var t = ev.target;
      if (t.hasAttribute("data-tick")) {
        var parts = t.getAttribute("data-tick").split(":"), f = findItem(parts[0], +parts[1]);
        if (f.x) { f.x.done = t.checked; save(); renderToday(); renderFocus(); }
      } else if (t.hasAttribute("data-rstep")) {
        var r = editingRoutine, tk = day(T).routineTicks[r.id] || (day(T).routineTicks[r.id] = []), i = +t.getAttribute("data-rstep"), at = tk.indexOf(i);
        if (t.checked && at < 0) tk.push(i); else if (!t.checked && at >= 0) tk.splice(at, 1);
        save();
        openRoutine(r);
      }
    });
    document.addEventListener("submit", function (ev) {
      var f = ev.target;
      if (f.hasAttribute && f.hasAttribute("data-add")) { ev.preventDefault(); var inp = f.querySelector("input"); addItem(f.getAttribute("data-add"), inp.value); }
    });
    // settings
    $$('input[name="theme"]').forEach(function (r) { r.addEventListener("change", function () { D.settings.theme = r.value; save(); HH.applyTheme(r.value); }); });
    $$('input[name="weekstart"]').forEach(function (r) { r.addEventListener("change", function () { D.settings.weekStart = r.value; save(); renderHabits(); }); });
    $("#backup-btn").addEventListener("click", backup);
    $("#restore-file").addEventListener("change", onRestoreFile);
    $("#sample-btn").addEventListener("click", function () {
      if (D.meta.sample) { clearSample(); return; }
      if (hasOwn()) { $("#sample-state").textContent = "Sample entries only load into an empty app. Back up, then Start fresh, if you want to look at them."; return; }
      loadSample();
    });
    $("#fresh-btn").addEventListener("click", startFresh);
    $("#help-btn").addEventListener("click", function () { go("help"); });
    $("#help-back").addEventListener("click", function () { go("settings"); });
    // first run
    $("#w-form1").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var any = false;
      ["#w-top1", "#w-top2", "#w-top3"].forEach(function (id) { var v = $(id).value.trim(); if (v) { addItem("top", v); any = true; } });
      if (!any) { $("#w-err1").hidden = false; return; }
      $("#w-err1").hidden = true;
      welcomeStep(2);
    });
    $("#w-sample").addEventListener("click", loadSample);
    $("#w-form2").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var name = $("#w-habit").value.trim().slice(0, 40);
      if (name) { var h = { id: newId(), name: name, target: +$("#w-target").value || 5, ticks: [] }; D.habits.push(h); save(); }
      welcomeStep(3);
    });
    $("#w-habit-skip").addEventListener("click", function () { welcomeStep(3); });
    $("#w-finish").addEventListener("click", function () { D.meta.onboarded = true; save(); go("today"); });
    document.addEventListener("visibilitychange", function () { if (!document.hidden && D.meta.onboarded) { render(); if (D.focus.run && !focusTick) focusTick = setInterval(tickFocus, 500); } });
  }

  // ── start ────────────────────────────────────────────────────────
  function start() {
    var raw = store.read();
    if (raw) {
      var r = migrate(raw);
      if (r.data) D = r.data;
      else {
        try { window.localStorage.setItem("hh73_unreadable_" + HH.iso(HH.today()), JSON.stringify(raw)); } catch (e) { /* nothing more to do */ }
        D = blank();
      }
    } else D = blank();
    wire();
    if (D.meta.onboarded) { go("today"); if (D.focus.run) focusTick = setInterval(tickFocus, 500); } else startWelcome();
  }

  // for the QA runner (qa/app_qa73.py)
  window.HH73 = { streak: streak, weekTicks: weekTicks, focusState: focusState, pick: pick, migrate: migrate, SCHEMA: SCHEMA, APP_ID: APP_ID,
    sounds: function () { return soundsPlayed; }, data: function () { return D; } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
