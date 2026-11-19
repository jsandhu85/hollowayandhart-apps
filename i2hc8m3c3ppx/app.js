window.HH_BUILD = {"id": "142", "version": "18Nov2026.5", "hosted": true};
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

/* Product 142: Meal Planner, Recipe Book & Grocery List App (specs/home/142-meal-planner-recipe-app.yaml), 18 Nov 2026.
   A recipe library (search, tags, servings scaling), a weekly planner (breakfast, lunch, dinner, snacks; recipes or typed meals;
   copy last week), a grocery list built from the week's plan (scaled, the same item + unit added together, grouped by aisle in
   the buyer's order, the pantry taken off, ticks, own items) and a pantry. Dates are day numbers from HH (apps/core.js).
   Amounts are typed text, parsed to numbers only for the maths: the exact rules are in the spec (rules:). */
(function () {
  "use strict";
  var SCHEMA = 1;
  var APP_ID = "hollowayhart-meal-planner";
  var SLOTS = ["breakfast", "lunch", "dinner", "snacks"];
  var SLOT_LABEL = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snacks: "Snacks" };
  var DEFAULT_AISLES = ["Fruit & veg", "Bakery", "Meat & fish", "Dairy & eggs", "Pantry", "Frozen", "Drinks", "Household"];
  var OTHER = "Other";
  var MAX_AISLES = 30;
  var REMIND_DAYS = 30;
  var REFUSE_AMT = "Type each amount as a number, such as 2, 1.5, 1/2 or 1 1/2, or leave it blank.";
  var FR = { "½": 1 / 2, "⅓": 1 / 3, "⅔": 2 / 3, "¼": 1 / 4, "¾": 3 / 4, "⅛": 1 / 8, "⅜": 3 / 8,
             "⅝": 5 / 8, "⅞": 7 / 8 };
  var $ = HH.$, $$ = HH.$$, esc = HH.esc;
  var store = new HH.Store("hh142_");
  var D = null;
  var T = HH.today();
  var viewWeek = null;                         // the week start (a day number) shown on the Planner and the List
  var filt = { q: "", tags: [], sort: "title" };
  var viewId = null, viewServes = 4, viewReturn = "recipes";
  var editId = null, editReturn = "recipes";
  var planId = null, planReturn = "planner", servesDirty = false;
  var pantryId = null, pendingRestore = null;

  // ── data ──────────────────────────────────────────────────────────
  function blank() {
    return {
      schema: SCHEMA,
      settings: { theme: "auto", weekStart: 1, aisles: DEFAULT_AISLES.slice() },
      recipes: [], plan: [], pantry: [], extras: [], ticks: {},
      meta: { created: HH.iso(HH.today()), lastBackup: null, reminderDismissed: null, sample: false, onboarded: false, nextId: 1 }
    };
  }
  function isInt(x) { return typeof x === "number" && isFinite(x) && Math.floor(x) === x; }
  function isDate(s) { return HH.parseIso(s) != null; }
  function isText(s, n) { return typeof s === "string" && s.length <= n; }
  function okAmt(s) { return isText(s, 20) && !parseAmount(s).error; }
  function okSample(x) { return x.sample === undefined || typeof x.sample === "boolean"; }
  function validate(d) {
    try {
      var s = d.settings, m = d.meta, i, j, k, ids = {};
      if (d.schema !== SCHEMA || !s || !m) return false;
      if (["auto", "light", "dark"].indexOf(s.theme) < 0 || [0, 1, 6].indexOf(s.weekStart) < 0) return false;
      if (!Array.isArray(s.aisles) || s.aisles.length > MAX_AISLES) return false;
      var seen = {};
      for (i = 0; i < s.aisles.length; i++) {
        var a = s.aisles[i];
        if (!isText(a, 40) || !a.trim() || a.trim().toLowerCase() === "other" || seen[a.toLowerCase()]) return false;
        seen[a.toLowerCase()] = 1;
      }
      if (!Array.isArray(d.recipes) || !Array.isArray(d.plan) || !Array.isArray(d.pantry) || !Array.isArray(d.extras)) return false;
      if (!d.ticks || typeof d.ticks !== "object" || Array.isArray(d.ticks)) return false;
      var rid = {};
      for (i = 0; i < d.recipes.length; i++) {
        var r = d.recipes[i];
        if (!isInt(r.id) || ids[r.id] || !isText(r.title, 120) || !r.title.trim() || !isInt(r.serves) || r.serves < 1 || r.serves > 99) return false;
        ids[r.id] = 1; rid[r.id] = 1;
        if (!(r.prep === null || (isInt(r.prep) && r.prep >= 0 && r.prep <= 999)) || !(r.cook === null || (isInt(r.cook) && r.cook >= 0 && r.cook <= 999))) return false;
        if (!Array.isArray(r.tags) || r.tags.length > 12 || !r.tags.every(function (t) { return isText(t, 30) && t; })) return false;
        if (!Array.isArray(r.ings) || r.ings.length > 100 || !Array.isArray(r.steps) || r.steps.length > 60) return false;
        for (j = 0; j < r.ings.length; j++) {
          var g = r.ings[j];
          if (!g || !okAmt(g.amt) || !isText(g.unit, 20) || !isText(g.item, 80) || !g.item.trim() || !isText(g.aisle, 40)) return false;
        }
        if (!r.steps.every(function (t) { return isText(t, 1000); }) || !isText(r.notes, 5000) || !isDate(r.added) || !okSample(r)) return false;
      }
      for (i = 0; i < d.plan.length; i++) {
        var e = d.plan[i];
        if (!isInt(e.id) || ids[e.id] || !isDate(e.date) || SLOTS.indexOf(e.slot) < 0 || !isText(e.text, 80)) return false;
        ids[e.id] = 1;
        if (!(e.recipe === null ? e.text.trim() : (isInt(e.recipe) && rid[e.recipe]))) return false;
        if (!isInt(e.serves) || e.serves < 1 || e.serves > 99 || !okSample(e)) return false;
      }
      for (i = 0; i < d.pantry.length; i++) {
        var p = d.pantry[i];
        if (!isInt(p.id) || ids[p.id] || !isText(p.item, 80) || !p.item.trim() || !okAmt(p.amt) || !isText(p.unit, 20) || !okSample(p)) return false;
        ids[p.id] = 1;
      }
      for (i = 0; i < d.extras.length; i++) {
        var x = d.extras[i];
        if (!isInt(x.id) || ids[x.id] || !isDate(x.week) || !isText(x.item, 80) || !x.item.trim() || !okAmt(x.amt) || !isText(x.unit, 20) ||
            !isText(x.aisle, 40) || !okSample(x)) return false;
        ids[x.id] = 1;
      }
      for (k in d.ticks) {
        if (!isDate(k) || !Array.isArray(d.ticks[k]) || !d.ticks[k].every(function (t) { return isText(t, 200); })) return false;
      }
      if (!isDate(m.created) || !(m.lastBackup === null || isDate(m.lastBackup)) || !(m.reminderDismissed === null || isDate(m.reminderDismissed))) return false;
      if (typeof m.sample !== "boolean" || typeof m.onboarded !== "boolean" || !isInt(m.nextId)) return false;
      for (k in ids) if (+k >= m.nextId) return false;
      return true;
    } catch (err) { return false; }
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
  function own(x) { return x.sample !== true; }
  function hasOwn() { return D.recipes.some(own) || D.plan.some(own) || D.pantry.some(own) || D.extras.some(own); }
  function recipeById(id) { return D.recipes.filter(function (r) { return r.id === id; })[0] || null; }
  function planById(id) { return D.plan.filter(function (e) { return e.id === id; })[0] || null; }
  function snapshot() { return JSON.stringify(D); }
  function undoTo(snap) { return function () { D = JSON.parse(snap); save(); render(); }; }

  // ── amounts: typed text, parsed for the maths; shown by the display rule ──
  function parseAmount(s) {
    s = String(s == null ? "" : s).replace(/\s+/g, " ").trim();
    if (s === "") return { q: null };
    var m, v = null;
    if ((m = /^(\d+)? ?([½⅓⅔¼¾⅛⅜⅝⅞])$/.exec(s))) v = (m[1] ? parseInt(m[1], 10) : 0) + FR[m[2]];
    else if ((m = /^(\d+) (\d+)\/(\d+)$/.exec(s))) { if (+m[3] > 0) v = parseInt(m[1], 10) + parseInt(m[2], 10) / parseInt(m[3], 10); }
    else if ((m = /^(\d+)\/(\d+)$/.exec(s))) { if (+m[2] > 0) v = parseInt(m[1], 10) / parseInt(m[2], 10); }
    else if (/^(\d+(\.\d+)?|\.\d+)$/.test(s)) v = parseFloat(s);
    if (v === null || !(v > 0) || v > 100000) return { error: true };
    return { q: v };
  }
  function fmtAmount(q) {
    if (q == null) return "";
    var r = Math.round(q * 100 + 1e-7) / 100;
    if (!(r > 0)) r = 0.01;
    return r.toFixed(2).replace(/\.?0+$/, "");
  }
  function tidy(s) { return String(s == null ? "" : s).replace(/\s+/g, " ").trim(); }
  function capFirst(s) { s = tidy(s); return s.charAt(0).toUpperCase() + s.slice(1); }
  function normItem(s) { s = tidy(s).toLowerCase(); return s.length > 1 && s.charAt(s.length - 1) === "s" ? s.slice(0, -1) : s; }
  function normUnit(s) { s = String(s == null ? "" : s).toLowerCase().replace(/[\s.]+/g, ""); return s.length > 1 && s.charAt(s.length - 1) === "s" ? s.slice(0, -1) : s; }
  function lineKey(item, unit) { return normItem(item) + "|" + normUnit(unit); }
  function qty(q, unit) { return [fmtAmount(q), tidy(unit)].filter(Boolean).join(" "); }
  function typedLine(g) { return [tidy(g.amt), tidy(g.unit), tidy(g.item)].filter(Boolean).join(" "); }
  function scaled(g, want, serves) {
    var q = parseAmount(g.amt).q;
    return { amt: q == null ? "" : qty(q * want / serves, g.unit), item: tidy(g.item) };
  }

  // ── weeks, aisles ────────────────────────────────────────────────
  function weekStartOf(t) { return t - HH.mod(HH.weekday(t) - D.settings.weekStart, 7); }
  function weekLabel(ws) { return HH.fmtDate(ws) + " – " + HH.fmtDate(ws + 6); }
  function aisleOrder() { return D.settings.aisles.concat([OTHER]); }
  function aisleOrOther(a) { return D.settings.aisles.indexOf(a) >= 0 ? a : OTHER; }
  function weekEntries(ws) {
    return D.plan.map(function (e, i) { return { e: e, i: i, d: HH.parseIso(e.date) }; })
      .filter(function (x) { return x.d >= ws && x.d <= ws + 6; })
      .sort(function (a, b) { return a.d - b.d || SLOTS.indexOf(a.e.slot) - SLOTS.indexOf(b.e.slot) || a.i - b.i; })
      .map(function (x) { return x.e; });
  }
  function mealName(e) { var r = e.recipe != null ? recipeById(e.recipe) : null; return r ? r.title : e.text; }
  function minutes(r) { return r.prep === null && r.cook === null ? null : (r.prep || 0) + (r.cook || 0); }

  // ── the grocery list ─────────────────────────────────────────────
  function cmpLines(a, b) {
    var x = a.item.toLowerCase(), y = b.item.toLowerCase();
    if (x !== y) return x < y ? -1 : 1;
    var u = a.key.split("|")[1] || "", v = b.key.split("|")[1] || "";
    return u < v ? -1 : u > v ? 1 : 0;
  }
  function groceries(ws) {
    var lines = {}, order = [], typed = [], meals = 0;
    weekEntries(ws).forEach(function (e) {
      var r = e.recipe != null ? recipeById(e.recipe) : null;
      if (!r) { typed.push(e); return; }
      meals++;
      r.ings.forEach(function (g) {
        var k = lineKey(g.item, g.unit), q = parseAmount(g.amt).q, L = lines[k];
        if (!L) { L = lines[k] = { key: k, item: capFirst(g.item), unit: tidy(g.unit), aisle: g.aisle, q: null, own: false }; order.push(L); }
        if (q != null) L.q = (L.q || 0) + q * e.serves / r.serves;
      });
    });
    var pan = {};
    D.pantry.forEach(function (p) { var ik = normItem(p.item); (pan[ik] = pan[ik] || []).push(p); });
    var buy = [], check = [], covered = [];
    order.forEach(function (L) {
      var parts = L.key.split("|"), ps = pan[parts[0]];
      L.aisle = aisleOrOther(L.aisle); L.need = L.q; L.note = "";
      if (!ps) { buy.push(L); return; }
      var same = ps.filter(function (p) { return normUnit(p.unit) === parts[1] && parseAmount(p.amt).q != null; });
      if (L.q != null && same.length) {
        var have = same.reduce(function (s, p) { return s + parseAmount(p.amt).q; }, 0), need = L.q - have;
        if (need <= 1e-9) { L.note = "your pantry has " + qty(have, L.unit); covered.push(L); }
        else { L.need = need; L.note = "after the " + qty(have, L.unit) + " in your pantry"; buy.push(L); }
      } else {
        var bits = ps.filter(function (p) { return parseAmount(p.amt).q != null; }).map(function (p) { return [tidy(p.amt), tidy(p.unit)].filter(Boolean).join(" "); });
        L.note = bits.length ? "your pantry has " + bits.join(", ") : "it's in your pantry";
        check.push(L);
      }
    });
    var wk = HH.iso(ws);
    D.extras.filter(function (x) { return x.week === wk; }).forEach(function (x) {
      var q = parseAmount(x.amt).q;
      buy.push({ key: "own:" + x.id, id: x.id, item: capFirst(x.item), unit: tidy(x.unit), aisle: aisleOrOther(x.aisle), q: q, need: q, note: "", own: true });
    });
    var ao = aisleOrder();
    buy.sort(function (a, b) { return ao.indexOf(a.aisle) - ao.indexOf(b.aisle) || cmpLines(a, b) || (a.own ? 1 : 0) - (b.own ? 1 : 0); });
    check.sort(cmpLines); covered.sort(cmpLines);
    var ticks = D.ticks[wk] || [], on = function (L) { return ticks.indexOf(L.key) >= 0; };
    var listed = buy.length + check.length, ticked = buy.filter(on).length + check.filter(on).length;
    return { week: wk, buy: buy, check: check, covered: covered, typed: typed, meals: meals, listed: listed, ticked: ticked };
  }

  // ── wording helpers ──────────────────────────────────────────────
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
  function recipeMeta(r) {
    var bits = ["Serves " + r.serves];
    if (r.prep !== null) bits.push(r.prep + " min prep");
    if (r.cook !== null) bits.push(r.cook + " min cook");
    if (r.prep !== null && r.cook !== null) bits.push(minutes(r) + " min in all");
    return bits.join(" · ");
  }
  function tagsHtml(tags) { return tags.length ? '<span class="tags">' + tags.map(function (t) { return '<span class="tag">' + esc(t) + "</span>"; }).join(" ") + "</span>" : ""; }
  function countLine(g) { return g.listed + " on the list · " + g.ticked + " ticked"; }

  // ── rendering ────────────────────────────────────────────────────
  function render() {
    T = HH.today();
    if (viewWeek === null) viewWeek = weekStartOf(T);
    HH.applyTheme(D.settings.theme);
    renderBanners();
    renderHome();
    renderRecipes();
    renderPlanner();
    renderList();
    renderPantry();
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
      h += '<div class="banner slim" id="sample-banner"><span><span class="sample-flag">SAMPLE</span> · made-up recipes and meals</span>' +
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
  function mealRow(e, attr) {
    var r = e.recipe != null ? recipeById(e.recipe) : null;
    return '<li data-meal="' + e.id + '"><button type="button" class="rowbtn" ' + attr + '="' + e.id + '"><span class="what meal"><span class="slot-l">' +
      SLOT_LABEL[e.slot] + '</span> <span class="mn">' + esc(mealName(e)) + ' <span class="small muted nw">· for ' + e.serves + (r ? "" : " · typed") +
      '</span></span></span><span class="chev" aria-hidden="true">›</span></button></li>';
  }
  function dayMeals(d) {
    var iso = HH.iso(d);
    return weekEntries(weekStartOf(d)).filter(function (e) { return e.date === iso; });
  }
  function renderHome() {
    var today = dayMeals(T), tom = dayMeals(T + 1), dinner = today.filter(function (e) { return e.slot === "dinner"; });
    if (dinner.length) {
      var r = dinner[0].recipe != null ? recipeById(dinner[0].recipe) : null, mins = r ? minutes(r) : null;
      $("#tn-dish").textContent = dinner.map(mealName).join(" and ");
      $("#tn-dish").classList.remove("none");
      $("#tn-cap").textContent = "for " + dinner[0].serves + (mins ? " · " + mins + " min" : "");
      $("#tn-open").hidden = !r;
      $("#tn-open").setAttribute("data-open-meal", String(dinner[0].id));
    } else {
      $("#tn-dish").textContent = "Nothing planned yet";
      $("#tn-dish").classList.add("none");
      $("#tn-cap").textContent = "Add tonight's dinner on the Planner.";
      $("#tn-open").hidden = true;
    }
    $("#today-h").textContent = "Today, " + HH.fmtDate(T);
    $("#tomorrow-h").textContent = "Tomorrow, " + HH.fmtDate(T + 1);
    $("#today-list").innerHTML = today.map(function (e) { return mealRow(e, "data-open-meal"); }).join("");
    $("#today-none").hidden = today.length > 0;
    $("#tomorrow-list").innerHTML = tom.map(function (e) { return mealRow(e, "data-open-meal"); }).join("");
    $("#tomorrow-none").hidden = tom.length > 0;
    var g = groceries(weekStartOf(T));
    $("#hc-list-line").textContent = "This week: " + countLine(g);
    $("#hc-recipes-line").textContent = plural(D.recipes.length, "recipe", "recipes") + " in your library";
  }
  function allTags() {
    var seen = {};
    D.recipes.forEach(function (r) { r.tags.forEach(function (t) { seen[t] = 1; }); });
    return Object.keys(seen).sort();
  }
  function filtered() {
    var q = filt.q.toLowerCase().replace(/\s+/g, " ").trim();
    var out = D.recipes.filter(function (r) {
      for (var i = 0; i < filt.tags.length; i++) if (r.tags.indexOf(filt.tags[i]) < 0) return false;
      if (q) {
        var hay = [r.title].concat(r.tags, r.ings.map(function (g) { return g.item; })).join("\n").toLowerCase().replace(/[ \t]+/g, " ");
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    var byTitle = function (a, b) { var x = a.title.toLowerCase(), y = b.title.toLowerCase(); return x < y ? -1 : x > y ? 1 : a.id - b.id; };
    var cmp = {
      title: byTitle,
      quick: function (a, b) { var x = minutes(a), y = minutes(b); return (x === null) - (y === null) || (x || 0) - (y || 0) || byTitle(a, b); },
      "new": function (a, b) { return HH.parseIso(b.added) - HH.parseIso(a.added) || byTitle(a, b); }
    };
    return out.sort(cmp[filt.sort] || byTitle);
  }
  function renderRecipeList() {
    var list = filtered();
    $("#rc-list").innerHTML = list.map(function (r) {
      var mins = minutes(r);
      return '<li data-recipe="' + r.id + '"><button type="button" class="rowbtn" data-view-recipe="' + r.id + '"><span class="what"><b>' + esc(r.title) +
        '</b><br><span class="small muted">Serves ' + r.serves + (mins !== null ? " · " + mins + " min" : "") + "</span>" +
        (r.tags.length ? "<br>" + tagsHtml(r.tags) : "") + '</span><span class="chev" aria-hidden="true">›</span></button></li>';
    }).join("");
    $("#rc-none").hidden = list.length > 0;
    $("#rc-none").textContent = D.recipes.length ? "No recipes match. Clear the search and tags to see them all." : "No recipes yet. Tap + Add a recipe.";
    $("#rc-count").textContent = list.length === D.recipes.length ? plural(list.length, "recipe", "recipes") :
      plural(list.length, "recipe", "recipes") + " of " + D.recipes.length;
  }
  function renderRecipes() {
    var tags = allTags();
    filt.tags = filt.tags.filter(function (t) { return tags.indexOf(t) >= 0; });
    $("#rf-tags").innerHTML = tags.map(function (t) {
      return '<label class="chip"><input type="checkbox" data-tag="' + esc(t) + '"' + (filt.tags.indexOf(t) >= 0 ? " checked" : "") + "><span>" + esc(t) + "</span></label>";
    }).join("");
    $("#rf-tags-box").hidden = !tags.length;
    $("#rf-q").value = filt.q;
    $("#rf-sort").value = filt.sort;
    renderRecipeList();
  }
  function renderPlanner() {
    var ws = viewWeek, all = weekEntries(ws), h = "";
    $("#pl-week").textContent = weekLabel(ws) + (ws === weekStartOf(T) ? " · this week" : "");
    for (var i = 0; i < 7; i++) {
      var d = ws + i, iso = HH.iso(d), es = all.filter(function (e) { return e.date === iso; });
      h += '<div class="card day' + (d === T ? "" : " flat") + '" data-day="' + iso + '"><h2>' + HH.fmtDate(d) + (d === T ? ' <span class="tag">Today</span>' : "") + "</h2>" +
        (es.length ? '<ul class="list meals">' + es.map(function (e) { return mealRow(e, "data-edit-meal"); }).join("") + "</ul>" : '<p class="small muted">Nothing planned.</p>') +
        '<button type="button" class="btn btn-quiet add-meal" data-add-meal="' + iso + '">+ Add a meal</button></div>';
    }
    $("#pl-days").innerHTML = h;
  }
  function lineHtml(L, tickable, ticks) {
    var on = tickable && ticks.indexOf(L.key) >= 0;
    var body = '<span class="what"><b class="gl-name">' + esc(L.item) + '</b> <span class="gl-amt">' + esc(qty(L.need, L.unit)) + "</span>" +
      (L.own ? ' <span class="tag">your item</span>' : "") + (L.note ? ' <span class="gl-note small muted">' + esc(L.note) + "</span>" : "") + "</span>";
    if (!tickable) return '<li data-line="' + esc(L.key) + '">' + body + "</li>";
    return '<li data-line="' + esc(L.key) + '" class="gl' + (on ? " ticked" : "") + '"><label class="check gl-lab"><input type="checkbox" data-tick="' + esc(L.key) + '"' +
      (on ? " checked" : "") + ' aria-label="' + esc(L.item) + ' bought">' + body + "</label>" +
      (L.own ? '<button type="button" class="btn btn-quiet" data-del-own="' + L.id + '" aria-label="Remove ' + esc(L.item) + '">Remove</button>' : "") + "</li>";
  }
  function renderList() {
    var g = groceries(viewWeek), ticks = D.ticks[g.week] || [], h = "";
    $("#ls-week").textContent = weekLabel(viewWeek) + " · from " + plural(g.meals, "planned meal", "planned meals");
    $("#ls-count").textContent = countLine(g);
    aisleOrder().forEach(function (a) {
      var ls = g.buy.filter(function (L) { return L.aisle === a; });
      if (!ls.length) return;
      h += '<div class="card flat aisle" data-aisle="' + esc(a) + '"><h2>' + esc(a) + '</h2><ul class="list">' +
        ls.map(function (L) { return lineHtml(L, true, ticks); }).join("") + "</ul></div>";
    });
    $("#ls-groups").innerHTML = h;
    $("#ls-none").hidden = g.buy.length + g.check.length + g.covered.length > 0;
    $("#ls-check").innerHTML = g.check.map(function (L) { return lineHtml(L, true, ticks); }).join("");
    $("#ls-check-card").hidden = !g.check.length;
    $("#ls-covered").innerHTML = g.covered.map(function (L) { return lineHtml(L, false, ticks); }).join("");
    $("#ls-covered-card").hidden = !g.covered.length;
    $("#ls-typed").innerHTML = g.typed.map(function (e) {
      return '<li><span class="what">' + HH.fmtDate(HH.parseIso(e.date)) + " · " + SLOT_LABEL[e.slot] + ": " + esc(e.text) + "</span></li>";
    }).join("");
    $("#ls-typed-card").hidden = !g.typed.length;
    var sel = $("#own-aisle"), keep = sel.value;
    sel.innerHTML = aisleOrder().map(function (a) { return "<option>" + esc(a) + "</option>"; }).join("");
    sel.value = aisleOrder().indexOf(keep) >= 0 ? keep : OTHER;
  }
  function renderPantry() {
    var list = D.pantry.slice().sort(function (a, b) { var x = tidy(a.item).toLowerCase(), y = tidy(b.item).toLowerCase(); return x < y ? -1 : x > y ? 1 : a.id - b.id; });
    $("#pa-list").innerHTML = list.map(function (p) {
      var amt = [tidy(p.amt), tidy(p.unit)].filter(Boolean).join(" ");
      return '<li data-pantry="' + p.id + '"><span class="what"><b>' + esc(capFirst(p.item)) + "</b>" + (amt ? ' <span class="muted">' + esc(amt) + "</span>" : "") +
        '</span><span class="row-buttons mini"><button type="button" class="btn btn-quiet" data-edit-pantry="' + p.id + '">Change</button>' +
        '<button type="button" class="btn btn-quiet" data-del-pantry="' + p.id + '">Remove</button></span></li>';
    }).join("");
    $("#pa-none").hidden = list.length > 0;
    $("#pa-count").textContent = plural(list.length, "item", "items") + " in your pantry";
  }
  function renderSettings() {
    $$('input[name="ws"]').forEach(function (r) { r.checked = +r.value === D.settings.weekStart; });
    var n = D.settings.aisles.length;
    $("#ai-list").innerHTML = D.settings.aisles.map(function (a, i) {
      return '<li data-aisle-row="' + esc(a) + '"><input type="text" class="ai-name" maxlength="40" autocomplete="off" value="' + esc(a) + '" data-old="' + esc(a) +
        '" aria-label="Aisle name"><span class="row-buttons mini"><button type="button" class="btn btn-quiet" data-ai-up="' + i + '" aria-label="Move ' + esc(a) + ' up"' +
        (i === 0 ? " disabled" : "") + '>↑</button><button type="button" class="btn btn-quiet" data-ai-down="' + i + '" aria-label="Move ' + esc(a) + ' down"' +
        (i === n - 1 ? " disabled" : "") + '>↓</button><button type="button" class="btn btn-quiet" data-ai-del="' + i + '">Remove</button></span></li>';
    }).join("") + '<li data-aisle-row="Other" class="fixed"><span class="what"><b>Other</b> <span class="small muted">Always last. Items in an aisle you remove land here.</span></span></li>';
    $$('input[name="theme"]').forEach(function (r) { r.checked = r.value === D.settings.theme; });
    $("#last-backup").textContent = D.meta.lastBackup ? "Last backup: " + HH.fmtLong(HH.parseIso(D.meta.lastBackup)) : "No backup made yet.";
    $("#sample-state").textContent = D.meta.sample ? "Sample recipes are on: everything in the app is made up." :
      "Sample recipes are off. You can load made-up recipes and meals to look around while the app is empty.";
    $("#sample-btn").textContent = D.meta.sample ? "Clear the sample recipes" : "Load sample recipes";
  }
  function go(id) {
    render();
    HH.show(id);
    $("#tabs").hidden = id === "welcome";
  }
  function current() { var s = $$("[data-screen]").filter(function (x) { return !x.hidden; })[0]; return s ? s.getAttribute("data-screen") : "home"; }

  // ── first run ────────────────────────────────────────────────────
  function welcomeStep(k) {
    [1, 2, 3].forEach(function (i) { $("#welcome-" + i).hidden = i !== k; $("#st" + i).classList.toggle("on", i <= k); });
    var h1 = $("#welcome-" + k + " h1");
    if (h1) { h1.setAttribute("tabindex", "-1"); h1.focus(); }
  }
  function startWelcome() {
    viewWeek = null;
    go("welcome");
    $$('input[name="w-ws"]').forEach(function (r) { r.checked = +r.value === D.settings.weekStart; });
    welcomeStep(1);
  }

  // ── sample (made-up recipes, no brands) ──────────────────────────
  var FV = "Fruit & veg", BK = "Bakery", MF = "Meat & fish", DE = "Dairy & eggs", PA = "Pantry", FZ = "Frozen", HO = "Household";
  var SAMPLE = [
    ["Overnight oats", 2, 5, null, ["breakfast", "quick", "vegetarian"],
      [["1", "cup", "rolled oats", PA], ["1", "cup", "milk", DE], ["1/2", "cup", "plain yoghurt", DE], ["1", "tbsp", "honey", PA], ["1/2", "cup", "frozen berries", FZ]],
      ["Stir the oats, milk and yoghurt together in a jar or a bowl.", "Cover and leave in the fridge overnight.", "In the morning, top with the berries and the honey."],
      "Keeps for 2 days in the fridge, so make two jars at once."],
    ["Banana pancakes", 4, 10, 15, ["breakfast", "vegetarian", "weekend"],
      [["1 1/2", "cups", "plain flour", PA], ["2", "tsp", "baking powder", PA], ["2", "", "eggs", DE], ["1 1/4", "cups", "milk", DE], ["2", "", "ripe bananas", FV], ["", "", "butter", DE]],
      ["Mash the bananas in a big bowl, then whisk in the eggs and milk.", "Stir in the flour and baking powder until just mixed.",
       "Cook spoonfuls in a buttered pan over medium heat, about 2 minutes a side."],
      "Freeze the extras flat in a bag and reheat them in the toaster."],
    ["Chicken and veg tray bake", 4, 15, 40, ["dinner", "family", "one pan"],
      [["800", "g", "chicken thighs", MF], ["500", "g", "potatoes", FV], ["2", "", "carrots", FV], ["1", "", "red onion", FV], ["2", "tbsp", "olive oil", PA], ["1", "tsp", "dried oregano", PA]],
      ["Heat the oven to 200°C (180°C fan).", "Cut the potatoes, carrots and onion into chunks and spread them on a big tray with the chicken.",
       "Toss with the oil and oregano, then roast for 40 minutes, turning once."], ""],
    ["Lentil soup", 6, 10, 35, ["dinner", "freezes well", "vegetarian"],
      [["1 1/2", "cups", "red lentils", PA], ["1", "", "onion", FV], ["2", "", "carrots", FV], ["2", "sticks", "celery", FV], ["1.5", "L", "vegetable stock", PA],
       ["400", "g", "tinned tomatoes", PA], ["1", "tsp", "ground cumin", PA]],
      ["Chop the onion, carrots and celery and soften them in a little oil for 5 minutes.", "Add the lentils, stock, tomatoes and cumin.",
       "Simmer for 30 minutes, stirring now and then, until the lentils are soft."],
      "Freezes well in portions for up to 3 months."],
    ["Spaghetti bolognese", 4, 10, 30, ["dinner", "family"],
      [["500", "g", "beef mince", MF], ["1", "", "onion", FV], ["2", "cloves", "garlic", FV], ["400", "g", "tinned tomatoes", PA], ["2", "tbsp", "tomato paste", PA],
       ["400", "g", "spaghetti", PA], ["1/2", "cup", "grated parmesan", DE]],
      ["Brown the mince with the chopped onion and garlic.", "Add the tomatoes and tomato paste and simmer for 20 minutes.",
       "Cook the spaghetti, then serve it with the sauce and the parmesan."], ""],
    ["Vegetable fried rice", 4, 15, 10, ["dinner", "quick", "vegetarian"],
      [["1 1/2", "cups", "rice", PA], ["3", "", "eggs", DE], ["2", "cups", "frozen peas and corn", FZ], ["3", "", "spring onions", FV], ["2", "tbsp", "soy sauce", PA],
       ["1", "tbsp", "sesame oil", PA]],
      ["Cook the rice the day before if you can, and keep it in the fridge.", "Scramble the eggs in a hot wok, then set them aside.",
       "Fry the rice with the peas and corn, then add the soy sauce, sesame oil, eggs and sliced spring onions."],
      "Day-old rice fries best."],
    ["Greek salad wraps", 2, 10, null, ["lunch", "quick", "vegetarian"],
      [["4", "", "wraps", BK], ["1", "", "cucumber", FV], ["2", "", "tomatoes", FV], ["100", "g", "feta", DE], ["1/4", "cup", "olives", PA], ["2", "tbsp", "hummus", DE]],
      ["Chop the cucumber and tomatoes and crumble the feta.", "Spread each wrap with hummus, add the salad and olives, and roll up."], ""],
    ["Tuna pasta salad", 4, 15, 10, ["lunch", "packed lunch"],
      [["300", "g", "pasta", PA], ["2", "tins", "tuna", PA], ["1", "cup", "corn kernels", FZ], ["1/2", "cup", "mayonnaise", PA], ["1", "", "red capsicum", FV]],
      ["Cook the pasta, drain it and cool it under cold water.", "Mix in the drained tuna, the corn, the diced capsicum and the mayonnaise.",
       "Keep it in the fridge in lunch boxes for up to 3 days."], ""],
    ["Baked salmon with potatoes", 2, 10, 25, ["dinner"],
      [["2", "fillets", "salmon", MF], ["400", "g", "potatoes", FV], ["1", "", "lemon", FV], ["1", "head", "broccoli", FV], ["1", "tbsp", "olive oil", PA]],
      ["Heat the oven to 200°C. Roast the sliced potatoes with the oil for 10 minutes.", "Add the salmon and the broccoli to the tray, with lemon slices on top.",
       "Bake for 15 minutes more."], ""],
    ["Chickpea curry", 4, 10, 25, ["dinner", "freezes well", "vegetarian"],
      [["2", "tins", "chickpeas", PA], ["400", "ml", "coconut milk", PA], ["1", "", "onion", FV], ["2", "cloves", "garlic", FV], ["2", "tbsp", "curry paste", PA],
       ["2", "cups", "baby spinach", FV], ["1 1/2", "cups", "rice", PA]],
      ["Soften the chopped onion and garlic, then stir in the curry paste for a minute.", "Add the drained chickpeas and the coconut milk and simmer for 15 minutes.",
       "Stir in the spinach and serve with the rice."], ""],
    ["Berry yoghurt pots", 2, 5, null, ["quick", "snack", "vegetarian"],
      [["1", "cup", "plain yoghurt", DE], ["1/2", "cup", "frozen berries", FZ], ["1/4", "cup", "granola", PA]],
      ["Layer the yoghurt, berries and granola in two glasses or jars."], "A sweet extra for the afternoon."]
  ];
  // [day offset from the week start, slot, recipe index or typed text, servings]
  var SAMPLE_PLAN = [
    [0, "breakfast", 0, 2], [0, "dinner", 2, 4], [1, "lunch", 6, 2], [1, "dinner", 4, 4], [2, "breakfast", 0, 2], [2, "dinner", 5, 4],
    [2, "snacks", 10, 2], [3, "lunch", "Leftovers", 2], [3, "dinner", 3, 6], [4, "lunch", 7, 4], [4, "dinner", "Dinner out", 4],
    [5, "breakfast", 1, 4], [5, "dinner", 8, 2], [6, "dinner", 9, 4],
    [-7, "dinner", 4, 4], [-5, "dinner", 9, 4], [-3, "dinner", 2, 4], [-2, "breakfast", 1, 4]
  ];
  var SAMPLE_PANTRY = [["olive oil", "", ""], ["rice", "1", "kg"], ["salt", "", ""], ["pasta", "500", "g"], ["tinned tomatoes", "400", "g"], ["soy sauce", "", ""]];
  function loadSample() {
    var t = HH.today(), d = blank(), id = 1;
    d.settings.theme = D ? D.settings.theme : "auto";
    d.settings.weekStart = D ? D.settings.weekStart : 1;
    D = d;
    var ws = weekStartOf(t), wk = HH.iso(ws);
    d.recipes = SAMPLE.map(function (s, i) {
      return { id: id++, title: s[0], serves: s[1], prep: s[2], cook: s[3], tags: s[4].slice(),
               ings: s[5].map(function (g) { return { amt: g[0], unit: g[1], item: g[2], aisle: g[3] }; }),
               steps: s[6].slice(), notes: s[7], added: HH.iso(t - 120 + i * 9), sample: true };
    });
    d.plan = SAMPLE_PLAN.map(function (p) {
      var isR = typeof p[2] === "number";
      return { id: id++, date: HH.iso(ws + p[0]), slot: p[1], recipe: isR ? d.recipes[p[2]].id : null, text: isR ? "" : p[2], serves: p[3], sample: true };
    });
    d.pantry = SAMPLE_PANTRY.map(function (p) { return { id: id++, item: p[0], amt: p[1], unit: p[2], sample: true }; });
    var bread = id;
    d.extras = [{ id: id++, week: wk, item: "bread", amt: "1", unit: "loaf", aisle: BK, sample: true },
                { id: id++, week: wk, item: "dishwashing liquid", amt: "1", unit: "bottle", aisle: HO, sample: true }];
    d.ticks[wk] = [lineKey("carrots", ""), "own:" + bread];
    d.meta.sample = true; d.meta.onboarded = true; d.meta.nextId = id;
    viewWeek = ws;
    save();
    go("home");
    HH.toast("Sample recipes loaded. Clear them any time.", null, 4000);
  }
  function clearSample() {
    var old = D, gone = {};
    old.recipes.forEach(function (r) { if (!own(r)) gone[r.id] = r.title; });
    D = blank();
    D.settings = old.settings;
    D.recipes = old.recipes.filter(own);
    D.plan = old.plan.filter(own).map(function (e) {
      if (e.recipe != null && gone[e.recipe] != null) { e.text = gone[e.recipe].slice(0, 80); e.recipe = null; }
      return e;
    });
    D.pantry = old.pantry.filter(own);
    D.extras = old.extras.filter(own);
    D.meta.nextId = old.meta.nextId;
    D.meta.onboarded = hasOwn();
    save();
    viewWeek = null;
    if (D.meta.onboarded) { go("home"); HH.toast("Sample cleared. Your own recipes and meals stay."); } else startWelcome();
  }

  // ── recipes ──────────────────────────────────────────────────────
  function aisleOptions(sel) {
    var a = aisleOrder();
    if (sel && a.indexOf(sel) < 0) sel = OTHER;
    return a.map(function (x) { return "<option" + (x === (sel || OTHER) ? " selected" : "") + ">" + esc(x) + "</option>"; }).join("");
  }
  function ingRow(g) {
    g = g || { amt: "", unit: "", item: "", aisle: OTHER };
    return '<div class="ing-row" data-row><input type="text" class="ing-amt" inputmode="text" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="20" autocomplete="off" aria-label="Amount" value="' + esc(g.amt) + '">' +
      '<input type="text" class="ing-unit" maxlength="20" autocomplete="off" aria-label="Unit" value="' + esc(g.unit) + '">' +
      '<input type="text" class="ing-item" maxlength="80" autocomplete="off" aria-label="Item" value="' + esc(g.item) + '">' +
      '<select class="ing-aisle" aria-label="Aisle"' + (g.item ? ' data-touched="1"' : "") + ">" + aisleOptions(g.aisle) + "</select>" +
      '<button type="button" class="btn btn-quiet ing-del" aria-label="Remove this ingredient">Remove</button></div>';
  }
  function knownAisle(item) {
    var k = normItem(item), hit = null;
    D.recipes.forEach(function (r) { r.ings.forEach(function (g) { if (normItem(g.item) === k && aisleOrder().indexOf(g.aisle) >= 0) hit = g.aisle; }); });
    return hit;
  }
  function openRecipe(id, serves, from) {
    var r = recipeById(id);
    if (!r) { go("recipes"); return; }
    viewId = id; viewServes = serves || r.serves; viewReturn = from || "recipes";
    $("#rv-title").textContent = r.title;
    $("#rv-meta").textContent = recipeMeta(r);
    $("#rv-tags").innerHTML = tagsHtml(r.tags);
    $("#rv-tags").hidden = !r.tags.length;
    $("#rv-steps").innerHTML = r.steps.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("");
    $("#rv-steps-none").hidden = r.steps.length > 0;
    $("#rv-notes").textContent = r.notes;
    $("#rv-notes-card").hidden = !r.notes.trim();
    $("#rv-serves").value = String(viewServes);
    go("recipe");
    renderIngs();
  }
  function renderIngs() {
    var r = recipeById(viewId);
    if (!r) return;
    var asTyped = viewServes === r.serves;
    $("#rv-ing-h").textContent = "Ingredients for " + viewServes + (asTyped ? "" : " · the recipe serves " + r.serves);
    $("#rv-scale-note").textContent = asTyped ? "The amounts as you typed them." :
      "Each amount × " + viewServes + " ÷ " + r.serves + ", shown to 2 decimal places at most.";
    $("#rv-ings").innerHTML = r.ings.map(function (g) {
      if (asTyped) {
        var a = [tidy(g.amt), tidy(g.unit)].filter(Boolean).join(" ");
        return '<li class="ing"><span class="what">' + (a ? '<b class="ia">' + esc(a) + "</b> " : "") + esc(tidy(g.item)) + "</span></li>";
      }
      var s = scaled(g, viewServes, r.serves), unitOnly = !s.amt && tidy(g.unit) ? tidy(g.unit) : "";
      var amt = s.amt || unitOnly;
      return '<li class="ing"><span class="what">' + (amt ? '<b class="ia">' + esc(amt) + "</b> " : "") + esc(s.item) + "</span></li>";
    }).join("");
    $("#rv-ings-none").hidden = r.ings.length > 0;
    $("#rv-minus").disabled = viewServes <= 1;
    $("#rv-plus").disabled = viewServes >= 99;
  }
  function setServes(n) {
    n = Math.max(1, Math.min(99, n));
    viewServes = n;
    $("#rv-serves").value = String(n);
    renderIngs();
  }
  function openEdit(id, from) {
    var r = id != null ? recipeById(id) : null;
    editId = r ? r.id : null;
    editReturn = from || "recipes";
    $("#re-h").textContent = r ? "Change recipe" : "Add a recipe";
    $("#re-title").value = r ? r.title : "";
    $("#re-serves").value = r ? String(r.serves) : "";
    $("#re-prep").value = r && r.prep !== null ? String(r.prep) : "";
    $("#re-cook").value = r && r.cook !== null ? String(r.cook) : "";
    $("#re-tags").value = r ? r.tags.join(", ") : "";
    $("#re-ings").innerHTML = r && r.ings.length ? r.ings.map(ingRow).join("") : ingRow() + ingRow() + ingRow();
    $("#re-steps").value = r ? r.steps.join("\n") : "";
    $("#re-notes").value = r ? r.notes : "";
    $("#re-err").hidden = true;
    $("#re-delete").hidden = !r;
    go("recipe-edit");
    $("#re-title").focus();
  }
  function wholeOr(s, lo, hi) {
    s = String(s || "").trim();
    if (s === "") return null;
    if (!/^\d+$/.test(s)) return NaN;
    var n = parseInt(s, 10);
    return n >= lo && n <= hi ? n : NaN;
  }
  function saveRecipe(ev) {
    ev.preventDefault();
    var err = function (t) { $("#re-err").textContent = t; $("#re-err").hidden = false; };
    var title = tidy($("#re-title").value).slice(0, 120), serves = wholeOr($("#re-serves").value, 1, 99);
    var prep = wholeOr($("#re-prep").value, 0, 999), cook = wholeOr($("#re-cook").value, 0, 999);
    if (!title) return err("Give the recipe a title.");
    if (serves === null || isNaN(serves)) return err("Serves should be a whole number from 1 to 99, such as 4.");
    if ((prep !== null && isNaN(prep)) || (cook !== null && isNaN(cook))) return err("Prep and cook are minutes, such as 15, or leave them blank.");
    var ings = [], bad = null;
    $$("#re-ings .ing-row").forEach(function (row) {
      var amt = tidy($(".ing-amt", row).value), unit = tidy($(".ing-unit", row).value), item = tidy($(".ing-item", row).value), aisle = $(".ing-aisle", row).value;
      if (!amt && !unit && !item) return;
      if (!bad && !item) bad = "Each ingredient needs an item, such as flour. Clear its amount and unit to leave the row out.";
      if (!bad && parseAmount(amt).error) bad = REFUSE_AMT;
      ings.push({ amt: amt, unit: unit.slice(0, 20), item: item.slice(0, 80), aisle: aisleOrder().indexOf(aisle) >= 0 ? aisle : OTHER });
    });
    if (bad) return err(bad);
    var tags = [];
    $("#re-tags").value.split(",").forEach(function (t) { t = tidy(t).toLowerCase().slice(0, 30); if (t && tags.indexOf(t) < 0 && tags.length < 12) tags.push(t); });
    var steps = $("#re-steps").value.split(/\r?\n/).map(function (s) { return tidy(s).slice(0, 1000); }).filter(Boolean).slice(0, 60);
    var r = editId != null ? recipeById(editId) : null, isNew = !r;
    if (!r) { r = { id: newId(), added: HH.iso(T) }; D.recipes.push(r); }
    r.title = title; r.serves = serves; r.prep = prep; r.cook = cook; r.tags = tags; r.ings = ings.slice(0, 100); r.steps = steps;
    r.notes = $("#re-notes").value.slice(0, 5000);
    save();
    HH.toast((isNew ? "Added " : "Saved ") + title);
    openRecipe(r.id, null, editReturn === "recipe" ? viewReturn : "recipes");
  }
  function deleteRecipe() {
    var r = recipeById(editId);
    if (!r) return;
    var uses = D.plan.filter(function (e) { return e.recipe === r.id; }).length;
    HH.confirmStep({
      title: "Delete " + r.title + "?", yes: "Delete the recipe", no: "Keep it", danger: true,
      text: uses ? "It's on your planner " + plural(uses, "time", "times") + ". " + (uses === 1 ? "That meal stays" : "Those meals stay") +
        " as a typed meal, without its ingredients on the grocery list." : "It isn't on your planner.",
      onYes: function () {
        var snap = snapshot();
        D.plan.forEach(function (e) { if (e.recipe === r.id) { e.recipe = null; e.text = r.title.slice(0, 80); } });
        D.recipes.splice(D.recipes.indexOf(r), 1);
        save();
        go("recipes");
        HH.toast("Deleted " + r.title, undoTo(snap));
      }
    });
  }

  // ── planner ──────────────────────────────────────────────────────
  function moveWeek(k) {
    viewWeek = k === 0 ? weekStartOf(T) : viewWeek + 7 * k;
    var s = current();
    render();
    if (s !== "planner" && s !== "list") HH.show("planner");
  }
  function planKind(kind) {
    $$('input[name="pe-kind"]').forEach(function (r) { r.checked = r.value === kind; });
    $("#pe-recipe-box").hidden = kind !== "recipe";
    $("#pe-text-box").hidden = kind !== "text";
  }
  function openPlan(entry, o) {
    o = o || {};
    if (viewWeek === null) viewWeek = weekStartOf(T);
    planId = entry ? entry.id : null;
    planReturn = o.from || "planner";
    var date = entry ? HH.parseIso(entry.date) : (o.date != null ? o.date : (T >= viewWeek && T <= viewWeek + 6 ? T : viewWeek));
    viewWeek = weekStartOf(date);
    var opts = "";
    for (var i = 0; i < 7; i++) {
      var d = viewWeek + i;
      opts += '<option value="' + HH.iso(d) + '"' + (d === date ? " selected" : "") + ">" + HH.fmtDate(d) + (d === T ? " (today)" : "") + "</option>";
    }
    $("#pe-day").innerHTML = opts;
    var slot = entry ? entry.slot : (o.slot || "dinner");
    $$('input[name="pe-slot"]').forEach(function (r) { r.checked = r.value === slot; });
    var rid = entry ? entry.recipe : (o.recipe != null ? o.recipe : null);
    var sorted = D.recipes.slice().sort(function (a, b) { var x = a.title.toLowerCase(), y = b.title.toLowerCase(); return x < y ? -1 : x > y ? 1 : a.id - b.id; });
    $("#pe-recipe").innerHTML = '<option value="">Choose a recipe</option>' + sorted.map(function (r) {
      return '<option value="' + r.id + '"' + (r.id === rid ? " selected" : "") + ">" + esc(r.title) + " (serves " + r.serves + ")</option>";
    }).join("");
    $("#pe-norecipes").hidden = D.recipes.length > 0;
    $("#pe-recipe").hidden = !D.recipes.length;
    var kind = entry ? (entry.recipe != null ? "recipe" : "text") : (rid != null || D.recipes.length ? "recipe" : "text");
    planKind(kind);
    $("#pe-text").value = entry && entry.recipe === null ? entry.text : "";
    var r = rid != null ? recipeById(rid) : null;
    $("#pe-serves").value = String(entry ? entry.serves : (o.serves || (r ? r.serves : 2)));
    servesDirty = !!entry || o.serves != null;
    $("#pe-h").textContent = entry ? "Change meal" : "Plan a meal";
    $("#pe-err").hidden = true;
    $("#pe-delete").hidden = !entry;
    $("#pe-open").hidden = !(entry && entry.recipe != null);
    go("plan-edit");
  }
  function savePlan(ev) {
    ev.preventDefault();
    var err = function (t) { $("#pe-err").textContent = t; $("#pe-err").hidden = false; };
    var kind = ($$('input[name="pe-kind"]').filter(function (r) { return r.checked; })[0] || {}).value;
    var slot = ($$('input[name="pe-slot"]').filter(function (r) { return r.checked; })[0] || {}).value;
    var date = $("#pe-day").value, serves = wholeOr($("#pe-serves").value, 1, 99), rid = $("#pe-recipe").value ? +$("#pe-recipe").value : null;
    var text = tidy($("#pe-text").value).slice(0, 80);
    if (SLOTS.indexOf(slot) < 0) return err("Pick a meal: Breakfast, Lunch, Dinner or Snacks.");
    if (kind === "recipe" && !recipeById(rid)) return err("Pick a recipe, or choose Something else.");
    if (kind !== "recipe" && !text) return err("Type the meal, such as Leftovers.");
    if (serves === null || isNaN(serves)) return err("Servings should be a whole number from 1 to 99.");
    var e = planId != null ? planById(planId) : null;
    if (!e) { e = { id: newId() }; D.plan.push(e); }
    e.date = date; e.slot = slot; e.recipe = kind === "recipe" ? rid : null; e.text = kind === "recipe" ? "" : text; e.serves = serves;
    save();
    viewWeek = weekStartOf(HH.parseIso(date));
    go(planReturn === "home" ? "home" : "planner");
    HH.toast((planId != null ? "Changed " : "Planned ") + mealName(e) + " for " + HH.fmtDate(HH.parseIso(date)) + ", " + SLOT_LABEL[slot].toLowerCase());
  }
  function deletePlan() {
    var e = planById(planId);
    if (!e) return;
    var snap = snapshot(), name = mealName(e);
    D.plan.splice(D.plan.indexOf(e), 1);
    save();
    go(planReturn === "home" ? "home" : "planner");
    HH.toast("Removed " + name + " from the planner", undoTo(snap));
  }
  function copyLastWeek() {
    var ws = viewWeek, src = weekEntries(ws - 7), have = weekEntries(ws).length;
    if (!src.length) { HH.toast("Last week has no meals to copy."); return; }
    var doCopy = function () {
      var snap = snapshot();
      src.forEach(function (e) {
        D.plan.push({ id: newId(), date: HH.iso(HH.parseIso(e.date) + 7), slot: e.slot, recipe: e.recipe, text: e.text, serves: e.serves });
      });
      save();
      render();
      HH.toast("Copied " + plural(src.length, "meal", "meals") + " from last week", undoTo(snap));
    };
    if (!have) { doCopy(); return; }
    HH.confirmStep({
      title: "Copy last week?", yes: "Add them", no: "Cancel",
      text: "Add last week's " + plural(src.length, "meal", "meals") + " to this week? The " + plural(have, "meal", "meals") + " already planned here stay.",
      onYes: doCopy
    });
  }

  // ── the list: ticks and own items ────────────────────────────────
  function toggleTick(key, on) {
    var wk = HH.iso(viewWeek), t = D.ticks[wk] || [], i = t.indexOf(key);
    if (on && i < 0) t.push(key);
    if (!on && i >= 0) t.splice(i, 1);
    if (t.length) D.ticks[wk] = t; else delete D.ticks[wk];
    save();
    renderList();
    renderHome();
  }
  function clearTicks() {
    var wk = HH.iso(viewWeek);
    if (!(D.ticks[wk] || []).length) { HH.toast("Nothing is ticked yet."); return; }
    var snap = snapshot();
    delete D.ticks[wk];
    save();
    render();
    HH.toast("Ticks cleared", undoTo(snap));
  }
  function addOwn(ev) {
    ev.preventDefault();
    var err = function (t) { $("#own-err").textContent = t; $("#own-err").hidden = false; };
    var item = tidy($("#own-item").value).slice(0, 80), amt = tidy($("#own-amt").value), unit = tidy($("#own-unit").value).slice(0, 20);
    if (!item) return err("Type the item, such as dishwashing liquid.");
    if (parseAmount(amt).error) return err(REFUSE_AMT);
    D.extras.push({ id: newId(), week: HH.iso(viewWeek), item: item, amt: amt, unit: unit, aisle: $("#own-aisle").value });
    save();
    $("#own-item").value = ""; $("#own-amt").value = ""; $("#own-unit").value = ""; $("#own-err").hidden = true;
    render();
    HH.toast("Added " + item + " to this week's list");
  }
  function removeOwn(id) {
    var x = D.extras.filter(function (e) { return e.id === id; })[0];
    if (!x) return;
    var snap = snapshot();
    D.extras.splice(D.extras.indexOf(x), 1);
    var wk = x.week, t = D.ticks[wk];
    if (t && t.indexOf("own:" + id) >= 0) { t.splice(t.indexOf("own:" + id), 1); if (!t.length) delete D.ticks[wk]; }
    save();
    render();
    HH.toast("Removed " + x.item, undoTo(snap));
  }

  // ── pantry ───────────────────────────────────────────────────────
  function pantryForm(p) {
    pantryId = p ? p.id : null;
    $("#pa-h").textContent = p ? "Change pantry item" : "Add to your pantry";
    $("#pa-item").value = p ? p.item : "";
    $("#pa-amt").value = p ? p.amt : "";
    $("#pa-unit").value = p ? p.unit : "";
    $("#pa-save").textContent = p ? "Save" : "Add";
    $("#pa-cancel").hidden = !p;
    $("#pa-err").hidden = true;
  }
  function savePantry(ev) {
    ev.preventDefault();
    var err = function (t) { $("#pa-err").textContent = t; $("#pa-err").hidden = false; };
    var item = tidy($("#pa-item").value).slice(0, 80), amt = tidy($("#pa-amt").value), unit = tidy($("#pa-unit").value).slice(0, 20);
    if (!item) return err("Type the item, such as rice.");
    if (parseAmount(amt).error) return err(REFUSE_AMT);
    var p = pantryId != null ? D.pantry.filter(function (x) { return x.id === pantryId; })[0] : null, isNew = !p;
    if (!p) { p = { id: newId() }; D.pantry.push(p); }
    p.item = item; p.amt = amt; p.unit = unit;
    save();
    pantryForm(null);
    render();
    HH.toast((isNew ? "Added " : "Saved ") + item + (isNew ? " to your pantry" : ""));
    $("#pa-item").focus();
  }
  function removePantry(id) {
    var p = D.pantry.filter(function (x) { return x.id === id; })[0];
    if (!p) return;
    var snap = snapshot();
    D.pantry.splice(D.pantry.indexOf(p), 1);
    if (pantryId === id) pantryForm(null);
    save();
    render();
    HH.toast("Removed " + p.item + " from your pantry", undoTo(snap));
  }

  // ── aisles ───────────────────────────────────────────────────────
  function aisleErr(t) { $("#ai-err").textContent = t; $("#ai-err").hidden = !t; }
  function aisleTaken(name, except) {
    var low = name.toLowerCase();
    return low === "other" || D.settings.aisles.some(function (a, i) { return i !== except && a.toLowerCase() === low; });
  }
  function eachAisleUse(fn) {
    D.recipes.forEach(function (r) { r.ings.forEach(fn); });
    D.extras.forEach(fn);
  }
  function renameAisle(input) {
    var old = input.getAttribute("data-old"), i = D.settings.aisles.indexOf(old), name = tidy(input.value).slice(0, 40);
    if (i < 0 || name === old) { input.value = old; return; }
    if (!name) { input.value = old; aisleErr("An aisle needs a name. Use Remove to take it away."); return; }
    if (aisleTaken(name, i)) { input.value = old; aisleErr("There's already an aisle called " + name + "."); return; }
    D.settings.aisles[i] = name;
    eachAisleUse(function (g) { if (g.aisle === old) g.aisle = name; });
    aisleErr("");
    save();
    render();
    HH.toast("Renamed " + old + " to " + name);
  }
  function moveAisle(i, dir) {
    var a = D.settings.aisles, j = i + dir;
    if (j < 0 || j >= a.length) return;
    var x = a[i]; a[i] = a[j]; a[j] = x;
    save();
    render();
    var b = $('[data-ai-' + (dir < 0 ? "up" : "down") + '="' + j + '"]');
    if (b && !b.disabled) b.focus();
  }
  function removeAisle(i) {
    var name = D.settings.aisles[i];
    if (name == null) return;
    var snap = snapshot();
    D.settings.aisles.splice(i, 1);
    eachAisleUse(function (g) { if (g.aisle === name) g.aisle = OTHER; });
    aisleErr("");
    save();
    render();
    HH.toast("Removed the aisle " + name + ". Its items are in Other now.", undoTo(snap), 6000);
  }
  function addAisle(ev) {
    ev.preventDefault();
    var name = tidy($("#ai-new").value).slice(0, 40);
    if (!name) { aisleErr("Type the aisle's name, such as Baby."); return; }
    if (aisleTaken(name, -1)) { aisleErr("There's already an aisle called " + name + "."); return; }
    if (D.settings.aisles.length >= MAX_AISLES) { aisleErr("That's " + MAX_AISLES + " aisles, the most the app keeps. Remove one first."); return; }
    D.settings.aisles.push(name);
    $("#ai-new").value = "";
    aisleErr("");
    save();
    render();
    HH.toast("Added the aisle " + name);
  }

  // ── backup, restore, start fresh ─────────────────────────────────
  function backup() {
    T = HH.today();
    D.meta.lastBackup = HH.iso(T);
    D.meta.reminderDismissed = null;
    save();
    var name = "hollowayhart-meal-planner-app-backup-" + HH.iso(T) + ".json";
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
      if (r.error === "newer") { restoreMsg('<p class="err" id="restore-refused">This backup was made by a newer version of the app, so this copy can\'t read it. Nothing was changed.</p>'); return; }
      if (r.error) { restoreMsg('<p class="err" id="restore-refused">This file isn\'t a backup from this app, or it is damaged. Nothing was changed.</p>'); return; }
      pendingRestore = r.data;
      restoreMsg('<div class="banner" id="restore-summary"><strong>This backup has</strong>' + plural(r.data.recipes.length, "recipe", "recipes") + " · " +
        plural(r.data.plan.length, "planned meal", "planned meals") + " · " + plural(r.data.pantry.length, "pantry item", "pantry items") +
        (r.made != null ? " · made " + HH.fmtLong(r.made) : "") + '<p class="small" style="margin-top:6px">Restoring replaces everything in the app now.</p>' +
        '<div class="row-buttons"><button type="button" class="btn btn-primary" id="restore-yes">Replace with this backup</button>' +
        '<button type="button" class="btn btn-quiet" id="restore-no">Cancel</button></div></div>');
      $("#restore-yes").addEventListener("click", function () {
        D = pendingRestore; pendingRestore = null;
        save();
        restoreMsg("");
        viewWeek = null;
        if (!D.meta.onboarded) startWelcome(); else go("home");
        HH.toast("Backup restored.");
      });
      $("#restore-no").addEventListener("click", function () { pendingRestore = null; restoreMsg(""); });
    });
  }
  function startFresh() {
    HH.confirmStep({
      title: "Start fresh?", yes: "Next", no: "Keep my recipes",
      text: "This deletes every recipe, planned meal, pantry item and list item from this browser. If you might want them again, cancel and use Back up now first.",
      onYes: function () {
        HH.confirmStep({
          title: "Delete everything now?", yes: "Yes, delete everything", no: "Cancel", danger: true, text: "This can't be undone without a backup.",
          onYes: function () { var theme = D.settings.theme; D = blank(); D.settings.theme = theme; save(); startWelcome(); HH.toast("Everything was deleted. Starting fresh."); }
        });
      }
    });
  }

  // ── wiring ───────────────────────────────────────────────────────
  function wire() {
    $$("[data-nav]").forEach(function (b) {
      b.addEventListener("click", function () {
        var id = b.getAttribute("data-nav");
        if (id === "planner" || id === "list") { if (viewWeek === null) viewWeek = weekStartOf(T); }
        go(id);
      });
    });
    $("#plan-week-btn").addEventListener("click", function () { viewWeek = weekStartOf(T); go("planner"); });
    $("#hc-list").addEventListener("click", function () { viewWeek = weekStartOf(T); go("list"); });
    $("#hc-recipes").addEventListener("click", function () { go("recipes"); });
    $("#rc-add").addEventListener("click", function () { openEdit(null, "recipes"); });
    $("#rf-q").addEventListener("input", function () { filt.q = $("#rf-q").value; renderRecipeList(); });
    $("#rf-sort").addEventListener("change", function () { filt.sort = $("#rf-sort").value; renderRecipeList(); });
    $("#rf-tags").addEventListener("change", function (ev) {
      var t = ev.target.getAttribute("data-tag");
      if (t == null) return;
      filt.tags = filt.tags.filter(function (x) { return x !== t; });
      if (ev.target.checked) filt.tags.push(t);
      renderRecipeList();
    });
    $("#rf-clear").addEventListener("click", function () { filt.q = ""; filt.tags = []; renderRecipes(); });
    // recipe view
    $("#rv-minus").addEventListener("click", function () { setServes(viewServes - 1); });
    $("#rv-plus").addEventListener("click", function () { setServes(viewServes + 1); });
    $("#rv-serves").addEventListener("input", function () {
      var s = $("#rv-serves").value.trim();
      if (!/^\d+$/.test(s)) return;
      var n = parseInt(s, 10);
      if (n > 99) { setServes(99); return; }
      if (n >= 1) { viewServes = n; renderIngs(); }
    });
    $("#rv-serves").addEventListener("change", function () { $("#rv-serves").value = String(viewServes); });
    $("#rv-plan").addEventListener("click", function () { openPlan(null, { recipe: viewId, serves: viewServes, from: "planner" }); });
    $("#rv-edit").addEventListener("click", function () { openEdit(viewId, "recipe"); });
    $("#rv-back").addEventListener("click", function () { go(viewReturn); });
    // recipe edit
    $("#re-form").addEventListener("submit", saveRecipe);
    $("#re-cancel").addEventListener("click", function () { if (editReturn === "recipe" && recipeById(editId)) openRecipe(editId, null, viewReturn); else go(editReturn); });
    $("#re-delete").addEventListener("click", deleteRecipe);
    $("#ing-add").addEventListener("click", function () {
      $("#re-ings").insertAdjacentHTML("beforeend", ingRow());
      var rows = $$("#re-ings .ing-row");
      $(".ing-amt", rows[rows.length - 1]).focus();
    });
    $("#re-ings").addEventListener("click", function (ev) {
      var b = ev.target.closest ? ev.target.closest(".ing-del") : null;
      if (!b) return;
      var row = b.closest(".ing-row");
      if ($$("#re-ings .ing-row").length > 1) row.parentNode.removeChild(row);
      else $$("input", row).forEach(function (i) { i.value = ""; });
    });
    $("#re-ings").addEventListener("change", function (ev) {
      var el = ev.target;
      if (el.classList.contains("ing-aisle")) { el.setAttribute("data-touched", "1"); return; }
      if (!el.classList.contains("ing-item")) return;
      var sel = $(".ing-aisle", el.closest(".ing-row"));
      if (sel.getAttribute("data-touched")) return;
      var a = knownAisle(el.value);
      if (a) sel.value = a;
    });
    // planner
    document.addEventListener("click", function (ev) {
      var t = ev.target.closest ? ev.target.closest("[data-week],[data-add-meal],[data-edit-meal],[data-open-meal],[data-view-recipe],[data-del-own]," +
        "[data-edit-pantry],[data-del-pantry],[data-ai-up],[data-ai-down],[data-ai-del],[data-clear-sample],[data-backup],[data-dismiss-backup]") : null;
      if (!t) return;
      if (t.hasAttribute("data-week")) moveWeek(+t.getAttribute("data-week"));
      else if (t.hasAttribute("data-add-meal")) openPlan(null, { date: HH.parseIso(t.getAttribute("data-add-meal")), from: "planner" });
      else if (t.hasAttribute("data-edit-meal")) openPlan(planById(+t.getAttribute("data-edit-meal")), { from: "planner" });
      else if (t.hasAttribute("data-open-meal")) {
        var e = planById(+t.getAttribute("data-open-meal"));
        if (!e) return;
        if (e.recipe != null && recipeById(e.recipe)) openRecipe(e.recipe, e.serves, "home"); else openPlan(e, { from: "home" });
      }
      else if (t.hasAttribute("data-view-recipe")) openRecipe(+t.getAttribute("data-view-recipe"), null, "recipes");
      else if (t.hasAttribute("data-del-own")) removeOwn(+t.getAttribute("data-del-own"));
      else if (t.hasAttribute("data-edit-pantry")) { pantryForm(D.pantry.filter(function (x) { return x.id === +t.getAttribute("data-edit-pantry"); })[0]); window.scrollTo(0, 0); $("#pa-item").focus(); }
      else if (t.hasAttribute("data-del-pantry")) removePantry(+t.getAttribute("data-del-pantry"));
      else if (t.hasAttribute("data-ai-up")) moveAisle(+t.getAttribute("data-ai-up"), -1);
      else if (t.hasAttribute("data-ai-down")) moveAisle(+t.getAttribute("data-ai-down"), 1);
      else if (t.hasAttribute("data-ai-del")) removeAisle(+t.getAttribute("data-ai-del"));
      else if (t.hasAttribute("data-clear-sample")) clearSample();
      else if (t.hasAttribute("data-backup")) backup();
      else if (t.hasAttribute("data-dismiss-backup")) { D.meta.reminderDismissed = HH.iso(T); save(); renderBanners(); }
    });
    $("#copy-last").addEventListener("click", copyLastWeek);
    $("#pe-form").addEventListener("submit", savePlan);
    $("#pe-cancel").addEventListener("click", function () { go(planReturn === "home" ? "home" : "planner"); });
    $("#pe-delete").addEventListener("click", deletePlan);
    $("#pe-open").addEventListener("click", function () { var e = planById(planId); if (e && e.recipe != null) openRecipe(e.recipe, e.serves, "planner"); });
    $$('input[name="pe-kind"]').forEach(function (r) { r.addEventListener("change", function () { planKind(r.value); }); });
    $("#pe-recipe").addEventListener("change", function () {
      var r = recipeById(+$("#pe-recipe").value);
      if (r && !servesDirty) $("#pe-serves").value = String(r.serves);
    });
    $("#pe-serves").addEventListener("input", function () { servesDirty = true; });
    // list
    $("#ls-groups").addEventListener("change", onTick);
    $("#ls-check").addEventListener("change", onTick);
    $("#ls-clear-ticks").addEventListener("click", clearTicks);
    $("#ls-own-jump").addEventListener("click", function () { $("#own-form").scrollIntoView({ block: "center" }); $("#own-item").focus({ preventScroll: true }); });
    $("#own-form").addEventListener("submit", addOwn);
    // pantry
    $("#pa-form").addEventListener("submit", savePantry);
    $("#pa-cancel").addEventListener("click", function () { pantryForm(null); });
    // settings
    $$('input[name="ws"]').forEach(function (r) {
      r.addEventListener("change", function () { D.settings.weekStart = +r.value; viewWeek = null; save(); render(); });
    });
    $("#ai-list").addEventListener("change", function (ev) { if (ev.target.classList.contains("ai-name")) renameAisle(ev.target); });
    $("#ai-list").addEventListener("keydown", function (ev) { if (ev.key === "Enter" && ev.target.classList.contains("ai-name")) { ev.preventDefault(); ev.target.blur(); } });
    $("#ai-form").addEventListener("submit", addAisle);
    $$('input[name="theme"]').forEach(function (r) { r.addEventListener("change", function () { D.settings.theme = r.value; save(); HH.applyTheme(r.value); }); });
    $("#backup-btn").addEventListener("click", backup);
    $("#restore-file").addEventListener("change", onRestoreFile);
    $("#sample-btn").addEventListener("click", function () {
      if (D.meta.sample) { clearSample(); return; }
      if (hasOwn()) { $("#sample-state").textContent = "Sample recipes only load into an empty app. Back up, then Start fresh, if you want to look at them."; return; }
      loadSample();
    });
    $("#fresh-btn").addEventListener("click", startFresh);
    $("#help-btn").addEventListener("click", function () { go("help"); });
    $("#help-back").addEventListener("click", function () { go("settings"); });
    // first run
    $("#w-form1").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var r = $$('input[name="w-ws"]').filter(function (x) { return x.checked; })[0];
      D.settings.weekStart = r ? +r.value : 1;
      viewWeek = null;
      save();
      welcomeStep(2);
    });
    $("#w-sample").addEventListener("click", loadSample);
    $("#w-add").addEventListener("click", function () { D.meta.onboarded = true; save(); openEdit(null, "recipes"); });
    $("#w-skip2").addEventListener("click", function () { welcomeStep(3); });
    $("#w-finish").addEventListener("click", function () { D.meta.onboarded = true; save(); viewWeek = weekStartOf(T); go("planner"); });
    document.addEventListener("visibilitychange", function () {
      if (document.hidden || !D.meta.onboarded) return;
      var s = current();
      if (s === "home" || s === "planner" || s === "list" || s === "recipes" || s === "pantry") render();
    });
  }
  function onTick(ev) {
    var k = ev.target.getAttribute && ev.target.getAttribute("data-tick");
    if (k != null) toggleTick(k, ev.target.checked);
  }

  // ── start ────────────────────────────────────────────────────────
  function start() {
    var raw = store.read();
    if (raw) {
      var r = migrate(raw);
      if (r.data) D = r.data;
      else { try { window.localStorage.setItem("hh142_unreadable_" + HH.iso(HH.today()), JSON.stringify(raw)); } catch (e) { /* nothing more to do */ } D = blank(); }
    } else D = blank();
    wire();
    if (D.meta.onboarded) go("home"); else startWelcome();
  }

  // for the QA runner (qa/app_qa142.py)
  window.HH142 = {
    parseAmount: parseAmount, fmtAmount: fmtAmount, normItem: normItem, normUnit: normUnit, migrate: migrate, SCHEMA: SCHEMA, APP_ID: APP_ID,
    weekStartOf: function (iso) { return HH.iso(weekStartOf(HH.parseIso(iso))); },
    groceries: function (iso) { return JSON.parse(JSON.stringify(groceries(HH.parseIso(iso)))); },
    viewWeek: function () { return viewWeek === null ? null : HH.iso(viewWeek); },
    data: function () { return D; }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
