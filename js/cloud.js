/* =====================================================================
   cloud.js — ربط ملف الإنجاز بـ Supabase (حسابات، حفظ سحابي، مرفقات)
   يعمل فقط عند ضبط js/config.js، وإلا يبقى الموقع بوضعه المحلي الأصلي.
   ===================================================================== */
(function () {
  "use strict";
  var CFG = window.APP_CONFIG || {};
  var LIBS = CFG.SUPABASE_JS ? [CFG.SUPABASE_JS] : ["https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.110.1", "https://unpkg.com/@supabase/supabase-js@2.110.1"];
  var BUCKET = "evidence", SIGN_TTL = 86400, MAXMB = +CFG.MAX_FILE_MB || 10;
  var C = window.CLOUD = {};
  C.enabled = function () { return !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY); };
  function secretKey(k) { k = String(k || ""); if (/^sb_secret_/.test(k)) return true; try { var p = k.split(".")[1]; return !!p && /service_role/.test(atob(p.replace(/-/g, "+").replace(/_/g, "/"))); } catch (e) { return false; } }
  C.secretKey = secretKey;

  var sb = null, USER = null, PROF = null, GATE = null, OFFLINE_MODE = false;
  var SYNC = { pf: null, st: null, rp: {}, ver: { pf: 0, rp: {} }, known: {}, busy: false, again: false, retry: 0, timer: 0, gen: 0, themeJ: "" };
  var qs = function (s) { return document.querySelector(s); };
  var E = function (t) { return String(t == null ? "" : t).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var uuid = function () { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16); }); };
  function hash(str) { var h = 2166136261; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36) + ":" + str.length; }

  /* ---------- نسخة محلية لكل حساب (IndexedDB) ---------- */
  var IDB = {
    db: null,
    open: function () { if (!this.db) this.db = new Promise(function (ok, no) { try { var r = indexedDB.open("portfolio-cloud", 1); r.onupgradeneeded = function () { r.result.createObjectStore("kv"); }; r.onsuccess = function () { ok(r.result); }; r.onerror = function () { no(r.error); }; } catch (e) { no(e); } }); return this.db; },
    get: function (k) { return this.open().then(function (d) { return new Promise(function (ok, no) { var t = d.transaction("kv").objectStore("kv").get(k); t.onsuccess = function () { ok(t.result); }; t.onerror = function () { no(t.error); }; }); }).catch(function () { return null; }); },
    set: function (k, v) { return this.open().then(function (d) { return new Promise(function (ok, no) { var tx = d.transaction("kv", "readwrite"); tx.objectStore("kv").put(v, k); tx.oncomplete = function () { ok(true); }; tx.onerror = function () { no(tx.error); }; }); }).catch(function () { return false; }); },
    del: function (k) { return this.open().then(function (d) { return new Promise(function (ok) { var tx = d.transaction("kv", "readwrite"); tx.objectStore("kv").delete(k); tx.oncomplete = function () { ok(true); }; tx.onerror = function () { ok(false); }; }); }).catch(function () { return false; }); }
  };
  function themeJson() { return JSON.stringify(Object.assign({}, TS, { cur: SV.cur, tpl: SV.tpl })); }
  function cacheWrite(isDirty) { if (!USER) return Promise.resolve(); try { localStorage.setItem("cloud_last_uid", USER.id); } catch (e) {} return IDB.set("u:" + USER.id, { S: JSON.stringify(S), T: themeJson(), dirty: !!isDirty, at: Date.now(), email: USER.email || "", name: (PROF && PROF.full_name) || "" }); }

  /* ---------- تحميل مكتبة Supabase ---------- */
  function loadOne(src) { return new Promise(function (ok, no) { var s = document.createElement("script"); s.src = src; s.onload = function () { window.supabase && window.supabase.createClient ? ok() : no(new Error("lib")); }; s.onerror = function () { s.remove(); no(new Error("lib")); }; document.head.appendChild(s); }); }
  async function loadLib() { if (window.supabase && window.supabase.createClient) return; var err; for (var i = 0; i < LIBS.length; i++) { try { await loadOne(LIBS[i]); return; } catch (e) { err = e; } } throw err || new Error("lib"); }

  /* ---------- الإقلاع ---------- */
  C.boot = function () {
    injectCss();
    for (var k in DEF) DEF[k] = ""; for (var k2 in OLDFIX) OLDFIX[k2] = "";
    hookGlobals();
    if (secretKey(CFG.SUPABASE_ANON_KEY)) { GATE = { v: "error", msg: "تم إيقاف الموقع للحماية: المفتاح المكتوب في js/config.js مفتاح سري (Secret / service_role) لا يجوز نشره. استبدله فوراً بالمفتاح العام Publishable، ثم من لوحة Supabase أنشئ مفتاحاً سرياً جديداً وألغِ القديم." }; drawGate(); return; }
    GATE = { v: "loading" }; drawGate();
    loadLib().then(function () {
      sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
      C.sb = sb;
      sb.auth.onAuthStateChange(function (ev, session) {
        if (ev === "PASSWORD_RECOVERY") { USER = session && session.user; GATE = { v: "reset" }; drawGate(); }
        else if (ev === "SIGNED_OUT") { USER = null; PROF = null; GATE = { v: "login" }; drawGate(); }
      });
      return sb.auth.getSession();
    }).then(function (r) {
      if (GATE && GATE.v === "reset") return;
      var session = r && r.data && r.data.session;
      if (session) return afterLogin(session.user); GATE = { v: "login" }; drawGate();
    }).catch(function (e) { console.warn(e); GATE = { v: "error", msg: "تعذر الاتصال بالخادم. تحقق من الإنترنت ثم أعد المحاولة." }; drawGate(); });
    window.addEventListener("online", function () { if (USER && !OFFLINE_MODE && (dirty || SYNC.retry)) window.save(); });
    window.addEventListener("offline", function () { if (USER) setSt("offline"); });
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") pull(); });
    setInterval(pull, 120000); setInterval(refreshUrls, 6 * 3600 * 1000);
  };

  async function afterLogin(user) {
    USER = user; GATE = { v: "loading" }; drawGate();
    var r = await sb.from("profiles").select("*").eq("id", user.id).maybeSingle();
    if (r.error || !r.data) { GATE = { v: "error", msg: "تعذر قراءة بيانات الحساب. أعد المحاولة لاحقاً." }; drawGate(); return; }
    PROF = r.data;
    if (PROF.status !== "approved") { GATE = { v: "status" }; drawGate(); return; }
    try { await loadAll(); } catch (e) { console.warn(e); return openOfflineCopy("تعذر تحميل بياناتك من الخادم."); }
    GATE = null; loaded = true; render(); userBar(); setSt(dirty ? "dirty" : "saved");
    refreshUrls().then(function () { if (!GATE) rr0(); });
    if (dirty) window.save();
    offerLegacy();
  }

  /* ---------- قراءة البيانات من الخادم ---------- */
  async function fetchServer() {
    var q = await Promise.all([
      sb.from("portfolios").select("data,version").eq("owner_id", USER.id).maybeSingle(),
      sb.from("reports").select("id,ev_key,pos,data,version").eq("owner_id", USER.id).order("pos"),
      sb.from("user_settings").select("theme").eq("owner_id", USER.id).maybeSingle(),
      sb.from("evidence").select("path").eq("owner_id", USER.id)
    ]);
    q.forEach(function (x) { if (x.error) throw x.error; });
    return { pf: q[0].data, rp: q[1].data || [], st: q[2].data, ev: q[3].data || [] };
  }
  function buildState(sv) {
    var S2 = Object.assign({ meta: {}, ev: {} }, (sv.pf && sv.pf.data) || {}); S2.ev = {};
    S2.meta = Object.assign({ year: "1448هـ", term: "الأول", dt: "", students: "", lic: "", licExp: "", courses: "", logo: null }, S2.meta || {});
    SYNC.ver = { pf: sv.pf ? sv.pf.version : 0, rp: {} }; SYNC.rp = {};
    sv.rp.slice().sort(function (a, b) { return a.pos - b.pos; }).forEach(function (r) {
      var en = Object.assign({}, r.data, { _id: r.id }); (S2.ev[r.ev_key] = S2.ev[r.ev_key] || []).push(en); SYNC.ver.rp[r.id] = r.version;
    });
    for (var k in S2.ev) S2.ev[k].forEach(function (en, i) { SYNC.rp[en._id] = hash(ser(en)) + "@" + k + ":" + i; });
    var rest = Object.assign({}, S2); delete rest.ev; SYNC.pf = hash(ser(rest));
    SYNC.known = {}; sv.ev.forEach(function (e) { SYNC.known[e.path] = 1; });
    return S2;
  }
  async function loadAll() {
    var sv = await fetchServer();
    var S2 = buildState(sv);
    var th = sv.st && sv.st.theme && Object.keys(sv.st.theme).length ? sv.st.theme : null;
    SYNC.st = th ? hash(JSON.stringify(th)) : null;
    var cache = await IDB.get("u:" + USER.id);
    if (cache && cache.dirty && cache.S) {      // تعديلات محلية لم تُرفع بعد: تُعتمد وتُرفع
      S = Object.assign({ meta: {}, ev: {} }, JSON.parse(cache.S)); dirty = true;
      try { var t = JSON.parse(cache.T); TS = normTs(t); TH = TS.cur; } catch (e) {}
    } else {
      S = S2; dirty = false;
      if (th) { TS = normTs(th); TH = TS.cur; } else { TS = normTs({}); TH = TS.cur; }
    }
    migrate(); applyTheme(); SYNC.themeJ = themeJson();
    await cacheWrite(dirty);
  }

  /* ---------- مزامنة من أجهزة أخرى ---------- */
  async function pull() {
    if (!sb || !USER || GATE || dirty || SYNC.busy || OFFLINE_MODE || document.body.classList.contains("printing")) return;
    try {
      var q = await Promise.all([sb.from("portfolios").select("version").eq("owner_id", USER.id).maybeSingle(), sb.from("reports").select("id,version").eq("owner_id", USER.id)]);
      if (q[0].error || q[1].error) return;
      var changed = (q[0].data && q[0].data.version !== SYNC.ver.pf) || q[1].data.length !== Object.keys(SYNC.ver.rp).length || q[1].data.some(function (r) { return SYNC.ver.rp[r.id] !== r.version; });
      if (!changed || dirty) return;
      var sv = await fetchServer(); if (dirty) return;
      S = buildState(sv); migrate(); await refreshUrls(); await cacheWrite(false);
      var ae = document.activeElement;
      if (document.querySelector("#md")) { }
      else if (ae && /INPUT|TEXTAREA|SELECT/.test(ae.tagName)) { ae.addEventListener("blur", function () { setTimeout(function () { if (!document.querySelector("#md")) rr0(); }, 50); }, { once: true }); }
      else rr0();
      toast("تم تحديث البيانات من جهاز آخر");
    } catch (e) {}
  }

  /* ---------- الحفظ السحابي ---------- */
  function ser(o) { return JSON.stringify(o, function (k, v) { if (v && typeof v === "object" && !Array.isArray(v) && v.path && v.url) { var c = Object.assign({}, v); delete c.url; return c; } return v; }); }
  function walkFiles(root, cb) { (function w(o, d) { if (!o || typeof o !== "object" || d > 9) return; if (!Array.isArray(o) && (o.path || typeof o.url === "string" || typeof o.data === "string")) cb(o); for (var k in o) if (k !== "_id") w(o[k], d + 1); })(root, 0); }

  function hookGlobals() {
    var T0 = window.touch; window.touch = function () { SYNC.gen++; return T0.apply(this, arguments); };
    window.save = async function () { clearTimeout(tm); clearTimeout(SYNC.timer); if (!USER) return; await cacheWrite(true); if (OFFLINE_MODE || !navigator.onLine) { setSt("offline"); return; } await flush(); };
    window.persist = async function () { SYNC.themeJ = themeJson(); dirty = true; SYNC.gen++; await cacheWrite(true); clearTimeout(tm); tm = setTimeout(window.save, 800); };
    var ST_TXT = { saved: "✔ محفوظ سحابياً", dirty: "● تعديلات بانتظار الحفظ", saving: "… جارٍ الحفظ في السحابة", offline: "⚠ غير متصل — محفوظ على هذا الجهاز وسيُرفع تلقائياً", error: "✕ تعذّر الحفظ — ستتم إعادة المحاولة", conflict: "⚠ تعارض مع جهاز آخر" };
    window.setSt = function (s) { state = s; var e = qs("#sv"); if (e) { e.textContent = ST_TXT[s] || s; e.className = "sv " + s; } var b = qs("#cbst"); if (b) { b.textContent = ST_TXT[s] || s; b.className = "cbst " + s; } };
    var R0 = window.render; C._render = R0;
    window.render = function () { if (GATE) { drawGate(); return; } R0(); userBar(); };
    window.up = cloudUp;
    window.addEventListener("beforeunload", function (e) { if (USER && (dirty || SYNC.busy)) { e.preventDefault(); e.returnValue = ""; } });
  }
  function rr0() { var y = window.scrollY; render(); scrollTo(0, y); }

  async function flush() {
    if (SYNC.busy) { SYNC.again = true; return; }
    SYNC.busy = true; var g0 = SYNC.gen; setSt("saving");
    try {
      await liftImages();
      var conflicts = [];
      // 1) البيانات الأساسية
      var rest = Object.assign({}, S); delete rest.ev; var pj = ser(rest), ph = hash(pj);
      if (ph !== SYNC.pf) {
        var u = await sb.from("portfolios").update({ data: JSON.parse(pj) }).eq("owner_id", USER.id).eq("version", SYNC.ver.pf).select("version");
        if (u.error) throw u.error;
        if (!u.data.length) conflicts.push({ t: "pf" }); else { SYNC.ver.pf = u.data[0].version; SYNC.pf = ph; }
      }
      // 2) التصميم
      var tj = SYNC.themeJ || themeJson(), th = hash(tj);
      if (th !== SYNC.st) { var s2 = await sb.from("user_settings").upsert({ owner_id: USER.id, theme: JSON.parse(tj) }); if (s2.error) throw s2.error; SYNC.st = th; }
      // 3) التقارير
      var seen = {};
      for (var key in S.ev) {
        var arr = S.ev[key] || [];
        for (var i = 0; i < arr.length; i++) {
          var en = arr[i]; if (!en) continue; if (!en._id) en._id = uuid(); seen[en._id] = 1;
          var copy = Object.assign({}, en); delete copy._id; var dj = ser(copy), sig = hash(ser(en)) + "@" + key + ":" + i;
          if (SYNC.rp[en._id] === sig) continue;
          if (SYNC.ver.rp[en._id]) {
            var up1 = await sb.from("reports").update({ ev_key: key, pos: i, data: JSON.parse(dj) }).eq("id", en._id).eq("version", SYNC.ver.rp[en._id]).select("version");
            if (up1.error) throw up1.error;
            if (!up1.data.length) { conflicts.push({ t: "rp", id: en._id, key: key, i: i, data: dj }); continue; }
            SYNC.ver.rp[en._id] = up1.data[0].version;
          } else {
            var ins = await sb.from("reports").insert({ id: en._id, owner_id: USER.id, ev_key: key, pos: i, data: JSON.parse(dj) }).select("version");
            if (ins.error) throw ins.error; SYNC.ver.rp[en._id] = ins.data[0].version;
          }
          SYNC.rp[en._id] = sig;
        }
      }
      var gone = Object.keys(SYNC.rp).filter(function (id) { return !seen[id]; });
      if (gone.length) { var d = await sb.from("reports").delete().in("id", gone); if (d.error) throw d.error; gone.forEach(function (id) { delete SYNC.rp[id]; delete SYNC.ver.rp[id]; }); }
      if (conflicts.length) await resolveConflicts(conflicts);
      await cleanupFiles();
      SYNC.retry = 0;
      if (SYNC.gen === g0 && !conflicts.length) { dirty = false; await cacheWrite(false); setSt("saved"); }
      else { await cacheWrite(true); setSt("dirty"); clearTimeout(tm); tm = setTimeout(window.save, 1200); }
    } catch (e) {
      console.warn("save failed", e); SYNC.retry++;
      setSt(navigator.onLine ? "error" : "offline");
      var wait = Math.min(60000, 2000 * Math.pow(2, Math.min(SYNC.retry, 5)));
      clearTimeout(SYNC.timer); SYNC.timer = setTimeout(window.save, wait);
    } finally {
      SYNC.busy = false; if (SYNC.again) { SYNC.again = false; setTimeout(window.save, 300); }
    }
  }

  async function resolveConflicts(list) {
    setSt("conflict");
    var keepMine = window.confirm("تم تعديل بعض بياناتك من جهاز آخر بعد آخر مزامنة على هذا الجهاز.\n\n• اضغط «موافق» للاحتفاظ بنسخة هذا الجهاز واستبدال النسخة الأخرى.\n• اضغط «إلغاء» لتحميل النسخة الأحدث من الخادم.");
    if (keepMine) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (c.t === "pf") { var v = await sb.from("portfolios").select("version").eq("owner_id", USER.id).single(); if (v.error) throw v.error; SYNC.ver.pf = v.data.version; SYNC.pf = null; }
        else { var r = await sb.from("reports").select("version").eq("id", c.id).maybeSingle(); if (r.error) throw r.error; if (r.data) SYNC.ver.rp[c.id] = r.data.version; else delete SYNC.ver.rp[c.id]; delete SYNC.rp[c.id]; }
      }
      SYNC.gen++; // يعيد الحفظ مباشرة بالإصدارات الجديدة
    } else {
      var sv = await fetchServer(); S = buildState(sv); migrate(); await refreshUrls(); dirty = false; SYNC.gen++; rr0();
    }
  }

  /* ---------- المرفقات ---------- */
  var MIME_OK = /^(image\/(jpeg|png|webp|gif)|application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document)$/;
  function extOf(m, name) { return ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "application/pdf": "pdf", "application/msword": "doc", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx" })[m] || (String(name || "").split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5); }
  function compress(file, hq) {
    return new Promise(function (ok) {
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return ok(file);
      var im = new Image(); im.onerror = function () { ok(file); };
      im.onload = function () { var mx = hq ? 2400 : 2000, k = Math.min(1, mx / Math.max(im.width, im.height)), c = document.createElement("canvas"); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k); var x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0, c.width, c.height); c.toBlob(function (b) { ok(b && b.size < file.size ? b : file); }, "image/jpeg", hq ? 0.92 : 0.85); };
      im.src = URL.createObjectURL(file);
    });
  }
  async function putFile(blob, name, mime) {
    var path = USER.id + "/" + new Date().getFullYear() + "/" + uuid() + "." + extOf(mime, name);
    var r = await sb.storage.from(BUCKET).upload(path, blob, { contentType: mime, upsert: false });
    if (r.error) throw r.error;
    var ins = await sb.from("evidence").insert({ path: path, name: String(name || "").slice(0, 255), mime: mime, size_bytes: blob.size });
    if (ins.error) console.warn(ins.error);
    SYNC.known[path] = 1;
    var s = await sb.storage.from(BUCKET).createSignedUrl(path, SIGN_TTL);
    return { path: path, url: s.data ? s.data.signedUrl : "" };
  }
  async function cloudUp(file, hq) {
    if (!file) return null;
    if (!MIME_OK.test(file.type)) { toast("نوع الملف غير مدعوم. المسموح: صور، PDF، Word"); return null; }
    if (OFFLINE_MODE || !navigator.onLine) { var u = await shrink(file, hq); if (u) toast("غير متصل: سيُرفع الملف تلقائياً عند عودة الاتصال"); return u ? { id: "", url: u } : null; }
    var blob = await compress(file, hq), mime = blob === file ? file.type : "image/jpeg";
    if (blob.size > MAXMB * 1048576) { toast("حجم الملف أكبر من " + MAXMB + " ميغابايت"); return null; }
    try { var r = await putFile(blob, file.name, mime); return { id: r.path, path: r.path, url: r.url }; }
    catch (e) { console.warn(e); toast("تعذر رفع الملف. حاول مرة أخرى"); return null; }
  }
  function dataUrlToBlob(d) { var m = /^data:([^;,]+)(;base64)?,(.*)$/.exec(d); if (!m) return null; var raw = m[2] ? atob(m[3]) : decodeURIComponent(m[3]); var u = new Uint8Array(raw.length); for (var i = 0; i < raw.length; i++) u[i] = raw.charCodeAt(i); return new Blob([u], { type: m[1] }); }
  async function liftImages() {   // يرفع الصور المضمّنة (من نسخة احتياطية أو بيانات محلية قديمة) إلى التخزين
    var list = []; walkFiles(S, function (o) { if (o.path) return; var d = typeof o.data === "string" && o.data.indexOf("data:") === 0 ? o.data : (typeof o.url === "string" && o.url.indexOf("data:") === 0 ? o.url : ""); if (d) list.push([o, d]); });
    for (var i = 0; i < list.length; i++) {
      var o = list[i][0], blob = dataUrlToBlob(list[i][1]); if (!blob) continue;
      var mime = MIME_OK.test(blob.type) ? blob.type : "image/jpeg";
      var r = await putFile(blob, o.name || "image", mime);
      o.path = r.path; o.id = r.path; o.url = r.url; delete o.data; if (!o.type) o.type = mime;
    }
    if (list.length) setTimeout(rr0, 0);
  }
  async function refreshUrls() {
    if (!sb || !USER) return; var objs = []; walkFiles(S, function (o) { if (o.path) objs.push(o); });
    for (var i = 0; i < objs.length; i += 100) {
      var part = objs.slice(i, i + 100), r = await sb.storage.from(BUCKET).createSignedUrls(part.map(function (o) { return o.path; }), SIGN_TTL);
      if (r.error || !r.data) continue;
      var map = {}; r.data.forEach(function (x) { if (x && x.path && x.signedUrl) map[x.path] = x.signedUrl; });
      part.forEach(function (o) { if (map[o.path]) o.url = map[o.path]; });
    }
  }
  async function cleanupFiles() {
    var ref = {}; walkFiles(S, function (o) { if (o.path) ref[o.path] = 1; });
    var drop = Object.keys(SYNC.known).filter(function (p) { return !ref[p]; });
    if (!drop.length) return;
    var r = await sb.storage.from(BUCKET).remove(drop);
    if (!r.error) { await sb.from("evidence").delete().in("path", drop); drop.forEach(function (p) { delete SYNC.known[p]; }); }
  }

  /* ---------- ترحيل البيانات المحلية القديمة ---------- */
  function offerLegacy() {
    var raw = null; try { raw = localStorage.getItem("portfolio"); } catch (e) {}
    if (!raw) return; var done = ""; try { done = localStorage.getItem("portfolio_migrated_to") || ""; } catch (e) {}
    if (done.indexOf(USER.id) >= 0) return;
    var old; try { old = JSON.parse(raw); } catch (e) { return; }
    var n = 0; for (var k in (old.ev || {})) n += (old.ev[k] || []).length;
    var hasMine = Object.keys(S.ev || {}).some(function (k) { return (S.ev[k] || []).some(function (e) { return e && !e.sd; }); });
    if (!n || hasMine) return;
    modal('<h3>📦 وجدنا ملف إنجاز محفوظاً على هذا الجهاز</h3><p>يحتوي على <b>' + n + '</b> تقريراً من الاستخدام السابق دون حساب. هل تريد نقله إلى حسابك ليُحفظ سحابياً؟</p><p class="sm">لن تُحذف النسخة المحلية؛ يمكنك تنزيل نسخة احتياطية منها أولاً.</p><div class="bar"><button class="pri" onclick="CLOUD.migrateLegacy()">نقل إلى حسابي</button><button onclick="CLOUD.legacyBackup()">تنزيل نسخة احتياطية أولاً</button><button onclick="CLOUD.legacySkip()">لاحقاً</button></div>');
  }
  C.legacyBackup = function () { try { saveFile("backup-local-portfolio.json", new Blob([localStorage.getItem("portfolio")], { type: "application/json" })); } catch (e) {} };
  C.legacySkip = function () { mClose(); };
  C.migrateLegacy = async function () {
    mClose(); var old = JSON.parse(localStorage.getItem("portfolio"));
    var keepMeta = S.meta || {}; S = Object.assign({ meta: {}, ev: {} }, unpackImages(old)); S.meta = Object.assign({}, keepMeta, old.meta || {});
    try { var t = localStorage.getItem("theme"); if (t) { TS = normTs(JSON.parse(t)); TH = TS.cur; SV = { cur: Object.assign({}, TH), tpl: TS.tpl }; applyTheme(); SYNC.themeJ = themeJson(); } } catch (e) {}
    migrate(); touch(); rr0(); toast("جارٍ نقل البيانات ورفع الصور…");
    await window.save();
    try { localStorage.setItem("portfolio_migrated_to", (localStorage.getItem("portfolio_migrated_to") || "") + " " + USER.id); } catch (e) {}
    toast(dirty ? "سيُستكمل النقل عند عودة الاتصال" : "تم نقل ملف الإنجاز إلى حسابك");
  };

  /* ---------- العمل دون اتصال عند تعذر الوصول للخادم ---------- */
  async function openOfflineCopy(why) {
    var uid = ""; try { uid = localStorage.getItem("cloud_last_uid") || ""; } catch (e) {}
    var cache = uid ? await IDB.get("u:" + uid) : null;
    if (!cache || !cache.S) { GATE = { v: "error", msg: why + " لا توجد نسخة محفوظة على هذا الجهاز." }; drawGate(); return; }
    GATE = { v: "error", msg: why, offline: true, who: cache.name || cache.email || "" }; drawGate();
  }
  C.useOffline = async function () {
    var uid = localStorage.getItem("cloud_last_uid"), cache = await IDB.get("u:" + uid);
    OFFLINE_MODE = true; USER = { id: uid, email: cache.email }; PROF = { full_name: cache.name, role: "teacher", status: "approved" };
    S = Object.assign({ meta: {}, ev: {} }, JSON.parse(cache.S)); try { TS = normTs(JSON.parse(cache.T)); TH = TS.cur; } catch (e) {}
    dirty = !!cache.dirty; migrate(); applyTheme(); GATE = null; loaded = true; render(); setSt("offline");
    toast("تعمل الآن على النسخة المحفوظة في هذا الجهاز؛ ستُرفع التعديلات عند الاتصال وإعادة فتح الموقع");
  };

  /* ---------- شاشات الدخول والتسجيل والحالة ---------- */
  var STAGES = ["رياض الأطفال", "ابتدائي", "متوسط", "ثانوي", "أخرى"];
  function head(t, sub) { return '<div class="ag-hd"><img src="' + LOGO + '" alt=""><div><b>ملف شواهد الأداء الوظيفي</b><span>' + E(t) + "</span></div></div>" + (sub ? '<p class="ag-sub">' + sub + "</p>" : ""); }
  function drawGate() {
    var g = GATE || { v: "loading" }, h = "";
    document.body.classList.remove("isadm"); var ub = qs("#cbar"); if (ub) ub.remove();
    if (g.v === "loading") h = head("جارٍ التحميل") + '<div class="ag-load"><span class="spin"></span> لحظات…</div>';
    else if (g.v === "login") h = head("تسجيل الدخول", g.note || "") + '<div id="ag-ann"></div><form onsubmit="CLOUD.login(event)"><label>البريد الإلكتروني<input id="ag-email" type="email" autocomplete="email" required dir="ltr" value="' + E(g.email || "") + '"></label><label>كلمة المرور<input id="ag-pass" type="password" autocomplete="current-password" required minlength="6" dir="ltr"></label><div class="ag-err" id="ag-err"></div><button class="pri ag-main" type="submit">دخول</button></form><div class="ag-links"><a href="javascript:CLOUD.go(\'forgot\')">نسيت كلمة المرور؟</a><a href="javascript:CLOUD.go(\'signup\')">إنشاء حساب جديد</a></div>';
    else if (g.v === "signup") h = head("إنشاء حساب جديد", "أنشئ حسابك ببريدك وكلمة مرور تختارها، وابدأ ملفك مباشرة. بياناتك خاصة بك ولا يراها غيرك.") + '<div id="ag-closed"></div><form onsubmit="CLOUD.signup(event)" id="ag-form"><div class="ag-g2">'
      + '<label class="w">الاسم الكامل<input id="su-name" required maxlength="120" autocomplete="name"></label>'
      + '<label>البريد الإلكتروني<input id="su-email" type="email" required dir="ltr" autocomplete="email"></label>'
      + '<label>رقم الجوال (اختياري)<input id="su-phone" type="tel" dir="ltr" maxlength="20" placeholder="05xxxxxxxx"></label>'
      + '<label>كلمة المرور<input id="su-pass" type="password" required minlength="8" dir="ltr" autocomplete="new-password" placeholder="8 أحرف على الأقل"></label>'
      + '<label>تأكيد كلمة المرور<input id="su-pass2" type="password" required minlength="8" dir="ltr" autocomplete="new-password"></label>'
      + '<label class="w">اسم المدرسة<input id="su-school" required maxlength="150"></label>'
      + '<label>المرحلة الدراسية<select id="su-stage" required><option value="">— اختر —</option>' + STAGES.map(function (s) { return "<option>" + s + "</option>"; }).join("") + "</select></label>"
      + '<label>التخصص<input id="su-spec" required maxlength="100" placeholder="مثال: الدراسات الإسلامية"></label>'
      + '<label class="w">الإدارة التعليمية<input id="su-edu" required maxlength="150" placeholder="مثال: الإدارة العامة للتعليم بالمنطقة الشرقية"></label>'
      + '</div><div class="ag-type"><span>نوع المستخدم</span><label class="opt"><input type="radio" name="su-type" value="m" checked><span>👨‍🏫 معلم</span></label><label class="opt"><input type="radio" name="su-type" value="f"><span>👩‍🏫 معلمة</span></label></div>'
      + '<div class="ag-err" id="ag-err"></div><button class="pri ag-main" type="submit">إرسال طلب التسجيل</button></form><div class="ag-links"><a href="javascript:CLOUD.go(\'login\')">لدي حساب — تسجيل الدخول</a></div>';
    else if (g.v === "forgot") h = head("استعادة كلمة المرور", "أدخل بريدك وسنرسل لك رابطاً لتعيين كلمة مرور جديدة.") + '<form onsubmit="CLOUD.forgot(event)"><label>البريد الإلكتروني<input id="ag-email" type="email" required dir="ltr"></label><div class="ag-err" id="ag-err"></div><button class="pri ag-main" type="submit">إرسال الرابط</button></form><div class="ag-links"><a href="javascript:CLOUD.go(\'login\')">رجوع لتسجيل الدخول</a></div>';
    else if (g.v === "reset") h = head("تعيين كلمة مرور جديدة") + '<form onsubmit="CLOUD.reset(event)"><label>كلمة المرور الجديدة<input id="rp-1" type="password" required minlength="8" dir="ltr" autocomplete="new-password"></label><label>تأكيدها<input id="rp-2" type="password" required minlength="8" dir="ltr" autocomplete="new-password"></label><div class="ag-err" id="ag-err"></div><button class="pri ag-main" type="submit">حفظ كلمة المرور</button></form>' + (g.back ? '<div class="ag-links"><a href="javascript:CLOUD.recheck()">رجوع دون تغيير</a></div>' : "");
    else if (g.v === "status") {
      var st = PROF && PROF.status, box = { pending: ["⏳", "حسابك بانتظار موافقة مدير النظام", "تم استلام طلب تسجيلك بنجاح. ستتمكن من الدخول إلى ملف إنجازك فور اعتماد الحساب."], rejected: ["✕", "تم رفض طلب التسجيل", ""], suspended: ["⏸", "الحساب موقوف مؤقتاً", "بياناتك محفوظة ولم تُحذف، وستعود عند إعادة تفعيل الحساب."] }[st] || ["!", "حالة الحساب غير معروفة", ""];
      h = head("حالة الحساب") + '<div class="ag-st ' + E(st) + '"><div class="ic">' + box[0] + "</div><b>" + box[1] + "</b><p>" + box[2] + "</p>" + (PROF && PROF.status_reason ? '<p class="rs">السبب: ' + E(PROF.status_reason) + "</p>" : "") + '<p class="sm">' + E(PROF && PROF.full_name || "") + " · " + E(PROF && PROF.email || "") + '</p></div><div class="bar ag-c"><button class="pri" onclick="CLOUD.recheck()">🔄 تحديث الحالة</button><button onclick="CLOUD.logout()">تسجيل الخروج</button></div>';
    }
    else if (g.v === "done") h = head(g.title || "تم") + '<div class="ag-st pending"><div class="ic">✔</div><b>' + E(g.title || "") + "</b><p>" + E(g.msg || "") + '</p></div><div class="bar ag-c"><button class="pri" onclick="CLOUD.go(\'login\')">تسجيل الدخول</button></div>';
    else if (g.v === "error") h = head("تعذر المتابعة") + '<div class="ag-st suspended"><div class="ic">!</div><p>' + E(g.msg || "") + "</p></div>" + '<div class="bar ag-c"><button class="pri" onclick="location.reload()">إعادة المحاولة</button>' + (g.offline ? '<button onclick="CLOUD.useOffline()">فتح نسختي على هذا الجهاز' + (g.who ? " (" + E(g.who) + ")" : "") + "</button>" : "") + "</div>";
    qs("#app").innerHTML = '<div class="ag"><div class="ag-card">' + h + "</div></div>";
    if (g.v === "login") loadAnnouncement();
    if (g.v === "signup") checkOpen();
  }
  function err(t) { var e = qs("#ag-err"); if (e) { e.textContent = t; e.style.display = t ? "block" : "none"; } }
  function busy(f, on) { var b = f && f.querySelector("button[type=submit]"); if (b) { b.disabled = on; b.dataset.t = b.dataset.t || b.textContent; b.textContent = on ? "… لحظات" : b.dataset.t; } }
  var AUTH_ERR = function (e) { var m = (e && (e.message || e.error_description)) || ""; if (/Invalid login credentials/i.test(m)) return "البريد أو كلمة المرور غير صحيحة."; if (/not authorized|Error sending|sending recovery|smtp/i.test(m)) return "تعذّر إرسال الرسالة إلى بريدك لأن خدمة البريد في المنصة لم تُفعَّل بعد. تواصل مع مدير النظام ليعيد تعيين كلمة المرور لك."; if (/already registered|already been registered|User already/i.test(m)) return "هذا البريد مسجل مسبقاً. جرّب تسجيل الدخول أو استعادة كلمة المرور."; if (/Email not confirmed/i.test(m)) return "لم يتم تأكيد البريد بعد. افتح رسالة التأكيد في بريدك."; if (/Password should be|weak/i.test(m)) return "كلمة المرور ضعيفة؛ استخدم 8 أحرف على الأقل."; if (/Database error saving new user|REGISTRATION_CLOSED/i.test(m)) return "التسجيل مغلق حالياً أو تعذّر إنشاء الحساب. تواصل مع مدير النظام."; if (/rate limit|too many/i.test(m)) return "محاولات كثيرة؛ انتظر قليلاً ثم أعد المحاولة."; if (/Failed to fetch|NetworkError|network/i.test(m)) return "تعذر الاتصال بالخادم. تحقق من الإنترنت."; return "حدث خطأ: " + m; };
  C.go = function (v) { GATE = { v: v }; drawGate(); window.scrollTo(0, 0); };
  async function loadAnnouncement() { try { var r = await sb.from("platform_settings").select("key,value"); var a = (r.data || []).find(function (x) { return x.key === "announcement"; }); var t = a && a.value; var e = qs("#ag-ann"); if (e && typeof t === "string" && t.trim()) e.innerHTML = '<div class="ag-ann">📢 ' + E(t) + "</div>"; } catch (e) {} }
  async function checkOpen() { try { var r = await sb.from("platform_settings").select("key,value").eq("key", "registration_open").maybeSingle(); if (r.data && r.data.value === false) { var f = qs("#ag-form"); if (f) f.style.display = "none"; qs("#ag-closed").innerHTML = '<div class="ag-st suspended"><div class="ic">🔒</div><b>التسجيل مغلق حالياً</b><p>تواصل مع مدير النظام.</p></div>'; } } catch (e) {} }
  C.login = async function (ev) {
    ev.preventDefault(); var f = ev.target; err(""); busy(f, true);
    var r = await sb.auth.signInWithPassword({ email: qs("#ag-email").value.trim(), password: qs("#ag-pass").value });
    busy(f, false); if (r.error) return err(AUTH_ERR(r.error)); afterLogin(r.data.user);
  };
  C.signup = async function (ev) {
    ev.preventDefault(); var f = ev.target; err("");
    var v = function (id) { return (qs("#" + id).value || "").trim(); };
    var d = { full_name: v("su-name"), phone: v("su-phone"), school: v("su-school"), stage: v("su-stage"), specialty: v("su-spec"), edu_admin: v("su-edu"), user_type: (qs('input[name="su-type"]:checked') || {}).value === "f" ? "f" : "m" };
    var email = v("su-email"), p1 = qs("#su-pass").value, p2 = qs("#su-pass2").value;
    if (d.full_name.split(/\s+/).length < 2) return err("اكتب الاسم الكامل (اسمان على الأقل).");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return err("البريد الإلكتروني غير صحيح.");
    if (d.phone && !/^[0-9+\s]{7,20}$/.test(d.phone)) return err("رقم الجوال غير صحيح.");
    if (p1.length < 8) return err("كلمة المرور يجب أن تكون 8 أحرف على الأقل.");
    if (p1 !== p2) return err("كلمتا المرور غير متطابقتين.");
    if (!d.school || !d.stage || !d.specialty || !d.edu_admin) return err("أكمل جميع الحقول المطلوبة.");
    busy(f, true);
    var r = await sb.auth.signUp({ email: email, password: p1, options: { data: d, emailRedirectTo: location.href.split("#")[0] } });
    busy(f, false);
    if (r.error) return err(AUTH_ERR(r.error));
    if (r.data && r.data.user && Array.isArray(r.data.user.identities) && r.data.user.identities.length === 0) return err(AUTH_ERR({ message: "already registered" }));
    if (r.data.session) { afterLogin(r.data.user); return; }
    GATE = { v: "done", title: "تم استلام طلب تسجيلك بنجاح، حسابك بانتظار موافقة مدير النظام", msg: "إذا طُلب منك تأكيد البريد فافتح الرسالة المرسلة إليك أولاً." }; drawGate();
  };
  C.forgot = async function (ev) {
    ev.preventDefault(); var f = ev.target; err(""); busy(f, true);
    var r = await sb.auth.resetPasswordForEmail(qs("#ag-email").value.trim(), { redirectTo: location.href.split("#")[0] });
    busy(f, false); if (r.error) return err(AUTH_ERR(r.error));
    GATE = { v: "done", title: "تم إرسال الرابط", msg: "افتح بريدك واضغط الرابط لتعيين كلمة مرور جديدة (تحقق من مجلد الرسائل غير المرغوبة)." }; drawGate();
  };
  C.reset = async function (ev) {
    ev.preventDefault(); var f = ev.target; err("");
    var a = qs("#rp-1").value, b = qs("#rp-2").value; if (a.length < 8) return err("8 أحرف على الأقل."); if (a !== b) return err("كلمتا المرور غير متطابقتين.");
    busy(f, true); var r = await sb.auth.updateUser({ password: a }); busy(f, false);
    if (r.error) return err(AUTH_ERR(r.error)); toast("تم تغيير كلمة المرور"); afterLogin(r.data.user);
  };
  C.changePw = async function () { if (dirty) { try { await flush(); } catch (e) {} } GATE = { v: "reset", back: 1 }; drawGate(); };
  C.recheck = async function () { var s = await sb.auth.getSession(); if (s.data && s.data.session) afterLogin(s.data.session.user); else C.go("login"); };
  C.logout = async function () {
    if (USER && dirty && !OFFLINE_MODE) { if (navigator.onLine) await window.save(); if (dirty && !confirm("توجد تعديلات لم تُرفع للسحابة بعد. ستبقى محفوظة على هذا الجهاز. هل تريد تسجيل الخروج؟")) return; }
    var id = USER && USER.id;
    if (id && !dirty) await IDB.del("u:" + id);
    OFFLINE_MODE = false; USER = null; PROF = null; S = { meta: {}, ev: {} }; dirty = false;
    try { await sb.auth.signOut(); } catch (e) {}
    GATE = { v: "login" }; drawGate();
  };

  /* ---------- شريط المستخدم ---------- */
  function userBar() {
    if (!USER || GATE) return; var b = qs("#cbar");
    if (!b) { b = document.createElement("div"); b.id = "cbar"; document.body.appendChild(b); }
    var admin = PROF && PROF.role === "super_admin";
    b.innerHTML = '<span class="who">👤 ' + E((PROF && PROF.full_name) || USER.email || "") + '</span><span id="cbst" class="cbst"></span>' + (admin ? '<a href="admin.html" class="adm-l">🛡️ لوحة مدير النظام</a>' : "") + '<button onclick="CLOUD.changePw()" title="تغيير كلمة المرور">🔑</button><button onclick="CLOUD.logout()">خروج</button>';
    setSt(state);
  }

  function injectCss() {
    var css = ".ag{min-height:100vh;display:flex;align-items:flex-start;justify-content:center;padding:24px 12px;background:linear-gradient(160deg,#eef5f6,#fff)}.ag-card{width:100%;max-width:560px;background:#fff;border:1px solid var(--cbd,#d6e0e4);border-radius:18px;box-shadow:0 10px 40px rgba(15,61,74,.12);padding:18px 18px 22px}"
      + ".ag-hd{display:flex;gap:12px;align-items:center;background:linear-gradient(to right,var(--g1,#2a7fc1),var(--g2,#3fb57d));color:#fff;border-radius:14px;padding:12px 14px;margin-bottom:12px}.ag-hd img{height:44px;width:auto}.ag-hd b{display:block;font-size:1.1em}.ag-hd span{opacity:.92;font-size:.95em}.ag-sub{color:#5b7270;font-size:.92em;margin:4px 2px 10px}"
      + ".ag form label{display:block;margin:8px 0;font-size:.92em;color:#294a52}.ag form input,.ag form select{width:100%;min-height:46px;font-size:16px;padding:8px 10px;border:1px solid #c5d3d7;border-radius:10px;margin-top:4px;box-sizing:border-box;background:#fff}.ag-g2{display:grid;grid-template-columns:1fr 1fr;gap:0 10px}.ag-g2 .w{grid-column:1/-1}"
      + ".ag-main{width:100%;min-height:48px;margin-top:10px;font-size:1.05em}.ag-links{display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-top:14px;font-size:.95em}.ag-links a{color:var(--pr,#16967c);text-decoration:none;font-weight:600}"
      + ".ag-err{display:none;background:#fdecea;color:#9b2c22;border:1px solid #f3c2bc;border-radius:10px;padding:8px 10px;margin:8px 0;font-size:.92em}.ag-ann{background:#eef7f5;border:1px solid #bfe3d8;border-radius:10px;padding:8px 10px;margin-bottom:8px}"
      + ".ag-type{display:flex;gap:8px;align-items:center;margin:10px 0}.ag-type>span{font-size:.92em;color:#294a52;flex:none}.ag-type .opt{flex:1;margin:0}"
      + ".ag-st{text-align:center;padding:16px 10px;border-radius:14px;background:#f5f9fa;border:1px solid #dbe6e9;margin:8px 0}.ag-st .ic{font-size:2.2em}.ag-st b{display:block;font-size:1.1em;margin:6px 0;color:#0f3d4a}.ag-st.rejected{background:#fdf1ef;border-color:#f1c9c3}.ag-st.suspended{background:#fff8ec;border-color:#f0d9a8}.ag-st .rs{color:#9b2c22;font-weight:600}.ag-c{justify-content:center}.ag-load{text-align:center;padding:30px;color:#5b7270}"
      + "#cbar{position:fixed;bottom:10px;left:10px;z-index:60;display:flex;gap:8px;align-items:center;flex-wrap:wrap;max-width:calc(100vw - 20px);background:#fff;border:1px solid var(--cbd,#d6e0e4);border-radius:999px;padding:5px 6px 5px 12px;box-shadow:0 4px 18px rgba(0,0,0,.12);font-size:13px}#cbar .who{font-weight:700;color:#0f3d4a;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#cbar button,#cbar a{margin:0;min-height:34px;padding:4px 12px;border-radius:999px;font-size:13px}#cbar .adm-l{background:#0f3d4a;color:#fff;text-decoration:none;display:inline-flex;align-items:center}"
      + ".cbst{font-size:12px;color:#1b8a4b}.cbst.offline,.cbst.conflict{color:#a86400}.cbst.error{color:#b3392f}.cbst.saving,.cbst.dirty{color:#5b7270}.sv.offline,.sv.conflict{color:#a86400}.sv.error{color:#b3392f}"
      + "body.printing #cbar{display:none}@media print{#cbar{display:none!important}}@media (max-width:600px){.ag-g2{grid-template-columns:1fr}#cbar{left:6px;right:6px;bottom:6px;border-radius:14px;justify-content:space-between}#cbar .who{max-width:120px}}";
    var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
  }
})();
