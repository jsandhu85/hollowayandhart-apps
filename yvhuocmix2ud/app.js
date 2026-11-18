window.HH_BUILD = {"id": "143", "version": "18Nov2026.4", "hosted": true};
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

/* Product 143: Workout Tracker App (specs/health/143-workout-tracker-app.yaml), 18 Nov 2026.
   Routines with target sets x reps, a log with last time's numbers beside every set, a calm progressive-overload suggestion,
   bests (heaviest, estimated 1RM by Epley, most reps at each weight) with their dates, history by week with the volume, body
   measurements from the buyer's own list, and a rest timer that keeps time from its start timestamp. Weights are whole numbers
   of hundredths of the unit shown (60 kg = 6000); dates are day numbers from HH (apps/core.js). */
(function () {
  "use strict";
  var SCHEMA = 1;
  var APP_ID = "hollowayhart-workout-tracker";
  var LB = 0.45359237;                       // 1 lb in kg, exactly
  var GROUPS = ["Chest", "Back", "Shoulders", "Arms", "Legs", "Glutes", "Core", "Full body"];
  var EQUIP = ["Barbell", "Dumbbell", "Machine", "Cable", "Bodyweight", "Kettlebell", "Band", "Other"];
  var BUILTIN = [
    ["Bench press", "Chest", "Barbell"], ["Incline bench press", "Chest", "Barbell"], ["Dumbbell bench press", "Chest", "Dumbbell"],
    ["Incline dumbbell press", "Chest", "Dumbbell"], ["Chest fly", "Chest", "Machine"], ["Push-up", "Chest", "Bodyweight"], ["Dip", "Chest", "Bodyweight"],
    ["Deadlift", "Back", "Barbell"], ["Barbell row", "Back", "Barbell"], ["One-arm dumbbell row", "Back", "Dumbbell"], ["Lat pulldown", "Back", "Cable"],
    ["Seated cable row", "Back", "Cable"], ["Pull-up", "Back", "Bodyweight"], ["Chin-up", "Back", "Bodyweight"],
    ["Overhead press", "Shoulders", "Barbell"], ["Dumbbell shoulder press", "Shoulders", "Dumbbell"], ["Lateral raise", "Shoulders", "Dumbbell"],
    ["Face pull", "Shoulders", "Cable"],
    ["Barbell curl", "Arms", "Barbell"], ["Dumbbell curl", "Arms", "Dumbbell"], ["Hammer curl", "Arms", "Dumbbell"], ["Triceps pushdown", "Arms", "Cable"],
    ["Overhead triceps extension", "Arms", "Dumbbell"],
    ["Back squat", "Legs", "Barbell"], ["Front squat", "Legs", "Barbell"], ["Romanian deadlift", "Legs", "Barbell"], ["Leg press", "Legs", "Machine"],
    ["Leg extension", "Legs", "Machine"], ["Leg curl", "Legs", "Machine"], ["Walking lunge", "Legs", "Dumbbell"], ["Goblet squat", "Legs", "Kettlebell"],
    ["Calf raise", "Legs", "Machine"],
    ["Hip thrust", "Glutes", "Barbell"],
    ["Hanging leg raise", "Core", "Bodyweight"], ["Cable crunch", "Core", "Cable"],
    ["Kettlebell swing", "Full body", "Kettlebell"]
  ];
  var STARTERS = {
    ppl: [["Push", [["Bench press", 3, 8], ["Overhead press", 3, 8], ["Incline dumbbell press", 3, 10], ["Lateral raise", 3, 12], ["Triceps pushdown", 3, 12]]],
          ["Pull", [["Deadlift", 3, 5], ["Lat pulldown", 3, 10], ["Seated cable row", 3, 10], ["Face pull", 3, 15], ["Dumbbell curl", 3, 12]]],
          ["Legs", [["Back squat", 3, 8], ["Romanian deadlift", 3, 10], ["Leg press", 3, 12], ["Leg curl", 3, 12], ["Calf raise", 3, 15]]]],
    fb: [["Full body A", [["Back squat", 3, 5], ["Bench press", 3, 5], ["Barbell row", 3, 8], ["Hanging leg raise", 3, 10]]],
         ["Full body B", [["Deadlift", 3, 5], ["Overhead press", 3, 5], ["Lat pulldown", 3, 10], ["Walking lunge", 3, 10]]]],
    ul: [["Upper", [["Bench press", 3, 8], ["Barbell row", 3, 8], ["Overhead press", 3, 10], ["Lat pulldown", 3, 10], ["Dumbbell curl", 3, 12]]],
         ["Lower", [["Back squat", 3, 8], ["Romanian deadlift", 3, 10], ["Leg press", 3, 12], ["Leg curl", 3, 12], ["Calf raise", 3, 15]]]]
  };
  // the sample: four sessions of each Push / Pull / Legs exercise, [weight in kg, [reps of each set]]
  var SAMPLE_W = {
    "Bench press": [[55, [8, 8, 8]], [57.5, [8, 8, 8]], [60, [8, 8, 7]], [60, [8, 8, 8]]],
    "Overhead press": [[35, [8, 8, 8]], [37.5, [8, 8, 7]], [37.5, [8, 8, 8]], [40, [8, 7, 6]]],
    "Incline dumbbell press": [[20, [10, 10, 10]], [22.5, [10, 10, 8]], [22.5, [10, 10, 10]], [25, [10, 9, 8]]],
    "Lateral raise": [[8, [12, 12, 12]], [10, [12, 11, 10]], [10, [12, 12, 12]], [10, [12, 12, 12]]],
    "Triceps pushdown": [[25, [12, 12, 12]], [27.5, [12, 12, 11]], [27.5, [12, 12, 12]], [30, [12, 12, 10]]],
    "Deadlift": [[100, [5, 5, 5]], [105, [5, 5, 5]], [110, [5, 5, 4]], [110, [5, 5, 5]]],
    "Lat pulldown": [[50, [10, 10, 10]], [52.5, [10, 10, 10]], [55, [10, 9, 8]], [55, [10, 10, 10]]],
    "Seated cable row": [[45, [10, 10, 10]], [47.5, [10, 10, 10]], [50, [10, 10, 10]], [52.5, [10, 10, 9]]],
    "Face pull": [[20, [15, 15, 15]], [20, [15, 15, 15]], [22.5, [15, 14, 12]], [22.5, [15, 15, 15]]],
    "Dumbbell curl": [[10, [12, 12, 12]], [10, [12, 12, 12]], [12.5, [12, 10, 9]], [12.5, [12, 12, 11]]],
    "Back squat": [[80, [8, 8, 8]], [82.5, [8, 8, 8]], [85, [8, 8, 8]], [87.5, [8, 8, 7]]],
    "Romanian deadlift": [[60, [10, 10, 10]], [62.5, [10, 10, 10]], [65, [10, 10, 9]], [65, [10, 10, 10]]],
    "Leg press": [[120, [12, 12, 12]], [130, [12, 12, 12]], [140, [12, 11, 10]], [140, [12, 12, 12]]],
    "Leg curl": [[35, [12, 12, 12]], [37.5, [12, 12, 12]], [40, [12, 11, 10]], [40, [12, 12, 12]]],
    "Calf raise": [[60, [15, 15, 15]], [65, [15, 15, 15]], [70, [15, 15, 15]], [70, [15, 15, 15]]]
  };
  var SAMPLE_DAYS = [26, 24, 22, 19, 17, 15, 12, 10, 8, 5, 3, 1];
  var SAMPLE_BODY = { days: [28, 21, 14, 7, 0], "Body weight": [78.4, 78.6, 78.9, 79.1, 79], "Waist": [84, 84, 83.5, 83.5, 83],
                      "Chest": [100, 100.5, 101, 101, 101.5], "Hips": [96, 96, 95.5, 95.5, 95.5] };
  var DEFAULT_MEASURES = [["Body weight", null], ["Waist", "cm"], ["Chest", "cm"], ["Hips", "cm"]];
  var REMIND_DAYS = 30;
  var $ = HH.$, $$ = HH.$$, esc = HH.esc;
  var store = new HH.Store("hh143_");
  var D = null;
  var T = HH.today();
  var draft = null, editingEx = null, exReturn = "library", editingBody = null, pickFor = null, pickGroup = "All", libGroup = "All";
  var pendingRestore = null, detailEx = null, detailWo = null, restTimer = null, soundsPlayed = 0, msDraft = null, incDirty = false;

  // ── data ──────────────────────────────────────────────────────────
  function blank(unit) {
    unit = unit === "lb" ? "lb" : "kg";
    var d = {
      schema: SCHEMA,
      settings: { theme: "auto", unit: unit, inc: unit === "kg" ? 250 : 500, restSec: 90, autoRest: true, sound: false, weekStart: "Mon" },
      exercises: [], routines: [], workouts: [], current: null, measures: [], body: [], timer: null,
      meta: { created: HH.iso(HH.today()), lastBackup: null, reminderDismissed: null, sample: false, onboarded: false, nextId: 1 }
    };
    BUILTIN.forEach(function (b) { d.exercises.push({ id: d.meta.nextId++, name: b[0], group: b[1], equip: b[2], inc: null, builtIn: true, gone: false }); });
    DEFAULT_MEASURES.forEach(function (m) { d.measures.push({ id: d.meta.nextId++, name: m[0], unit: m[1] || unit }); });
    return d;
  }
  function isInt(x) { return typeof x === "number" && isFinite(x) && Math.floor(x) === x; }
  function isDate(s) { return HH.parseIso(s) != null; }
  function isText(s, n) { return typeof s === "string" && s.length > 0 && s.length <= n; }
  function isW(x) { return isInt(x) && x >= 0 && x <= 999999; }
  function validSet(s, live) {
    if (!s || typeof s !== "object") return false;
    if (live) return (s.w === null || isW(s.w)) && (s.r === null || (isInt(s.r) && s.r >= 0 && s.r <= 999)) && typeof s.done === "boolean";
    return isW(s.w) && isInt(s.r) && s.r >= 1 && s.r <= 999;
  }
  function validItem(it, live, ids) {
    return !!it && isInt(it.ex) && ids[it.ex] === true && !!it.target && isInt(it.target.sets) && it.target.sets >= 1 && it.target.sets <= 20 &&
      isInt(it.target.reps) && it.target.reps >= 1 && it.target.reps <= 100 && Array.isArray(it.sets) && it.sets.every(function (s) { return validSet(s, live); });
  }
  function validWorkout(w, live, ids) {
    if (!w || typeof w !== "object" || !isDate(w.date) || !isText(w.name, 60) || !Array.isArray(w.items)) return false;
    if (live ? !(w.editId === null || isInt(w.editId)) : !isInt(w.id)) return false;
    if (!(w.start === null || (typeof w.start === "number" && isFinite(w.start)))) return false;
    if (!live && !(w.end === null || (typeof w.end === "number" && isFinite(w.end)))) return false;
    if (!(w.routine === null || isInt(w.routine))) return false;
    return w.items.every(function (it) { return validItem(it, live, ids); });
  }
  function validate(d) {
    try {
      var s = d.settings, m = d.meta, ids = {}, mids = {}, i;
      if (d.schema !== SCHEMA || !s || !m) return false;
      if (["auto", "light", "dark"].indexOf(s.theme) < 0 || ["kg", "lb"].indexOf(s.unit) < 0 || ["Mon", "Sun"].indexOf(s.weekStart) < 0) return false;
      if (!isW(s.inc) || s.inc < 1 || !isInt(s.restSec) || s.restSec < 10 || s.restSec > 600) return false;
      if (typeof s.autoRest !== "boolean" || typeof s.sound !== "boolean") return false;
      if (!Array.isArray(d.exercises) || !Array.isArray(d.routines) || !Array.isArray(d.workouts) || !Array.isArray(d.measures) || !Array.isArray(d.body)) return false;
      for (i = 0; i < d.exercises.length; i++) {
        var e = d.exercises[i];
        if (!isInt(e.id) || !isText(e.name, 40) || GROUPS.indexOf(e.group) < 0 || EQUIP.indexOf(e.equip) < 0) return false;
        if (!(e.inc === null || (isW(e.inc) && e.inc > 0)) || typeof e.builtIn !== "boolean" || typeof e.gone !== "boolean") return false;
        ids[e.id] = true;
      }
      for (i = 0; i < d.routines.length; i++) {
        var r = d.routines[i];
        if (!isInt(r.id) || !isText(r.name, 40) || !Array.isArray(r.items)) return false;
        if (!r.items.every(function (x) { return isInt(x.ex) && ids[x.ex] === true && isInt(x.sets) && x.sets >= 1 && x.sets <= 20 && isInt(x.reps) && x.reps >= 1 && x.reps <= 100; })) return false;
      }
      for (i = 0; i < d.workouts.length; i++) if (!validWorkout(d.workouts[i], false, ids)) return false;
      if (!(d.current === null || validWorkout(d.current, true, ids))) return false;
      for (i = 0; i < d.measures.length; i++) {
        var ms = d.measures[i];
        if (!isInt(ms.id) || !isText(ms.name, 30) || !isText(ms.unit, 8)) return false;
        mids[ms.id] = true;
      }
      for (i = 0; i < d.body.length; i++) {
        var b = d.body[i];
        if (!isInt(b.id) || !isDate(b.date) || !b.vals || typeof b.vals !== "object" || typeof b.note !== "string" || b.note.length > 80) return false;
        for (var k in b.vals) if (!mids[k] || !isW(b.vals[k])) return false;
      }
      var t = d.timer;
      if (!(t === null || (typeof t === "object" && typeof t.start === "number" && typeof t.dur === "number" && typeof t.pausedTotal === "number"))) return false;
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
  function byId(list, id) { return list.filter(function (x) { return x.id === id; })[0]; }
  function exById(id) { return byId(D.exercises, id) || { id: id, name: "Exercise", group: "Other", equip: "Other", inc: null }; }
  function exByName(d, name) { return d.exercises.filter(function (e) { return e.name === name; })[0]; }
  function notSample(x) { return !x.sample; }
  function hasOwn() {
    return !!D.current || D.workouts.some(notSample) || D.body.some(notSample) || D.exercises.some(function (e) { return !e.builtIn; }) ||
      D.routines.some(function (r) { return !r.sample && !r.starter; });
  }

  // ── numbers ──────────────────────────────────────────────────────
  function U() { return D.settings.unit; }
  function num(h, plainOut) {                   // hundredths -> '1,234.5' (trailing zeros dropped)
    var neg = h < 0, a = Math.abs(Math.round(h)), i = Math.floor(a / 100), f = a % 100;
    var s = plainOut ? String(i) : String(i).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    if (f) s += "." + (f < 10 ? "0" + f : String(f)).replace(/0$/, "");
    return (neg ? "-" : "") + s;
  }
  function wt(h) { return num(h) + " " + U(); }
  function parseNum(s) {                         // '62.5' / '62,5' -> 6250; '' -> undefined; anything else -> NaN
    s = String(s == null ? "" : s).trim();
    if (!s) return undefined;
    var m = /^(\d{0,4})(?:[.,](\d{1,2}))?$/.exec(s);
    if (!m || (!m[1] && !m[2])) return NaN;
    return parseInt(m[1] || "0", 10) * 100 + (m[2] ? parseInt((m[2] + "0").slice(0, 2), 10) : 0);
  }
  function parseReps(s) {
    s = String(s == null ? "" : s).trim();
    if (!s) return undefined;
    if (!/^\d{1,3}$/.test(s)) return NaN;
    var r = parseInt(s, 10);
    return r >= 1 && r <= 100 ? r : NaN;
  }
  // Epley: a single is the weight itself; otherwise w x (1 + r / 30) rounded half-up to 0.5 kg or 1 lb, in whole numbers
  function e1rm(w, r, unit) {
    if (!(w > 0) || !(r >= 1)) return 0;
    if (r === 1) return w;
    var step = (unit || U()) === "lb" ? 100 : 50, n = w * (30 + r), den = 30 * step;
    return Math.floor((2 * n + den) / (2 * den)) * step;
  }
  function setText(s) { return s.w > 0 ? num(s.w) + " × " + s.r : plural(s.r, "rep", "reps"); }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
  function setsVol(sets) { return sets.reduce(function (a, s) { return a + s.w * s.r; }, 0); }
  function woVol(w) { return w.items.reduce(function (a, it) { return a + setsVol(it.sets); }, 0); }
  function woSets(w) { return w.items.reduce(function (a, it) { return a + it.sets.length; }, 0); }
  function dn(s) { return HH.parseIso(s); }
  function dshort(n) { return HH.ymd(n).y === HH.ymd(T).y ? HH.fmtShort(n) : HH.fmtLong(n); }
  function mins(w) { var m = w.start && w.end ? Math.round((w.end - w.start) / 60000) : 0; return m >= 1 ? " · " + m + " min" : ""; }
  function mmss(ms) { var s = Math.ceil(ms / 1000), m = Math.floor(s / 60); return m + ":" + (s % 60 < 10 ? "0" : "") + (s % 60); }

  // ── workouts in order: date, then finish time, then entry order ──
  function key(w) { return [dn(w.date), w.end || 0, w.id]; }
  function cmpKey(a, b) { for (var i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1; } return 0; }
  function ordered() { return D.workouts.slice().sort(function (a, b) { return cmpKey(key(a), key(b)); }); }
  function before(k) { return ordered().filter(function (w) { return cmpKey(key(w), k) < 0; }); }
  function curKey() {
    var c = D.current, o = c && c.editId != null ? byId(D.workouts, c.editId) : null;
    return o ? [dn(c.date), o.end || 0, o.id] : [dn(c.date), Infinity, Infinity];
  }
  function exSets(w, exId) {
    var sets = [];
    w.items.forEach(function (it) { if (it.ex === exId) sets = sets.concat(it.sets); });
    return sets;
  }
  function lastFor(exId, k) {
    var ws = before(k);
    for (var i = ws.length - 1; i >= 0; i--) {
      var sets = exSets(ws[i], exId);
      if (sets.length) {
        var it = ws[i].items.filter(function (x) { return x.ex === exId; })[0];
        return { wo: ws[i], sets: sets, target: it.target };
      }
    }
    return null;
  }

  // ── bests ────────────────────────────────────────────────────────
  function stats(exId, ws) {
    var st = { sessions: [], heaviest: null, best: null, byW: {}, most: null, weights: [] };
    ws.forEach(function (w) {
      var sets = exSets(w, exId);
      if (!sets.length) return;
      var d = dn(w.date), sb = null;
      sets.forEach(function (s) {
        if (s.w > 0 && (!st.heaviest || s.w > st.heaviest.w)) st.heaviest = { w: s.w, date: d };
        var e = e1rm(s.w, s.r);
        if (e > 0 && (!st.best || e > st.best.e)) st.best = { e: e, w: s.w, r: s.r, date: d };
        if (e > 0 && (!sb || e > sb.e)) sb = { e: e, w: s.w, r: s.r };
        var b = st.byW[s.w];
        if (!b || s.r > b.r) st.byW[s.w] = { w: s.w, r: s.r, date: d };
      });
      st.sessions.push({ wo: w, date: d, sets: sets, best: sb });
    });
    st.weights = Object.keys(st.byW).map(function (k) { return st.byW[k]; }).sort(function (a, b) { return b.w - a.w; });
    st.weights.forEach(function (x) { if (!st.most || x.r > st.most.r) st.most = x; });
    return st;
  }
  // one pass over every workout in order: the bests each workout set against the workouts before it
  function timeline() {
    var run = {}, out = {};
    ordered().forEach(function (w) {
      var ev = [], order = [], per = {};
      w.items.forEach(function (it) { if (!per[it.ex]) { per[it.ex] = []; order.push(it.ex); } per[it.ex] = per[it.ex].concat(it.sets); });
      order.forEach(function (ex) {
        var sets = per[ex], r0 = run[ex], hw = 0, be = null, byW = {};
        if (!sets.length) return;
        sets.forEach(function (s) {
          if (s.w > hw) hw = s.w;
          var e = e1rm(s.w, s.r);
          if (e > 0 && (!be || e > be.e)) be = { e: e, w: s.w, r: s.r };
          if (byW[s.w] == null || s.r > byW[s.w]) byW[s.w] = s.r;
        });
        if (r0) {
          if (hw > 0 && hw > r0.hw) ev.push({ ex: ex, kind: "heaviest", w: hw });
          if (be && be.e > r0.be) ev.push({ ex: ex, kind: "e1rm", e: be.e, w: be.w, r: be.r });
          Object.keys(byW).map(Number).sort(function (a, b) { return b - a; }).forEach(function (wk) {
            if (r0.byW[wk] != null && byW[wk] > r0.byW[wk]) ev.push({ ex: ex, kind: "reps", w: wk, r: byW[wk] });
          });
        } else r0 = run[ex] = { hw: 0, be: 0, byW: {} };
        if (hw > r0.hw) r0.hw = hw;
        if (be && be.e > r0.be) r0.be = be.e;
        Object.keys(byW).forEach(function (wk) { if (r0.byW[wk] == null || byW[wk] > r0.byW[wk]) r0.byW[wk] = byW[wk]; });
      });
      out[w.id] = ev;
    });
    return out;
  }
  function bestText(b) {
    var n = exById(b.ex).name;
    if (b.kind === "heaviest") return n + " · heaviest " + wt(b.w);
    if (b.kind === "e1rm") return n + " · estimated 1RM " + wt(b.e) + " (" + num(b.w) + " × " + b.r + ")";
    return n + " · " + plural(b.r, "rep", "reps") + " at " + (b.w > 0 ? wt(b.w) : "bodyweight");
  }

  // ── the suggestion: from last time's sets and this workout's target ──
  function suggestion(item, last) {
    var S = item.target.sets, R = item.target.reps, ex = exById(item.ex), tg = S + " × " + R;
    if (!last) return { text: "First time for this one. Pick a weight that feels steady for " + tg + "; next time there's a suggestion here." };
    var W = 0;
    last.sets.forEach(function (s) { if (s.w > W) W = s.w; });
    var n = last.sets.filter(function (s) { return s.w === W && s.r >= R; }).length;
    var step = ex.inc != null ? ex.inc : D.settings.inc;
    if (n >= S) {
      if (W > 0) return { text: "Last time you did all " + tg + " at " + wt(W) + ": try " + wt(W + step) + " or " + (R + 1) + " reps.", useW: W + step, useR: R + 1 };
      return { text: "Last time you did all " + tg + ": try " + (R + 1) + " reps.", useR: R + 1 };
    }
    if (W > 0) {
      if (n >= 1) return { text: "Last time you did " + n + " of " + S + " sets of " + R + " at " + wt(W) + ": stay at " + wt(W) + " and aim for all " + tg + ".", useW: W };
      return { text: "Last time at " + wt(W) + " your sets were under " + R + " reps: stay at " + wt(W) + " and aim for all " + tg + ".", useW: W };
    }
    if (n >= 1) return { text: "Last time you did " + n + " of " + S + " sets of " + R + ": aim for all " + tg + "." };
    return { text: "Last time your sets were under " + R + " reps: aim for all " + tg + "." };
  }

  // ── weeks ────────────────────────────────────────────────────────
  function weekStart(n) { var ws = D.settings.weekStart === "Sun" ? 0 : 1; return n - HH.mod(HH.weekday(n) - ws, 7); }
  function weekSum(ws) {
    var list = D.workouts.filter(function (w) { return weekStart(dn(w.date)) === ws; });
    return { n: list.length, sets: list.reduce(function (a, w) { return a + woSets(w); }, 0), vol: list.reduce(function (a, w) { return a + woVol(w); }, 0), list: list };
  }
  function weekLine(s) { return plural(s.n, "workout", "workouts") + " · " + plural(s.sets, "set", "sets") + " · " + wt(s.vol); }

  // ── routines ─────────────────────────────────────────────────────
  function nextRoutine() {
    if (!D.routines.length) return null;
    var ws = ordered();
    for (var i = ws.length - 1; i >= 0; i--) {
      if (ws[i].routine == null) continue;
      var r = byId(D.routines, ws[i].routine), at = D.routines.indexOf(r);
      if (at >= 0) return D.routines[(at + 1) % D.routines.length];
    }
    return D.routines[0];
  }
  function lastDone(r) {
    var ws = ordered().filter(function (w) { return w.routine === r.id; });
    return ws.length ? "last done " + HH.fmtDate(dn(ws[ws.length - 1].date)) : "not done yet";
  }
  function startList() {
    var nx = nextRoutine(), rs = D.routines.slice();
    if (nx) rs = [nx].concat(rs.filter(function (r) { return r !== nx; }));
    return rs.map(function (r) {
      return '<li class="plain"><button type="button" class="rowbtn" data-start-routine="' + r.id + '" data-name="' + esc(r.name) + '"><span class="what"><b>' +
        esc(r.name) + "</b>" + (r === nx ? ' <span class="tag next">Next up</span>' : "") + '<br><span class="small muted">' +
        plural(r.items.length, "exercise", "exercises") + " · " + lastDone(r) + '</span></span><span class="chev" aria-hidden="true">›</span></button></li>';
    }).join("");
  }
  function makeStarters(d, which) {
    (STARTERS[which] || []).forEach(function (r) {
      d.routines.push({ id: d.meta.nextId++, name: r[0], starter: true,
        items: r[1].map(function (x) { return { ex: exByName(d, x[0]).id, sets: x[1], reps: x[2] }; }) });
    });
  }

  // ── rendering ────────────────────────────────────────────────────
  function render() {
    T = HH.today();
    HH.applyTheme(D.settings.theme);
    renderBanners();
    renderHome();
    renderWorkout();
    renderRoutines();
    renderLibrary();
    renderHistory();
    renderProgress();
    if (detailEx != null) renderExd();
    renderBody();
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
      h += '<div class="banner slim" id="sample-banner"><span><span class="sample-flag">SAMPLE</span> · made-up workouts</span>' +
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
    $("#home-date").textContent = HH.fmtDate(T, true);
    var c = D.current;
    $("#home-current").hidden = !c;
    if (c) {
      var ticked = c.items.reduce(function (a, it) { return a + it.sets.filter(function (s) { return s.done; }).length; }, 0);
      $("#home-current-text").textContent = (c.editId != null ? "Changing: " : "In progress: ") + c.name + " · " + plural(ticked, "set", "sets") + " ticked";
    }
    var ws = weekStart(T), s = weekSum(ws);
    $("#wk-workouts").textContent = s.n;
    $("#wk-workouts-word").textContent = s.n === 1 ? "workout" : "workouts";
    $("#wk-sets").textContent = s.sets;
    $("#wk-sets-word").textContent = s.sets === 1 ? "set" : "sets";
    $("#wk-volume").textContent = wt(s.vol);
    $("#home-week-range").textContent = HH.fmtDate(ws) + " to " + HH.fmtDate(ws + 6);
    $("#home-start").innerHTML = startList();
    $("#home-start-none").hidden = D.routines.length > 0;
    var ow = ordered(), last = ow[ow.length - 1];
    $("#home-last").innerHTML = last ? woRow(last, true) : "";
    $("#home-last-none").hidden = !!last;
    var tl = timeline(), bests = [];
    for (var i = ow.length - 1; i >= 0 && bests.length < 5; i--) {
      (tl[ow[i].id] || []).filter(function (b) { return b.kind !== "reps"; }).forEach(function (b) {
        if (bests.length < 5) bests.push('<li class="plain"><span class="what">' + esc(bestText(b)) + '</span><span class="small muted">' + HH.fmtShort(dn(ow[i].date)) + "</span></li>");
      });
    }
    $("#home-bests").innerHTML = bests.join("");
    $("#home-bests-none").hidden = bests.length > 0;
  }
  function woRow(w, withYear) {
    return '<li class="plain"><button type="button" class="rowbtn" data-open-wo="' + w.id + '"><span class="what"><b>' + HH.fmtDate(dn(w.date), withYear) + " · " +
      esc(w.name) + '</b><br><span class="small muted">' + plural(woSets(w), "set", "sets") + " · " + wt(woVol(w)) + mins(w) +
      '</span></span><span class="chev" aria-hidden="true">›</span></button></li>';
  }

  // the log
  function renderWorkout() {
    var c = D.current;
    $("#wo-none").hidden = !!c;
    $("#wo-live").hidden = !c;
    $("#wo-start").innerHTML = startList();
    $("#wo-start-none").hidden = D.routines.length > 0;
    tickRest();
    if (!c) return;
    $("#wo-name").textContent = (c.editId != null ? "Changing: " : "") + c.name;
    $("#wo-date").value = c.date;
    $("#wo-discard").textContent = c.editId != null ? "Stop changing it" : "Discard this workout";
    $("#wo-finish").textContent = c.editId != null ? "Save changes" : "Finish workout";
    renderItems();
  }
  function renderItems() {
    var c = D.current, k = curKey();
    $("#wo-items").innerHTML = c.items.map(function (it, i) { return itemCard(i, k); }).join("");
    $("#wo-items-none").hidden = c.items.length > 0;
    renderSum();
  }
  function renderItem(i, focusSel) {
    var el = $('[data-item="' + i + '"]');
    if (!el) { renderItems(); return; }
    el.outerHTML = itemCard(i, curKey());
    if (focusSel) { var f = $(focusSel); if (f) f.focus(); }
    renderSum();
  }
  function renderSum() {
    var c = D.current;
    if (!c) return;
    var all = 0, done = 0, vol = 0;
    c.items.forEach(function (it) { it.sets.forEach(function (s) { all++; if (s.done) { done++; vol += s.w * s.r; } }); });
    $("#wo-sum").textContent = done + " of " + plural(all, "set", "sets") + " ticked · " + wt(vol) + " so far";
  }
  function itemCard(i, k) {
    var it = D.current.items[i], ex = exById(it.ex), last = lastFor(it.ex, k), sg = suggestion(it, last), u = U();
    var h = '<div class="card ex-card" data-item="' + i + '" data-ex-name="' + esc(ex.name) + '"><div class="ex-head"><h2>' + esc(ex.name) +
      '</h2><span class="muted small">target ' + it.target.sets + " × " + it.target.reps + (ex.equip === "Bodyweight" ? " · bodyweight" : "") + "</span></div>";
    h += '<div class="suggest small" id="sug-' + i + '"><span class="sug-text">' + esc(sg.text) + "</span>";
    if (sg.useW != null || sg.useR != null) {
      h += '<div class="row-buttons mini">' + (sg.useW != null ? '<button type="button" class="btn btn-quiet" data-use-w="' + i + '">Use ' + esc(wt(sg.useW)) + "</button>" : "") +
        (sg.useR != null ? '<button type="button" class="btn btn-quiet" data-use-r="' + i + '">Use ' + sg.useR + " reps</button>" : "") + "</div>";
    }
    h += "</div>";
    h += '<div class="set-head" aria-hidden="true"><span class="h-n">Set</span><span class="h-w">' + u + '</span><span class="h-r">reps</span><span class="h-l">last time</span><span class="h-d">done</span></div>';
    it.sets.forEach(function (s, j) {
      var ls = last ? last.sets[j] : null, id = i + ":" + j;
      h += '<div class="set-row' + (s.done ? " done" : "") + '" data-row="' + id + '"><span class="set-n">' + (j + 1) + "</span>" +
        '<input class="set-w" type="text" inputmode="decimal" autocomplete="off" data-w="' + id + '" value="' + (s.w == null ? "" : num(s.w, true)) +
        '" placeholder="' + u + '" aria-label="Set ' + (j + 1) + " weight in " + u + '">' +
        '<span class="x" aria-hidden="true">×</span>' +
        '<input class="set-r" type="text" inputmode="numeric" autocomplete="off" data-r="' + id + '" value="' + (s.r == null ? "" : s.r) +
        '" placeholder="' + it.target.reps + '" aria-label="Set ' + (j + 1) + ' reps">' +
        '<span class="last small muted" data-last="' + id + '">' + (ls ? "last " + esc(setText(ls)) : "") + "</span>" +
        '<button type="button" class="btn set-done" data-done="' + id + '" aria-pressed="' + s.done + '" aria-label="Set ' + (j + 1) + ' done">✓</button></div>';
    });
    h += '<p class="err" data-item-msg="' + i + '" hidden></p>';
    h += '<div class="row-buttons mini ex-tools"><button type="button" class="btn btn-quiet" data-add-set="' + i + '">+ Add a set</button>' +
      (it.sets.length > 1 ? '<button type="button" class="btn btn-quiet" data-del-set="' + i + '">− Remove a set</button>' : "") +
      '<button type="button" class="btn-link small" data-del-item="' + i + '">Remove exercise</button></div></div>';
    return h;
  }
  function itemMsg(i, text) {
    var el = $('[data-item-msg="' + i + '"]');
    if (!el) return;
    el.textContent = text;
    el.hidden = !text;
  }
  function newItem(exId, target, k) {
    var last = lastFor(exId, k);
    var tg = target ? { sets: target.sets, reps: target.reps } : (last ? { sets: last.target.sets, reps: last.target.reps } : { sets: 3, reps: 10 });
    var sets = [];
    for (var j = 0; j < tg.sets; j++) sets.push({ w: prefillW(last, j), r: null, done: false });
    return { ex: exId, target: tg, sets: sets };
  }
  function prefillW(last, j) {
    if (!last || !last.sets.length) return null;
    return (last.sets[j] || last.sets[last.sets.length - 1]).w;
  }
  function startWorkout(routine) {
    if (D.current) { go("workout"); HH.toast("Finish or discard the workout in progress first."); return; }
    T = HH.today();
    D.current = { editId: null, date: HH.iso(T), start: Date.now(), routine: routine ? routine.id : null, name: routine ? routine.name : "Free workout", items: [] };
    var k = curKey();
    if (routine) routine.items.forEach(function (ri) { D.current.items.push(newItem(ri.ex, { sets: ri.sets, reps: ri.reps }, k)); });
    save();
    go("workout");
  }
  function toggleDone(i, j) {
    var c = D.current, it = c.items[i], s = it.sets[j], ex = exById(it.ex), id = i + ":" + j;
    itemMsg(i, "");
    if (s.done) { s.done = false; save(); renderItem(i, '[data-done="' + id + '"]'); return; }
    var w = parseNum($('[data-w="' + id + '"]').value), r = parseReps($('[data-r="' + id + '"]').value);
    if (w === undefined) {
      if (ex.equip === "Bodyweight") w = 0;
      else { itemMsg(i, "Type the weight for set " + (j + 1) + " first (0 if there's no weight)."); $('[data-w="' + id + '"]').focus(); return; }
    }
    if (isNaN(w)) { itemMsg(i, "Weight for set " + (j + 1) + ": a number like 62.5."); $('[data-w="' + id + '"]').focus(); return; }
    if (r === undefined) r = it.target.reps;
    if (isNaN(r)) { itemMsg(i, "Reps for set " + (j + 1) + ": a whole number from 1 to 100."); $('[data-r="' + id + '"]').focus(); return; }
    s.w = w; s.r = r; s.done = true;
    save();
    renderItem(i, '[data-done="' + id + '"]');
    if (D.settings.autoRest) startRest(true);
  }
  function onSetInput(t) {
    var isWt = t.hasAttribute("data-w"), p = t.getAttribute(isWt ? "data-w" : "data-r").split(":"), i = +p[0], j = +p[1];
    var c = D.current;
    if (!c || !c.items[i] || !c.items[i].sets[j]) return;
    var s = c.items[i].sets[j], v = isWt ? parseNum(t.value) : parseReps(t.value);
    if (v === undefined) { if (isWt) s.w = null; else s.r = null; }
    else if (!isNaN(v)) { if (isWt) s.w = v; else s.r = v; }
    if (s.done && (v === undefined || isNaN(v))) {
      s.done = false;
      var row = $('[data-row="' + i + ":" + j + '"]');
      if (row) { row.classList.remove("done"); $('[data-done="' + i + ":" + j + '"]').setAttribute("aria-pressed", "false"); }
    }
    save();
    renderSum();
  }
  function finishWorkout() {
    var c = D.current;
    $("#wo-msg").hidden = true;
    var items = c.items.map(function (it) {
      return { ex: it.ex, target: { sets: it.target.sets, reps: it.target.reps },
               sets: it.sets.filter(function (s) { return s.done; }).map(function (s) { return { w: s.w, r: s.r }; }) };
    }).filter(function (it) { return it.sets.length; });
    if (!items.length) {
      $("#wo-msg").textContent = "Tick at least one set before you finish, or discard this workout.";
      $("#wo-msg").hidden = false;
      return;
    }
    var w, edit = c.editId != null;
    if (edit) {
      w = byId(D.workouts, c.editId);
      w.date = c.date; w.items = items;
    } else {
      w = { id: newId(), date: c.date, start: c.start, end: Date.now(), routine: c.routine, name: c.name, items: items };
      D.workouts.push(w);
    }
    D.current = null;
    D.timer = null;
    save();
    showSaved(w, edit);
  }
  function showSaved(w, edit) {
    var ev = timeline()[w.id] || [];
    $("#sv-title").textContent = edit ? "Workout updated" : "Workout saved";
    $("#sv-stats").textContent = w.name + " · " + HH.fmtDate(dn(w.date), true) + " · " + plural(woSets(w), "set", "sets") + " · " + wt(woVol(w)) + mins(w);
    $("#sv-bests").innerHTML = ev.map(function (b) { return '<li class="plain"><span class="what">' + esc(bestText(b)) + "</span></li>"; }).join("");
    $("#sv-bests-none").hidden = ev.length > 0;
    detailWo = w.id;
    go("saved");
  }
  function discardWorkout() {
    var edit = D.current.editId != null;
    HH.confirmStep({
      title: edit ? "Stop changing this workout?" : "Discard this workout?", yes: edit ? "Stop, keep it as it was" : "Discard it", no: "Keep going", danger: !edit,
      text: edit ? "Your changes go. The saved workout stays as it was." : "The sets you've typed in this workout go. Saved workouts aren't touched.",
      onYes: function () { D.current = null; D.timer = null; save(); go(edit ? "history" : "home"); }
    });
  }
  function editWorkout(w) {
    if (D.current) { $("#wd-msg").textContent = "Finish or discard the workout in progress first."; $("#wd-msg").hidden = false; return; }
    D.current = { editId: w.id, date: w.date, start: w.start, routine: w.routine, name: w.name,
      items: w.items.map(function (it) { return { ex: it.ex, target: { sets: it.target.sets, reps: it.target.reps }, sets: it.sets.map(function (s) { return { w: s.w, r: s.r, done: true }; }) }; }) };
    save();
    go("workout");
  }

  // the rest timer: from the start stamp, never a ticking counter
  function restState(now) {
    var t = D.timer;
    if (!t) return { st: "idle", left: D.settings.restSec * 1000 };
    var el = (t.pausedAt != null ? t.pausedAt : now) - t.start - t.pausedTotal, left = t.dur - el;
    if (left <= 0) {
      if (!t.beeped) { t.beeped = true; save(); if (D.settings.sound) beep(); }
      return { st: "over", left: 0 };
    }
    return { st: t.pausedAt != null ? "paused" : "running", left: left };
  }
  function startRest(fresh) {
    var t = D.timer, st = restState(Date.now()).st;
    if (fresh || !t || st === "over" || st === "idle") D.timer = { start: Date.now(), dur: D.settings.restSec * 1000, pausedAt: null, pausedTotal: 0, beeped: false };
    else if (t.pausedAt != null) { t.pausedTotal += Date.now() - t.pausedAt; t.pausedAt = null; }
    save();
    tickRest();
  }
  function tickRest() {
    var s = restState(Date.now());
    $("#rest-time").textContent = mmss(s.left);
    $("#rest-state").textContent = s.st === "idle" ? "Rest" : s.st === "running" ? "Resting" : s.st === "paused" ? "Paused" : "Rest over";
    $("#rest").classList.toggle("over", s.st === "over");
    $("#rest-start").hidden = s.st === "running";
    $("#rest-start").textContent = s.st === "paused" ? "Continue" : s.st === "over" ? "Start again" : "Start rest";
    $("#rest-pause").hidden = s.st !== "running";
    $("#rest-minus").hidden = $("#rest-plus").hidden = !(s.st === "running" || s.st === "paused");
    $("#rest-reset").hidden = s.st === "idle";
    if (s.st === "running" && !restTimer) restTimer = setInterval(tickRest, 250);
    if (s.st !== "running" && restTimer) { clearInterval(restTimer); restTimer = null; }
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

  // routines and the library
  function renderRoutines() {
    $("#routine-list").innerHTML = D.routines.map(function (r) {
      return '<li class="plain"><button type="button" class="rowbtn" data-edit-routine="' + r.id + '" data-name="' + esc(r.name) + '"><span class="what"><b>' + esc(r.name) +
        '</b><br><span class="small muted">' + (r.items.length ? r.items.map(function (x) { return esc(exById(x.ex).name) + " " + x.sets + " × " + x.reps; }).join(" · ") : "no exercises yet") +
        '</span></span><span class="chev" aria-hidden="true">›</span></button></li>';
    }).join("");
    $("#routine-none").hidden = D.routines.length > 0;
    $("#lib-count").textContent = plural(D.exercises.filter(function (e) { return !e.gone; }).length, "exercise", "exercises");
    if (draft) renderDraft();
  }
  function renderDraft() {
    $("#re-title").textContent = draft.id ? "Change routine" : "Add a routine";
    $("#re-name").value = draft.name;
    $("#re-delete").hidden = !draft.id;
    var n = draft.items.length;
    $("#re-items").innerHTML = draft.items.map(function (x, k) {
      var name = exById(x.ex).name, opts = "";
      for (var s = 1; s <= 10; s++) opts += "<option" + (s === x.sets ? " selected" : "") + ">" + s + "</option>";
      return '<li class="plain re-item" data-k="' + k + '" data-ex-name="' + esc(name) + '"><span class="what"><b>' + (k + 1) + ". " + esc(name) + "</b></span>" +
        '<span class="re-target"><label class="sr" for="re-sets-' + k + '">Sets for ' + esc(name) + '</label><select id="re-sets-' + k + '" data-sets="' + k + '">' + opts +
        '</select><span class="x" aria-hidden="true">×</span><label class="sr" for="re-reps-' + k + '">Reps for ' + esc(name) + '</label><input id="re-reps-' + k +
        '" data-reps="' + k + '" type="text" inputmode="numeric" autocomplete="off" value="' + x.reps + '"><span class="small muted">reps</span></span>' +
        '<span class="row-buttons mini">' + (k > 0 ? '<button type="button" class="btn btn-quiet" data-up="' + k + '" aria-label="Move ' + esc(name) + ' up">↑</button>' : "") +
        (k < n - 1 ? '<button type="button" class="btn btn-quiet" data-down="' + k + '" aria-label="Move ' + esc(name) + ' down">↓</button>' : "") +
        '<button type="button" class="btn-link small" data-rm="' + k + '">Remove</button></span></li>';
    }).join("");
    $("#re-items-none").hidden = n > 0;
  }
  function openRoutineEdit(r) {
    draft = r ? { id: r.id, name: r.name, items: r.items.map(function (x) { return { ex: x.ex, sets: x.sets, reps: x.reps }; }) } : { id: null, name: "", items: [] };
    $("#re-err").hidden = true;
    go("routine-edit");
  }
  function saveRoutine() {
    var name = $("#re-name").value.trim().slice(0, 40), err = "";
    draft.name = name;
    if (!name) err = "Give the routine a name, such as Push.";
    else if (!draft.items.length) err = "Add at least one exercise.";
    else if (draft.items.some(function (x) { return !(x.reps >= 1 && x.reps <= 100); })) err = "Reps: a whole number from 1 to 100 for each exercise.";
    if (err) { $("#re-err").textContent = err; $("#re-err").hidden = false; return; }
    var r = draft.id ? byId(D.routines, draft.id) : null;
    if (r) { r.name = name; r.items = draft.items; delete r.starter; }
    else { r = { id: newId(), name: name, items: draft.items }; D.routines.push(r); }
    draft = null;
    save();
    go("routines");
    HH.toast("Saved " + name);
  }
  function deleteRoutine() {
    var r = byId(D.routines, draft.id), i = D.routines.indexOf(r);
    if (i < 0) return;
    D.routines.splice(i, 1);
    draft = null;
    save();
    go("routines");
    HH.toast("Removed " + r.name + ". Its workouts stay in History.", function () { D.routines.splice(i, 0, r); save(); render(); });
  }
  function exList(q, group) {
    q = (q || "").trim().toLowerCase();
    return D.exercises.filter(function (e) {
      return !e.gone && (group === "All" || e.group === group) && (!q || e.name.toLowerCase().indexOf(q) >= 0);
    }).sort(function (a, b) { return GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) || (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1); });
  }
  function exRows(list, attr, mark) {
    var h = "", g = null;
    list.forEach(function (e) {
      if (e.group !== g) { g = e.group; h += '<li class="lib-group" aria-hidden="true">' + esc(g) + "</li>"; }
      h += '<li class="plain"><button type="button" class="rowbtn" ' + attr + '="' + e.id + '" data-name="' + esc(e.name) + '"><span class="what"><b>' + esc(e.name) +
        '</b><br><span class="small muted">' + esc(e.group) + " · " + esc(e.equip) + (e.inc != null ? " · steps of " + esc(wt(e.inc)) : "") +
        '</span></span><span class="chev" aria-hidden="true">' + mark + "</span></button></li>";
    });
    return h;
  }
  function groupChips(name, cur) {
    return ["All"].concat(GROUPS).map(function (g) {
      return '<label class="chip"><input type="radio" name="' + name + '" value="' + g + '"' + (g === cur ? " checked" : "") + "><span>" + g + "</span></label>";
    }).join("");
  }
  function renderLibrary() {
    var list = exList($("#lib-search").value, libGroup);
    $("#lib-list").innerHTML = exRows(list, "data-edit-ex", "›");
    $("#lib-none").hidden = list.length > 0;
  }
  function renderPick() {
    var list = exList($("#pick-search").value, pickGroup);
    $("#pick-list").innerHTML = exRows(list, "data-pick", "+");
    $("#pick-none").hidden = list.length > 0;
  }
  function openPick(forWhat) {
    pickFor = forWhat;
    $("#pick-search").value = "";
    pickGroup = "All";
    $("#pick-groups").innerHTML = groupChips("pick-group", pickGroup);
    $("#pick-title").textContent = forWhat === "routine" ? "Add to the routine" : "Add to this workout";
    renderPick();
    go("pick");
  }
  function pickExercise(id) {
    if (pickFor === "routine" && draft) {
      draft.items.push({ ex: id, sets: 3, reps: 10 });
      go("routine-edit");
    } else if (D.current) {
      D.current.items.push(newItem(id, null, curKey()));
      save();
      go("workout");
      var el = $('[data-item="' + (D.current.items.length - 1) + '"]');
      if (el && el.scrollIntoView) el.scrollIntoView({ block: "center" });
    } else go("home");
    pickFor = null;
  }
  function openExEdit(e, back) {
    editingEx = e || null;
    exReturn = back;
    $("#ex-title").textContent = e ? "Change exercise" : "Add an exercise";
    $("#ex-name").value = e ? e.name : "";
    $("#ex-group").innerHTML = GROUPS.map(function (g) { return "<option" + (e && e.group === g ? " selected" : "") + ">" + g + "</option>"; }).join("");
    $("#ex-equip").innerHTML = EQUIP.map(function (g) { return "<option" + (e && e.equip === g ? " selected" : "") + ">" + g + "</option>"; }).join("");
    if (!e && pickFor && pickGroup !== "All") $("#ex-group").value = pickGroup;
    $("#ex-inc").value = e && e.inc != null ? num(e.inc, true) : "";
    $("#ex-inc-hint").textContent = "Optional, in " + U() + ". Leave blank to use the step in Settings (" + wt(D.settings.inc) + ").";
    $("#ex-err").hidden = true;
    $("#ex-delete").hidden = !e;
    go("ex-edit");
  }
  function saveEx(ev) {
    ev.preventDefault();
    var name = $("#ex-name").value.trim().slice(0, 40), inc = parseNum($("#ex-inc").value), err = "";
    var clash = D.exercises.filter(function (x) { return !x.gone && x !== editingEx && x.name.toLowerCase() === name.toLowerCase(); })[0];
    if (!name) err = "Give the exercise a name, such as Sled push.";
    else if (clash) err = "You already have " + clash.name + " in the list.";
    else if (inc !== undefined && (isNaN(inc) || inc <= 0)) err = "Step up by: a number more than 0, like 2.5, or leave it blank.";
    if (err) { $("#ex-err").textContent = err; $("#ex-err").hidden = false; return; }
    var e = editingEx || { id: newId(), builtIn: false, gone: false };
    e.name = name; e.group = $("#ex-group").value; e.equip = $("#ex-equip").value; e.inc = inc === undefined ? null : inc;
    if (!editingEx) D.exercises.push(e);
    save();
    HH.toast((editingEx ? "Changed " : "Added ") + name);
    editingEx = null;
    if (exReturn === "pick") { pickExercise(e.id); return; }
    go(exReturn === "exd" ? "exd" : "library");
  }
  function exUsed(id) {
    var inW = function (w) { return w.items.some(function (it) { return it.ex === id; }); };
    return D.workouts.some(inW) || (D.current && inW(D.current)) || D.routines.some(function (r) { return r.items.some(function (x) { return x.ex === id; }); });
  }
  function deleteEx() {
    var e = editingEx;
    if (!e) return;
    editingEx = null;
    if (exUsed(e.id)) {
      e.gone = true;
      save();
      go("library");
      HH.toast(e.name + " is in your routines or history, so it stays there. It's hidden from the lists now.", function () { e.gone = false; save(); render(); }, 7000);
    } else {
      var i = D.exercises.indexOf(e);
      D.exercises.splice(i, 1);
      save();
      go("library");
      HH.toast("Removed " + e.name, function () { D.exercises.splice(i, 0, e); save(); render(); });
    }
  }

  // history, progress, body
  function renderHistory() {
    var ws0 = weekStart(T), rows = [], max = 0, sums = [];
    for (var k = 7; k >= 0; k--) { var s = weekSum(ws0 - 7 * k); s.ws = ws0 - 7 * k; sums.push(s); if (s.vol > max) max = s.vol; }
    sums.reverse().forEach(function (s) {
      var pct = max ? Math.max(s.vol ? 2 : 0, Math.round(s.vol / max * 100)) : 0;
      rows.push('<li class="' + (s.ws === ws0 ? "now" : "") + '" data-week="' + HH.iso(s.ws) + '"><span class="b-lab">' + (s.ws === ws0 ? "This week" : "Week of " + HH.fmtShort(s.ws)) +
        ' <span class="small muted">· ' + plural(s.n, "workout", "workouts") + '</span></span><span class="b-val">' + wt(s.vol) +
        '</span><span class="bar" aria-hidden="true"><i style="width:' + pct + '%"></i></span></li>');
    });
    $("#hist-bars").innerHTML = rows.join("");
    var groups = {}, keys = [];
    ordered().reverse().forEach(function (w) {
      var ws = weekStart(dn(w.date));
      if (!groups[ws]) { groups[ws] = []; keys.push(ws); }
      groups[ws].push(w);
    });
    $("#hist-list").innerHTML = keys.map(function (ws) {
      return '<li class="week" data-week-group="' + HH.iso(ws) + '"><div class="wk-head"><b>Week of ' + HH.fmtLong(ws) + '</b><span class="small muted wk-sum">' +
        weekLine(weekSum(ws)) + '</span></div><ul class="list">' + groups[ws].map(function (w) { return woRow(w, false); }).join("") + "</ul></li>";
    }).join("");
    $("#hist-none").hidden = keys.length > 0;
  }
  function renderWo(w) {
    $("#wd-title").textContent = w.name;
    $("#wd-stats").textContent = HH.fmtDate(dn(w.date), true) + " · " + plural(woSets(w), "set", "sets") + " · " + wt(woVol(w)) + mins(w);
    $("#wd-items").innerHTML = w.items.map(function (it) {
      return '<div class="card flat wd-ex" data-ex-name="' + esc(exById(it.ex).name) + '"><h2>' + esc(exById(it.ex).name) + '</h2><ul class="list setlist">' +
        it.sets.map(function (s, j) {
          var e = e1rm(s.w, s.r);
          return '<li class="plain"><span>Set ' + (j + 1) + " · " + (s.w > 0 ? wt(s.w) + " × " + s.r : plural(s.r, "rep", "reps")) + '</span><span class="small muted" data-e1rm="' +
            (e ? num(e, true) : "") + '">' + (e ? "est. 1RM " + wt(e) : "") + "</span></li>";
        }).join("") + '</ul><p class="small muted" style="margin:6px 0 0">Volume ' + wt(setsVol(it.sets)) + "</p></div>";
    }).join("");
    $("#wd-msg").hidden = true;
  }
  function renderProgress() {
    var rows = D.exercises.map(function (e) { var st = stats(e.id, ordered()); return { e: e, st: st }; }).filter(function (x) { return x.st.sessions.length; });
    rows.sort(function (a, b) { return cmpKey(key(b.st.sessions[b.st.sessions.length - 1].wo), key(a.st.sessions[a.st.sessions.length - 1].wo)) || (a.e.name < b.e.name ? -1 : 1); });
    $("#prog-list").innerHTML = rows.map(function (x) {
      var st = x.st, bits = [];
      if (st.heaviest) bits.push("Heaviest " + wt(st.heaviest.w));
      if (st.best) bits.push("Best est. 1RM " + wt(st.best.e));
      if (st.most) bits.push("Most reps " + st.most.r + (st.most.w > 0 ? " at " + wt(st.most.w) : " (bodyweight)"));
      return '<li class="plain"><button type="button" class="rowbtn" data-open-ex="' + x.e.id + '" data-name="' + esc(x.e.name) + '"><span class="what"><b>' + esc(x.e.name) +
        '</b><br><span class="small muted prog-line">' + bits.join(" · ") + '</span></span><span class="chev" aria-hidden="true">›</span></button></li>';
    }).join("");
    $("#prog-none").hidden = rows.length > 0;
  }
  function renderExd() {
    var e = exById(detailEx), st = stats(e.id, ordered());
    $("#xd-title").textContent = e.name;
    $("#xd-meta").textContent = e.group + " · " + e.equip + " · " + plural(st.sessions.length, "workout", "workouts") + (e.gone ? " · hidden from the lists" : "");
    $("#xd-heaviest").textContent = st.heaviest ? wt(st.heaviest.w) : "bodyweight";
    $("#xd-heaviest-when").textContent = st.heaviest ? "first on " + HH.fmtDate(st.heaviest.date, true) : "";
    $("#xd-best").textContent = st.best ? wt(st.best.e) : "no weighted sets yet";
    $("#xd-best-when").textContent = st.best ? "from " + num(st.best.w) + " × " + st.best.r + " · " + HH.fmtDate(st.best.date, true) : "";
    $("#xd-most").textContent = st.most ? plural(st.most.r, "rep", "reps") + (st.most.w > 0 ? " at " + wt(st.most.w) : " (bodyweight)") : "";
    $("#xd-most-when").textContent = st.most ? HH.fmtDate(st.most.date, true) : "";
    $("#xd-weights").innerHTML = st.weights.map(function (x) {
      return '<li class="plain" data-w="' + num(x.w, true) + '"><span class="what"><b>' + (x.w > 0 ? wt(x.w) : "Bodyweight") + "</b> · " + plural(x.r, "rep", "reps") +
        '</span><span class="small muted">' + HH.fmtDate(x.date, true) + "</span></li>";
    }).join("");
    var ses = st.sessions.filter(function (s) { return s.best; }).slice(-12), max = 0;
    ses.forEach(function (s) { if (s.best.e > max) max = s.best.e; });
    $("#xd-e1rm").innerHTML = ses.length ? ses.map(function (s) {
      return '<li><span class="b-lab">' + HH.fmtShort(s.date) + ' <span class="small muted">· ' + num(s.best.w) + " × " + s.best.r + '</span></span><span class="b-val">' + wt(s.best.e) +
        '</span><span class="bar" aria-hidden="true"><i style="width:' + Math.round(s.best.e / max * 100) + '%"></i></span></li>';
    }).join("") : '<li class="plain muted small">No weighted sets yet.</li>';
    $("#xd-sessions").innerHTML = st.sessions.slice(-8).reverse().map(function (s) {
      return '<li class="plain"><span class="what"><b>' + HH.fmtDate(s.date, true) + "</b><br>" + s.sets.map(setText).map(esc).join(", ") + "</span></li>";
    }).join("");
  }
  function bodySorted() { return D.body.slice().sort(function (a, b) { return (dn(a.date) - dn(b.date)) || (a.id - b.id); }); }
  function changeText(m, v, prev) {
    if (!prev) return "first entry";
    var dl = v - prev.v, when = dshort(dn(prev.date));
    return dl > 0 ? "up " + num(dl) + " " + m.unit + " since " + when : dl < 0 ? "down " + num(-dl) + " " + m.unit + " since " + when : "same as " + when;
  }
  function bodyChanges() {                      // {entryId: {measureId: text}} and the latest per measure
    var prev = {}, out = {}, latest = {};
    bodySorted().forEach(function (b) {
      out[b.id] = {};
      D.measures.forEach(function (m) {
        if (b.vals[m.id] == null) return;
        var v = b.vals[m.id];
        out[b.id][m.id] = changeText(m, v, prev[m.id]);
        latest[m.id] = { v: v, text: out[b.id][m.id], date: b.date };
        prev[m.id] = { v: v, date: b.date };
      });
    });
    return { byEntry: out, latest: latest };
  }
  function renderBody() {
    var ch = bodyChanges(), lat = [];
    D.measures.forEach(function (m) {
      var l = ch.latest[m.id];
      if (!l) return;
      lat.push('<li class="plain" data-measure="' + m.id + '" data-name="' + esc(m.name) + '"><span class="what"><b>' + esc(m.name) + "</b> <span class=\"lv\">" + num(l.v) + " " + esc(m.unit) +
        '</span><br><span class="small muted">' + HH.fmtShort(dn(l.date)) + ' · </span><span class="small change">' + esc(l.text) + "</span></span></li>");
    });
    $("#body-latest").innerHTML = lat.join("");
    $("#body-latest-none").hidden = lat.length > 0;
    var list = bodySorted().reverse();
    $("#body-list").innerHTML = list.map(function (b) {
      var vals = D.measures.filter(function (m) { return b.vals[m.id] != null; }).map(function (m) {
        return '<span class="bv" data-mv="' + m.id + '">' + esc(m.name) + " " + num(b.vals[m.id]) + " " + esc(m.unit) + ' <span class="muted">(' + esc(ch.byEntry[b.id][m.id]) + ")</span></span>";
      });
      return '<li class="plain"><button type="button" class="rowbtn" data-edit-entry="' + b.id + '" data-date="' + b.date + '"><span class="what"><b>' + HH.fmtDate(dn(b.date), true) +
        '</b><br><span class="small">' + vals.join("<br>") + "</span>" + (b.note ? '<br><span class="small muted">' + esc(b.note) + "</span>" : "") +
        '</span><span class="chev" aria-hidden="true">›</span></button></li>';
    }).join("");
    $("#body-list-none").hidden = list.length > 0;
  }
  function openBodyEdit(b) {
    editingBody = b || null;
    $("#be-title").textContent = b ? "Change measurements" : "Add measurements";
    $("#be-date").value = b ? b.date : HH.iso(T);
    $("#be-fields").innerHTML = D.measures.map(function (m) {
      return '<div class="be-field"><label for="be-m-' + m.id + '">' + esc(m.name) + ' <span class="hint">' + esc(m.unit) + '</span></label><input id="be-m-' + m.id +
        '" data-mv="' + m.id + '" data-name="' + esc(m.name) + '" type="text" inputmode="decimal" autocomplete="off" value="' + (b && b.vals[m.id] != null ? num(b.vals[m.id], true) : "") + '"></div>';
    }).join("") || '<p class="muted small">No measurements in your list. Use "Change what you measure" first.</p>';
    $("#be-note").value = b ? b.note : "";
    $("#be-err").hidden = true;
    $("#be-delete").hidden = !b;
    go("body-edit");
  }
  function saveBody(ev) {
    ev.preventDefault();
    var date = HH.parseIso($("#be-date").value), vals = {}, bad = null, n = 0;
    $$("#be-fields [data-mv]").forEach(function (inp) {
      var v = parseNum(inp.value);
      if (v === undefined) return;
      if (isNaN(v)) { bad = bad || inp.getAttribute("data-name"); return; }
      vals[inp.getAttribute("data-mv")] = v; n++;
    });
    var err = date == null ? "Pick a date." : bad ? bad + ": a number like 79.5." : !n ? "Type at least one measurement." : "";
    if (err) { $("#be-err").textContent = err; $("#be-err").hidden = false; return; }
    var b = editingBody || { id: newId() };
    b.date = HH.iso(date); b.vals = vals; b.note = $("#be-note").value.trim().slice(0, 80);
    if (!editingBody) D.body.push(b);
    editingBody = null;
    save();
    go("body");
    HH.toast("Saved");
  }
  function deleteBody() {
    var b = editingBody, i = D.body.indexOf(b);
    if (i < 0) return;
    D.body.splice(i, 1);
    editingBody = null;
    save();
    go("body");
    HH.toast("Removed the " + HH.fmtShort(dn(b.date)) + " entry", function () { D.body.splice(i, 0, b); save(); render(); });
  }
  function renderMeasures() {
    $("#ms-list").innerHTML = msDraft.map(function (m, k) {
      return '<li class="plain"><div class="ms-row"><div><label for="ms-n-' + k + '">Measurement</label><input id="ms-n-' + k + '" data-ms-name="' + k +
        '" type="text" maxlength="30" autocomplete="off" value="' + esc(m.name) + '"></div><div><label for="ms-u-' + k + '">Unit</label><input id="ms-u-' + k +
        '" data-ms-unit="' + k + '" type="text" maxlength="8" autocomplete="off" value="' + esc(m.unit) + '"></div><button type="button" class="btn btn-quiet ms-rm" data-ms-rm="' + k +
        '">Remove</button></div></li>';
    }).join("") || '<li class="plain muted small">Nothing in the list. Add a measurement.</li>';
  }
  function openMeasures() {
    msDraft = D.measures.map(function (m) { return { id: m.id, name: m.name, unit: m.unit }; });
    $("#ms-err").hidden = true;
    renderMeasures();
    go("measures");
  }
  function saveMeasures() {
    var names = {}, err = "";
    msDraft.forEach(function (m) {
      m.name = m.name.trim().slice(0, 30); m.unit = m.unit.trim().slice(0, 8);
      if (!m.name || !m.unit) err = err || "Each measurement needs a name and a unit, such as Waist and cm.";
      else if (names[m.name.toLowerCase()]) err = err || "You have " + m.name + " twice.";
      names[m.name.toLowerCase()] = true;
    });
    if (err) { $("#ms-err").textContent = err; $("#ms-err").hidden = false; return; }
    var keep = {};
    msDraft.forEach(function (m) { if (m.id == null) m.id = newId(); keep[m.id] = true; });
    D.measures = msDraft.map(function (m) { return { id: m.id, name: m.name, unit: m.unit }; });
    D.body.forEach(function (b) { for (var k in b.vals) if (!keep[k]) delete b.vals[k]; });
    D.body = D.body.filter(function (b) { return Object.keys(b.vals).length > 0; });
    msDraft = null;
    save();
    go("body");
    HH.toast("Saved your list");
  }

  // settings
  function renderSettings() {
    var s = D.settings;
    $$('input[name="unit"]').forEach(function (r) { r.checked = r.value === s.unit; });
    $$('input[name="theme"]').forEach(function (r) { r.checked = r.value === s.theme; });
    $$('input[name="weekstart"]').forEach(function (r) { r.checked = r.value === s.weekStart; });
    $("#set-inc").value = num(s.inc, true);
    $("#set-inc-hint").textContent = "In " + s.unit + ". The weight the suggestion adds when you've done every set.";
    $("#set-rest").value = s.restSec;
    $("#set-autorest").checked = s.autoRest;
    $("#set-sound").checked = s.sound;
    $("#last-backup").textContent = D.meta.lastBackup ? "Last backup: " + HH.fmtLong(HH.parseIso(D.meta.lastBackup)) : "No backup made yet.";
    $("#sample-state").textContent = D.meta.sample ? "Sample entries are on: every workout and measurement in the app is made up." :
      "Sample entries are off. You can load four weeks of made-up workouts to look around while the app is empty.";
    $("#sample-btn").textContent = D.meta.sample ? "Clear the sample entries" : "Load sample entries";
  }
  function conv(h, from) { return from === "kg" ? Math.round(h / LB) : Math.round(h * LB); }
  function convertAll(from, to) {
    var cw = function (s) { if (s.w != null) s.w = conv(s.w, from); };
    D.workouts.forEach(function (w) { w.items.forEach(function (it) { it.sets.forEach(cw); }); });
    if (D.current) D.current.items.forEach(function (it) { it.sets.forEach(cw); });
    D.exercises.forEach(function (e) { if (e.inc != null) e.inc = Math.max(1, conv(e.inc, from)); });
    D.measures.forEach(function (m) {
      if (m.unit !== from) return;
      D.body.forEach(function (b) { if (b.vals[m.id] != null) b.vals[m.id] = conv(b.vals[m.id], from); });
      m.unit = to;
    });
    D.settings.unit = to;
    D.settings.inc = to === "kg" ? 250 : 500;
  }
  function changeUnit(to) {
    var from = D.settings.unit;
    if (to === from) return;
    var apply = function () { convertAll(from, to); save(); render(); HH.toast("Weights are now in " + to + "."); };
    if (!D.workouts.length && !D.current && !D.body.length) { apply(); return; }
    HH.confirmStep({
      title: "Change to " + (to === "lb" ? "pounds" : "kilograms") + "?", yes: "Change and convert", no: "Keep " + from,
      text: "Every weight you've logged is converted: " + (from === "kg" ? "100 kg becomes 220.46 lb" : "100 lb becomes 45.36 kg") +
        ". The step up goes to " + (to === "kg" ? "2.5 kg" : "5 lb") + ", and you can change it after.",
      onYes: apply, onNo: function () { renderSettings(); }
    });
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
    incDirty = false;
    $$('input[name="w-unit"]').forEach(function (r) { r.checked = r.value === D.settings.unit; });
    $("#w-inc").value = num(D.settings.inc, true);
    $("#w-err1").hidden = true;
    welcomeStep(1);
  }

  // ── sample ───────────────────────────────────────────────────────
  function loadSample() {
    var t = HH.today(), old = D ? D.settings : null, d = blank(old ? old.unit : "kg");
    if (old) d.settings = JSON.parse(JSON.stringify(old));
    var lb = d.settings.unit === "lb";
    var w = function (kg) { return lb ? Math.round(kg * 2.2 / 5) * 500 : Math.round(kg * 100); };
    STARTERS.ppl.forEach(function (r) {
      d.routines.push({ id: d.meta.nextId++, name: r[0], sample: true, items: r[1].map(function (x) { return { ex: exByName(d, x[0]).id, sets: x[1], reps: x[2] }; }) });
    });
    SAMPLE_DAYS.forEach(function (ago, i) {
      var r = d.routines[i % 3], k = Math.floor(i / 3), day = t - ago, a = HH.ymd(day);
      var start = new Date(a.y, a.m - 1, a.d, 17, 30 + (i % 3) * 10).getTime(), dur = (46 + (i * 7) % 15) * 60000;
      var items = r.items.map(function (ri) {
        var plan = SAMPLE_W[byId(d.exercises, ri.ex).name][k];
        return { ex: ri.ex, target: { sets: ri.sets, reps: ri.reps }, sets: plan[1].map(function (rep) { return { w: w(plan[0]), r: rep }; }) };
      });
      d.workouts.push({ id: d.meta.nextId++, date: HH.iso(day), start: start, end: start + dur, routine: r.id, name: r.name, items: items, sample: true });
    });
    SAMPLE_BODY.days.forEach(function (ago, k) {
      var vals = {};
      d.measures.forEach(function (m) {
        var v = SAMPLE_BODY[m.name];
        if (!v) return;
        vals[m.id] = m.name === "Body weight" && lb ? Math.round(v[k] * 22) * 10 : Math.round(v[k] * 100);
      });
      d.body.push({ id: d.meta.nextId++, date: HH.iso(t - ago), vals: vals, note: k === 0 ? "Morning, before breakfast" : "", sample: true });
    });
    d.meta.sample = true;
    d.meta.onboarded = true;
    D = d;
    save();
    go("home");
    HH.toast("Sample workouts loaded. Clear them any time.", null, 4000);
  }
  function clearSample() {
    var keep = JSON.parse(JSON.stringify(D));
    keep.routines = keep.routines.filter(notSample);
    keep.workouts = keep.workouts.filter(notSample);
    keep.body = keep.body.filter(notSample);
    keep.meta.sample = false;
    D = keep;
    detailEx = null; detailWo = null; draft = null;
    if (hasOwn()) { save(); go("home"); return; }
    D.meta.onboarded = false;
    save();
    startWelcome();
  }

  // ── settings, backup, restore ────────────────────────────────────
  function backup() {
    T = HH.today();
    D.meta.lastBackup = HH.iso(T);
    D.meta.reminderDismissed = null;
    save();
    var name = "hollowayhart-workout-app-backup-" + HH.iso(T) + ".json";
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
      var d = r.data;
      restoreMsg('<div class="banner" id="restore-summary"><strong>This backup has</strong>' + plural(d.workouts.length, "workout", "workouts") + " · " +
        plural(d.routines.length, "routine", "routines") + " · " + plural(d.body.length, "body entry", "body entries") +
        (r.made != null ? " · made " + HH.fmtLong(r.made) : "") +
        '<p class="small" style="margin-top:6px">Restoring replaces everything in the app now.</p>' +
        '<div class="row-buttons"><button type="button" class="btn btn-primary" id="restore-yes">Replace with this backup</button>' +
        '<button type="button" class="btn btn-quiet" id="restore-no">Cancel</button></div></div>');
      $("#restore-yes").addEventListener("click", function () {
        D = pendingRestore; pendingRestore = null;
        detailEx = null; detailWo = null; draft = null;
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
      title: "Start fresh?", yes: "Next", no: "Keep my workouts",
      text: "This deletes your workouts, routines, own exercises and measurements from this browser. If you might want them again, cancel and use Back up now first.",
      onYes: function () {
        HH.confirmStep({
          title: "Delete everything now?", yes: "Yes, delete everything", no: "Cancel", danger: true,
          text: "This can't be undone without a backup.",
          onYes: function () {
            var theme = D.settings.theme;
            D = blank("kg"); D.settings.theme = theme;
            detailEx = null; detailWo = null; draft = null;
            save();
            startWelcome();
            HH.toast("Everything was deleted. Starting fresh.");
          }
        });
      }
    });
  }
  function go(id) {
    render();
    HH.show(id);
    $("#tabs").hidden = id === "welcome";
  }

  // ── wiring ───────────────────────────────────────────────────────
  function wire() {
    $$("[data-nav]").forEach(function (b) { b.addEventListener("click", function () { go(b.getAttribute("data-nav")); }); });
    $("#home-free").addEventListener("click", function () { startWorkout(null); });
    $("#wo-free").addEventListener("click", function () { startWorkout(null); });
    $("#home-continue").addEventListener("click", function () { go("workout"); });
    $("#wo-add-ex").addEventListener("click", function () { openPick("workout"); });
    $("#wo-finish").addEventListener("click", finishWorkout);
    $("#wo-discard").addEventListener("click", discardWorkout);
    var onDate = function () {
      var v = HH.parseIso($("#wo-date").value);
      if (D.current && v != null && HH.iso(v) !== D.current.date) { D.current.date = HH.iso(v); save(); renderItems(); }
    };
    $("#wo-date").addEventListener("change", onDate);
    $("#wo-date").addEventListener("input", onDate);
    $("#sv-home").addEventListener("click", function () { go("home"); });
    $("#sv-history").addEventListener("click", function () { go("history"); });
    // the rest timer
    $("#rest-start").addEventListener("click", function () { startRest(false); });
    $("#rest-pause").addEventListener("click", function () { var t = D.timer; if (t && t.pausedAt == null) { t.pausedAt = Date.now(); save(); tickRest(); } });
    $("#rest-reset").addEventListener("click", function () { D.timer = null; save(); tickRest(); });
    $("#rest-plus").addEventListener("click", function () { if (D.timer) { D.timer.dur += 15000; save(); tickRest(); } });
    $("#rest-minus").addEventListener("click", function () { if (D.timer) { D.timer.dur = Math.max(0, D.timer.dur - 15000); save(); tickRest(); } });
    // routines, library, picker
    $("#routine-add").addEventListener("click", function () { openRoutineEdit(null); });
    $("#re-add-ex").addEventListener("click", function () { draft.name = $("#re-name").value; openPick("routine"); });
    $("#re-save").addEventListener("click", saveRoutine);
    $("#re-cancel").addEventListener("click", function () { draft = null; go("routines"); });
    $("#re-delete").addEventListener("click", deleteRoutine);
    $("#re-name").addEventListener("input", function () { if (draft) draft.name = $("#re-name").value; });
    $("#lib-open").addEventListener("click", function () { libGroup = "All"; $("#lib-search").value = ""; $("#lib-groups").innerHTML = groupChips("lib-group", libGroup); go("library"); });
    $("#lib-back").addEventListener("click", function () { go("routines"); });
    $("#lib-add").addEventListener("click", function () { pickFor = null; openExEdit(null, "library"); });
    $("#lib-search").addEventListener("input", renderLibrary);
    $("#pick-search").addEventListener("input", renderPick);
    $("#pick-new").addEventListener("click", function () { openExEdit(null, "pick"); });
    $("#pick-cancel").addEventListener("click", function () { var f = pickFor; pickFor = null; go(f === "routine" ? "routine-edit" : D.current ? "workout" : "home"); });
    $("#ex-form").addEventListener("submit", saveEx);
    $("#ex-cancel").addEventListener("click", function () { editingEx = null; go(exReturn === "pick" ? "pick" : exReturn === "exd" ? "exd" : "library"); });
    $("#ex-delete").addEventListener("click", deleteEx);
    // history, progress, body
    $("#wd-back").addEventListener("click", function () { go("history"); });
    $("#wd-edit").addEventListener("click", function () { var w = byId(D.workouts, detailWo); if (w) editWorkout(w); });
    $("#wd-delete").addEventListener("click", function () {
      var w = byId(D.workouts, detailWo), i = D.workouts.indexOf(w);
      if (i < 0) return;
      D.workouts.splice(i, 1);
      save();
      go("history");
      HH.toast("Removed the " + HH.fmtShort(dn(w.date)) + " workout", function () { D.workouts.splice(i, 0, w); save(); render(); });
    });
    $("#xd-back").addEventListener("click", function () { go("progress"); });
    $("#xd-edit").addEventListener("click", function () { openExEdit(exById(detailEx), "exd"); });
    $("#body-add").addEventListener("click", function () { openBodyEdit(null); });
    $("#be-form").addEventListener("submit", saveBody);
    $("#be-cancel").addEventListener("click", function () { editingBody = null; go("body"); });
    $("#be-delete").addEventListener("click", deleteBody);
    $("#measures-btn").addEventListener("click", openMeasures);
    $("#ms-add").addEventListener("click", function () { msDraft.push({ id: null, name: "", unit: "cm" }); renderMeasures(); var l = $$("#ms-list [data-ms-name]"); if (l.length) l[l.length - 1].focus(); });
    $("#ms-save").addEventListener("click", saveMeasures);
    $("#ms-cancel").addEventListener("click", function () { msDraft = null; go("body"); });
    // delegated clicks
    document.addEventListener("click", function (ev) {
      var t = ev.target.closest ? ev.target.closest("[data-start-routine],[data-open-wo],[data-open-ex],[data-use-w],[data-use-r],[data-done],[data-add-set],[data-del-set]," +
        "[data-del-item],[data-pick],[data-up],[data-down],[data-rm],[data-edit-routine],[data-edit-ex],[data-edit-entry],[data-ms-rm],[data-clear-sample],[data-backup],[data-dismiss-backup]") : null;
      if (!t) return;
      var a = function (n) { return t.getAttribute(n); }, c = D.current, i, k, it;
      if (t.hasAttribute("data-start-routine")) { var r = byId(D.routines, +a("data-start-routine")); if (r) startWorkout(r); }
      else if (t.hasAttribute("data-open-wo")) { var w = byId(D.workouts, +a("data-open-wo")); if (w) { detailWo = w.id; renderWo(w); go("wo"); } }
      else if (t.hasAttribute("data-open-ex")) { detailEx = +a("data-open-ex"); go("exd"); }
      else if (t.hasAttribute("data-use-w") || t.hasAttribute("data-use-r")) {
        i = +(a("data-use-w") || a("data-use-r")); it = c && c.items[i];
        if (!it) return;
        var sg = suggestion(it, lastFor(it.ex, curKey()));
        it.sets.forEach(function (s) { if (!s.done) { if (t.hasAttribute("data-use-w")) s.w = sg.useW; else s.r = sg.useR; } });
        save(); renderItem(i);
      }
      else if (t.hasAttribute("data-done")) { var p = a("data-done").split(":"); toggleDone(+p[0], +p[1]); }
      else if (t.hasAttribute("data-add-set")) {
        i = +a("data-add-set"); it = c.items[i];
        var prev = it.sets[it.sets.length - 1], lastS = lastFor(it.ex, curKey());
        it.sets.push({ w: prev && prev.w != null ? prev.w : prefillW(lastS, it.sets.length), r: null, done: false });
        save(); renderItem(i, '[data-w="' + i + ":" + (it.sets.length - 1) + '"]');
      }
      else if (t.hasAttribute("data-del-set")) { i = +a("data-del-set"); it = c.items[i]; if (it.sets.length > 1) { it.sets.pop(); save(); renderItem(i); } }
      else if (t.hasAttribute("data-del-item")) {
        i = +a("data-del-item"); it = c.items[i];
        c.items.splice(i, 1); save(); renderItems();
        HH.toast("Removed " + exById(it.ex).name, function () { if (D.current === c) { c.items.splice(i, 0, it); save(); renderItems(); } });
      }
      else if (t.hasAttribute("data-pick")) pickExercise(+a("data-pick"));
      else if (t.hasAttribute("data-up") || t.hasAttribute("data-down")) {
        k = +(a("data-up") || a("data-down"));
        var to = t.hasAttribute("data-up") ? k - 1 : k + 1;
        if (to < 0 || to >= draft.items.length) return;
        var x = draft.items.splice(k, 1)[0];
        draft.items.splice(to, 0, x);
        renderDraft();
        var f = $(t.hasAttribute("data-up") ? '[data-up="' + to + '"]' : '[data-down="' + to + '"]') || $('[data-rm="' + to + '"]');
        if (f) f.focus();
      }
      else if (t.hasAttribute("data-rm")) { draft.items.splice(+a("data-rm"), 1); renderDraft(); }
      else if (t.hasAttribute("data-edit-routine")) openRoutineEdit(byId(D.routines, +a("data-edit-routine")));
      else if (t.hasAttribute("data-edit-ex")) openExEdit(byId(D.exercises, +a("data-edit-ex")), "library");
      else if (t.hasAttribute("data-edit-entry")) openBodyEdit(byId(D.body, +a("data-edit-entry")));
      else if (t.hasAttribute("data-ms-rm")) { msDraft.splice(+a("data-ms-rm"), 1); renderMeasures(); }
      else if (t.hasAttribute("data-clear-sample")) clearSample();
      else if (t.hasAttribute("data-backup")) backup();
      else if (t.hasAttribute("data-dismiss-backup")) { D.meta.reminderDismissed = HH.iso(T); save(); renderBanners(); }
    });
    document.addEventListener("input", function (ev) {
      var t = ev.target;
      if (!t.hasAttribute) return;
      if (t.hasAttribute("data-w") && t.classList.contains("set-w")) onSetInput(t);
      else if (t.hasAttribute("data-r") && t.classList.contains("set-r")) onSetInput(t);
      else if (t.hasAttribute("data-reps") && draft) { var v = parseReps(t.value); draft.items[+t.getAttribute("data-reps")].reps = v > 0 ? v : 0; }
      else if (t.hasAttribute("data-ms-name") && msDraft) msDraft[+t.getAttribute("data-ms-name")].name = t.value;
      else if (t.hasAttribute("data-ms-unit") && msDraft) msDraft[+t.getAttribute("data-ms-unit")].unit = t.value;
    });
    document.addEventListener("change", function (ev) {
      var t = ev.target;
      if (t.hasAttribute && t.hasAttribute("data-sets") && draft) draft.items[+t.getAttribute("data-sets")].sets = +t.value;
      else if (t.name === "pick-group") { pickGroup = t.value; renderPick(); }
      else if (t.name === "lib-group") { libGroup = t.value; renderLibrary(); }
    });
    // settings
    $$('input[name="unit"]').forEach(function (r) { r.addEventListener("change", function () { if (r.checked) changeUnit(r.value); }); });
    $$('input[name="theme"]').forEach(function (r) { r.addEventListener("change", function () { D.settings.theme = r.value; save(); HH.applyTheme(r.value); }); });
    $$('input[name="weekstart"]').forEach(function (r) { r.addEventListener("change", function () { D.settings.weekStart = r.value; save(); render(); }); });
    $("#set-inc").addEventListener("change", function () {
      var v = parseNum($("#set-inc").value);
      if (v === undefined || isNaN(v) || v <= 0) { $("#set-inc-err").textContent = "Step up by: a number more than 0, like 2.5."; $("#set-inc-err").hidden = false; return; }
      $("#set-inc-err").hidden = true;
      D.settings.inc = v; save();
      HH.toast("Step up by " + wt(v));
    });
    $("#set-rest").addEventListener("change", function () {
      var v = Math.max(10, Math.min(600, Math.round(+$("#set-rest").value) || 90));
      D.settings.restSec = v; $("#set-rest").value = v; save(); tickRest();
    });
    $("#set-autorest").addEventListener("change", function () { D.settings.autoRest = $("#set-autorest").checked; save(); });
    $("#set-sound").addEventListener("change", function () { D.settings.sound = $("#set-sound").checked; save(); });
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
    $$('input[name="w-unit"]').forEach(function (r) {
      r.addEventListener("change", function () { if (!incDirty) $("#w-inc").value = r.value === "kg" ? "2.5" : "5"; });
    });
    $("#w-inc").addEventListener("input", function () { incDirty = true; });
    $("#w-form1").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var unit = ($$('input[name="w-unit"]').filter(function (r) { return r.checked; })[0] || { value: "kg" }).value, inc = parseNum($("#w-inc").value);
      if (inc === undefined || isNaN(inc) || inc <= 0) { $("#w-err1").textContent = "Step up by: a number more than 0, like 2.5."; $("#w-err1").hidden = false; return; }
      $("#w-err1").hidden = true;
      if (unit !== D.settings.unit) D.measures.forEach(function (m) { if (m.unit === D.settings.unit) m.unit = unit; });
      D.settings.unit = unit;
      D.settings.inc = inc;
      save();
      welcomeStep(2);
    });
    $("#w-sample").addEventListener("click", loadSample);
    $("#w-form2").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var which = ($$('input[name="w-starter"]').filter(function (r) { return r.checked; })[0] || { value: "none" }).value;
      D.routines = D.routines.filter(function (r) { return !r.starter; });
      makeStarters(D, which);
      save();
      welcomeStep(3);
    });
    $("#w-finish").addEventListener("click", function () { D.meta.onboarded = true; save(); go("home"); });
    document.addEventListener("visibilitychange", function () { if (!document.hidden && D.meta.onboarded) tickRest(); });
  }

  // ── start ────────────────────────────────────────────────────────
  function start() {
    var raw = store.read();
    if (raw) {
      var r = migrate(raw);
      if (r.data) D = r.data;
      else {
        try { window.localStorage.setItem("hh143_unreadable_" + HH.iso(HH.today()), JSON.stringify(raw)); } catch (e) { /* nothing more to do */ }
        D = blank("kg");
      }
    } else D = blank("kg");
    wire();
    if (D.meta.onboarded) go(D.current ? "workout" : "home"); else startWelcome();
  }

  // for the QA runner (qa/app_qa143.py)
  window.HH143 = { e1rm: e1rm, stats: function (exName) { var e = D.exercises.filter(function (x) { return x.name === exName; })[0]; return e ? stats(e.id, ordered()) : null; },
    restState: function () { return restState(Date.now()); }, num: num, parseNum: parseNum, migrate: migrate, SCHEMA: SCHEMA, APP_ID: APP_ID,
    sounds: function () { return soundsPlayed; }, data: function () { return D; } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
