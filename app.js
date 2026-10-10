/* HazelQuiz — mobile-first study SPA */
(function () {
  "use strict";

  var META = window.HAZEL_META || {
    appName: "HazelQuiz",
    storageKey: "hazelquiz-v1",
    srsIntervals: [1, 3, 7, 14, 30],
  };
  var GATES = window.HAZEL_GATES || [];
  var LECTURES = window.HAZEL_LECTURES || [];
  var GLOSSARY = window.HAZEL_GLOSSARY || {};
  var STORAGE_KEY = META.storageKey || "hazelquiz-v1";
  var ZH_PREF_KEY = "hazelquiz-show-zh";
  var GLOSS_CACHE_KEY = "hazelquiz-gloss-cache-v1";
  var SRS = META.srsIntervals || [1, 3, 7, 14, 30]; // legacy day ladder (unused by flashcard ratings)
  /* Flashcard SRS ratings (Open Readle–style) */
  var RATING_META = {
    new:   { id: "new",   label: "新增的單字", short: "新增",   intervalMs: 0,                 intervalLabel: "即學",   color: "teal" },
    again: { id: "again", label: "再複習一次", short: "再複習", intervalMs: 1 * 60 * 1000,     intervalLabel: "1分鐘", color: "purple" },
    hard:  { id: "hard",  label: "困難",       short: "困難",   intervalMs: 10 * 60 * 1000,    intervalLabel: "10分鐘", color: "red" },
    ok:    { id: "ok",    label: "還可以",     short: "還可以", intervalMs: 2 * 24 * 60 * 60 * 1000, intervalLabel: "2天", color: "blue" },
    easy:  { id: "easy",  label: "簡單",       short: "簡單",   intervalMs: 4 * 24 * 60 * 60 * 1000, intervalLabel: "4天", color: "green" },
  };
  var RATING_ORDER = ["new", "again", "hard", "ok", "easy"];
  var glossCache = null;
  var enrichInflight = {};

  function loadGlossCache() {
    if (glossCache) return glossCache;
    try {
      glossCache = JSON.parse(localStorage.getItem(GLOSS_CACHE_KEY) || "{}") || {};
    } catch (e) {
      glossCache = {};
    }
    return glossCache;
  }

  function saveGlossCache() {
    try {
      localStorage.setItem(GLOSS_CACHE_KEY, JSON.stringify(loadGlossCache()));
    } catch (e) {}
  }

  var main = document.getElementById("main");
  var backdrop = document.getElementById("backdrop");
  var sheet = document.getElementById("sheet");
  var dueBadge = document.getElementById("due-badge");
  var todayLabel = document.getElementById("today-label");
  var sheetTerm = null;

  function todayISO() {
    var d = new Date();
    return (
      d.getFullYear() +
      "-" +
      String(d.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(d.getDate()).padStart(2, "0")
    );
  }

  function addDays(iso, n) {
    var d = new Date(iso + "T12:00:00");
    d.setDate(d.getDate() + n);
    return (
      d.getFullYear() +
      "-" +
      String(d.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(d.getDate()).padStart(2, "0")
    );
  }

  function emptyState() {
    return { cleared: {}, bank: {}, progress: {}, readPos: {}, updatedAt: 0 };
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return emptyState();
      var data = JSON.parse(raw);
      return {
        cleared: data.cleared || {},
        bank: data.bank || {},
        progress: data.progress || {},
        readPos: data.readPos || {},
        updatedAt: data.updatedAt || 0,
      };
    } catch (e) {
      return emptyState();
    }
  }

  function persistLocal(state) {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        cleared: state.cleared,
        bank: state.bank,
        progress: state.progress,
        readPos: state.readPos || {},
        updatedAt: state.updatedAt || Date.now(),
        v: 1,
      })
    );
  }

  function saveState(state) {
    state.updatedAt = Date.now();
    try {
      persistLocal(state);
    } catch (e) {
      alert("無法寫入本機資料。");
    }
    scheduleCloudPush();
    updateSyncStatus();
  }

  var state = loadState();

  /* ---- Cloud sync: shared bank on Will's Drive (Apps Script) ---- */
  var SYNC_CFG_KEY = "hazelquiz-sync-cfg";
  var DEFAULT_SYNC_URL = (window.HAZEL_SYNC_URL || "").trim();
  var DEFAULT_BANK = (window.HAZEL_SYNC_BANK || "hazel").trim() || "hazel";
  var cloudReady = false;
  var cloudPending = false;
  var cloudTimer = null;
  var syncGen = 0;
  var syncStatus = "local"; // local | ready | syncing | synced | error | setup
  var syncError = "";

  function loadSyncCfg() {
    try {
      var raw = localStorage.getItem(SYNC_CFG_KEY);
      var cfg = raw ? JSON.parse(raw) : {};
      return {
        url: String(cfg.url || DEFAULT_SYNC_URL || "").trim(),
        bank: String(cfg.bank || DEFAULT_BANK || "hazel").trim() || "hazel",
      };
    } catch (e) {
      return { url: DEFAULT_SYNC_URL || "", bank: DEFAULT_BANK };
    }
  }

  function saveSyncCfg(cfg) {
    localStorage.setItem(
      SYNC_CFG_KEY,
      JSON.stringify({
        url: String(cfg.url || "").trim(),
        bank: String(cfg.bank || DEFAULT_BANK || "hazel").trim() || "hazel",
      })
    );
  }

  function syncConfigured() {
    var c = loadSyncCfg();
    return !!(c.url && /^https?:\/\//i.test(c.url));
  }

  function updateSyncStatus() {
    var el = document.getElementById("sync-status");
    if (!el) return;
    var label = "僅本機";
    var cls = "sync-pill local";
    if (!syncConfigured()) {
      label = "未開雲端";
      cls = "sync-pill setup";
      syncStatus = "setup";
    } else if (syncStatus === "syncing") {
      label = "同步中…";
      cls = "sync-pill syncing";
    } else if (syncStatus === "synced") {
      label = "已同步";
      cls = "sync-pill synced";
    } else if (syncStatus === "error") {
      label = "同步失敗";
      cls = "sync-pill error";
    } else if (syncStatus === "ready") {
      label = "雲端就緒";
      cls = "sync-pill ready";
    }
    el.className = cls;
    el.textContent = label;
    el.href = "#/sync";
    el.title = syncError || "雲端同步（共用生字庫）";
  }

  function touchBankItem(item) {
    if (!item) return item;
    item.updatedAt = Date.now();
    return item;
  }

  function pickNewerItem(a, b) {
    var ta = a && a.updatedAt ? a.updatedAt : a && a.added ? Date.parse(a.added) || 0 : 0;
    var tb = b && b.updatedAt ? b.updatedAt : b && b.added ? Date.parse(b.added) || 0 : 0;
    if (tb > ta) return b;
    if (ta > tb) return a;
    // Prefer richer gloss / higher SRS stage on ties
    if ((b.stage || 0) !== (a.stage || 0)) return (b.stage || 0) > (a.stage || 0) ? b : a;
    return a;
  }

  function mergeMaps(localMap, remoteMap, pick) {
    var out = Object.assign({}, localMap || {});
    var remote = remoteMap && typeof remoteMap === "object" ? remoteMap : {};
    Object.keys(remote).forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(out, key)) out[key] = remote[key];
      else out[key] = pick(out[key], remote[key]);
    });
    return out;
  }

  function mergeCleared(a, b) {
    var out = Object.assign({}, a || {});
    Object.keys(b || {}).forEach(function (k) {
      if (b[k]) out[k] = true;
    });
    return out;
  }

  function mergeReadPos(a, b) {
    var out = Object.assign({}, a || {});
    Object.keys(b || {}).forEach(function (k) {
      var lv = Number((out[k] && out[k].y) || out[k] || 0);
      var rv = Number((b[k] && b[k].y) || b[k] || 0);
      if (rv > lv) out[k] = b[k];
      else if (!out[k]) out[k] = b[k];
    });
    return out;
  }

  function mergeState(local, remote) {
    var ls = local && typeof local === "object" ? local : emptyState();
    var rs = remote && typeof remote === "object" ? remote : emptyState();
    var remoteVocab = rs.vocab;
    if (!remoteVocab || typeof remoteVocab !== "object") {
      remoteVocab = rs.bank && typeof rs.bank === "object" ? rs.bank : {};
    }
    return {
      cleared: mergeCleared(ls.cleared, rs.cleared),
      bank: mergeMaps(ls.bank, remoteVocab, pickNewerItem),
      progress: mergeMaps(ls.progress, rs.progress, pickNewerItem),
      readPos: mergeReadPos(ls.readPos, rs.readPos),
      updatedAt: Math.max(ls.updatedAt || 0, rs.updatedAt || 0, Date.now()),
    };
  }

  function cloudFetch(action, data) {
    var cfg = loadSyncCfg();
    if (!cfg.url) {
      return Promise.reject(new Error("not_configured"));
    }
    var payload = {
      action: action,
      bankId: cfg.bank || DEFAULT_BANK,
      bank: cfg.bank || DEFAULT_BANK,
    };
    if (data) payload.data = data;
    // Apps Script returns 302 → googleusercontent; follow with redirect:"follow".
    // Some browsers strip POST body; fallback: POST with redirect:manual then GET Location.
    return fetch(cfg.url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
      redirect: "follow",
    })
      .then(function (res) {
        return res.text().then(function (text) {
          return { res: res, text: text };
        });
      })
      .then(function (pack) {
        var text = pack.text || "";
        if (text && text.charAt(0) === "{") {
          return parseCloudJson_(text);
        }
        // Fallback: manual redirect dance
        return fetch(cfg.url, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify(payload),
          redirect: "manual",
        }).then(function (res2) {
          var loc = res2.headers.get("Location");
          if (!loc) throw new Error("bad_response");
          return fetch(loc, { method: "GET", redirect: "follow" }).then(function (r3) {
            return r3.text();
          });
        }).then(parseCloudJson_);
      });
  }

  function parseCloudJson_(text) {
    var json = null;
    try {
      json = JSON.parse(text);
    } catch (e) {
      throw new Error("bad_response");
    }
    if (!json || !json.ok) {
      throw new Error((json && json.error) || "cloud_error");
    }
    return json;
  }

  function statePayload() {
    return {
      cleared: state.cleared,
      vocab: state.bank,
      bank: state.bank,
      progress: state.progress,
      readPos: state.readPos || {},
      updatedAt: state.updatedAt || Date.now(),
      v: 1,
    };
  }

  function pushCloud() {
    if (!syncConfigured()) return;
    var gen = syncGen;
    var snap = JSON.stringify(statePayload());
    syncStatus = "syncing";
    updateSyncStatus();
    cloudFetch("push", statePayload())
      .then(function () {
        if (gen !== syncGen) return;
        if (JSON.stringify(statePayload()) !== snap) {
          pushCloud();
          return;
        }
        syncStatus = "synced";
        syncError = "";
        updateSyncStatus();
      })
      .catch(function (err) {
        if (gen !== syncGen) return;
        syncStatus = "error";
        syncError = String(err && err.message ? err.message : err);
        updateSyncStatus();
      });
  }

  function scheduleCloudPush() {
    if (!syncConfigured()) return;
    if (!cloudReady) {
      cloudPending = true;
      return;
    }
    clearTimeout(cloudTimer);
    syncStatus = "syncing";
    updateSyncStatus();
    cloudTimer = setTimeout(pushCloud, 500);
  }

  function pullCloud() {
    if (!syncConfigured()) {
      cloudReady = true;
      syncStatus = "setup";
      updateSyncStatus();
      return;
    }
    var gen = syncGen;
    syncStatus = "syncing";
    updateSyncStatus();
    cloudFetch("pull")
      .then(function (json) {
        if (gen !== syncGen) {
          cloudReady = true;
          if (cloudPending) {
            cloudPending = false;
            pushCloud();
          }
          return;
        }
        cloudReady = true;
        var remote = json.data;
        if (remote && typeof remote === "object") {
          var merged = mergeState(state, remote);
          var before = JSON.stringify(statePayload());
          state.cleared = merged.cleared;
          state.bank = merged.bank;
          state.progress = merged.progress;
          state.readPos = merged.readPos;
          state.updatedAt = merged.updatedAt;
          var after = JSON.stringify(statePayload());
          if (after !== before) {
            persistLocal(state);
            updateBadge();
            // Re-render current route if quiet
            try {
              route();
            } catch (e) {}
          }
          if (after !== JSON.stringify({
            cleared: remote.cleared || {},
            bank: remote.bank || {},
            progress: remote.progress || {},
            readPos: remote.readPos || {},
            updatedAt: remote.updatedAt || 0,
            v: 1,
          })) {
            pushCloud();
          } else {
            syncStatus = "synced";
            syncError = "";
            updateSyncStatus();
          }
        } else if (
          Object.keys(state.bank).length ||
          Object.keys(state.cleared).length ||
          cloudPending
        ) {
          pushCloud();
        } else {
          syncStatus = "synced";
          syncError = "";
          updateSyncStatus();
        }
        cloudPending = false;
      })
      .catch(function (err) {
        cloudReady = true;
        syncStatus = "error";
        syncError = String(err && err.message ? err.message : err);
        updateSyncStatus();
        if (cloudPending) {
          cloudPending = false;
          pushCloud();
        }
      });
  }

  function exportStateFile() {
    var blob = new Blob([JSON.stringify(statePayload(), null, 2)], {
      type: "application/json",
    });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "hazelquiz-backup-" + todayISO() + ".json";
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
    }, 1000);
  }

  function importStateFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(String(reader.result || ""));
        if (!data || typeof data !== "object") throw new Error("bad");
        var merged = mergeState(state, data);
        state.cleared = merged.cleared;
        state.bank = merged.bank;
        state.progress = merged.progress;
        state.readPos = merged.readPos;
        state.updatedAt = Date.now();
        persistLocal(state);
        scheduleCloudPush();
        updateBadge();
        alert("已匯入並合併生字／進度。");
        location.hash = "#/bank";
        route();
      } catch (e) {
        alert("匯入失敗：檔案格式不正確。");
      }
    };
    reader.readAsText(file);
  }

  function loadShowZh() {
    try {
      var v = localStorage.getItem(ZH_PREF_KEY);
      if (v === null || v === undefined || v === "") return true; // default: Chinese ON
      return v === "1" || v === "true";
    } catch (e) {
      return true;
    }
  }

  function saveShowZh(on) {
    try {
      localStorage.setItem(ZH_PREF_KEY, on ? "1" : "0");
    } catch (e) {}
  }

  var showZh = loadShowZh();


  function gateIndex(id) {
    for (var i = 0; i < GATES.length; i++) {
      if (GATES[i].id === id) return i;
    }
    return -1;
  }

  function isUnlocked(id) {
    var i = gateIndex(id);
    if (i <= 0) return true;
    var prev = GATES[i - 1];
    return !!(prev && state.cleared[prev.id]);
  }

  function isCleared(id) {
    return !!state.cleared[id];
  }


  function isLiveBankItem(item) {
    return !!(item && !item.deleted && item.term);
  }

  function liveBankKeys() {
    return Object.keys(state.bank).filter(function (k) {
      return isLiveBankItem(state.bank[k]);
    });
  }

  function itemDueAt(item) {
    if (!item) return 0;
    if (typeof item.dueAt === "number" && !isNaN(item.dueAt)) return item.dueAt;
    if (item.due) {
      var raw = String(item.due);
      var p = Date.parse(raw.length === 10 ? raw + "T00:00:00" : raw);
      return isNaN(p) ? 0 : p;
    }
    return 0;
  }

  function isDueItem(item) {
    return isLiveBankItem(item) && itemDueAt(item) > 0 && itemDueAt(item) <= Date.now();
  }

  function itemRating(item) {
    if (!isLiveBankItem(item)) return "new";
    if (item.rating && RATING_META[item.rating]) return item.rating;
    // Legacy: never graded → new; else map stage roughly
    if (!item.reviewed && (item.stage === 0 || item.stage == null) && !item.lastRating) return "new";
    if (item.lastRating && RATING_META[item.lastRating]) return item.lastRating;
    var s = item.stage || 0;
    if (s <= 0) return "again";
    if (s === 1) return "hard";
    if (s === 2) return "ok";
    return "easy";
  }

  function ratingLabel(id) {
    return (RATING_META[id] && RATING_META[id].short) || id;
  }

  function bucketCounts() {
    var counts = { new: 0, again: 0, hard: 0, ok: 0, easy: 0 };
    liveBankKeys().forEach(function (k) {
      var r = itemRating(state.bank[k]);
      if (counts[r] == null) counts[r] = 0;
      counts[r] += 1;
    });
    return counts;
  }

  function dueCount() {
    var n = 0;
    Object.keys(state.bank).forEach(function (k) {
      if (isDueItem(state.bank[k])) n += 1;
    });
    return n;
  }

  function newWordCount() {
    var n = 0;
    liveBankKeys().forEach(function (k) {
      if (itemRating(state.bank[k]) === "new") n += 1;
    });
    return n;
  }

  function reviewQueue(filterRating) {
    var due = [];
    var news = [];
    liveBankKeys().forEach(function (k) {
      var item = state.bank[k];
      var r = itemRating(item);
      if (filterRating && r !== filterRating) return;
      if (r === "new") news.push(item);
      else if (isDueItem(item)) due.push(item);
    });
    due.sort(function (a, b) {
      return itemDueAt(a) - itemDueAt(b);
    });
    // New first, then due (Open Readle–style daily practice)
    return news.concat(due);
  }

  function updateBadge() {
    var n = dueCount();
    if (n > 0) {
      dueBadge.hidden = false;
      dueBadge.textContent = String(n);
    } else {
      dueBadge.hidden = true;
    }
  }

  function setNav(active) {
    document.querySelectorAll(".nav a").forEach(function (a) {
      a.classList.toggle("on", a.getAttribute("data-nav") === active);
    });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }


  var speakVoice = null;
  var speakUnlocked = false;
  var speakTimer = null;

  function englishVoice() {
    if (!window.speechSynthesis || !window.speechSynthesis.getVoices) return null;
    var voices = window.speechSynthesis.getVoices() || [];
    var best = null;
    var score = -1;
    voices.forEach(function (v) {
      var lang = String(v.lang || "").replace(/_/g, "-").toLowerCase();
      var name = String(v.name || "").toLowerCase();
      var s = 0;
      if (lang.indexOf("en") === 0 || name.indexOf("english") !== -1) s += 2;
      if (lang === "en-us" || lang === "en_us") s += 6;
      if (lang === "en-gb") s += 3;
      if (name.indexOf("english") !== -1) s += 1;
      if (name.indexOf("samantha") !== -1 || name.indexOf("google us") !== -1) s += 2;
      if (s > score) {
        score = s;
        best = v;
      }
    });
    return score > 0 ? best : null;
  }

  function refreshVoice() {
    speakVoice = englishVoice();
  }

  if (window.speechSynthesis) {
    refreshVoice();
    if (window.speechSynthesis.addEventListener) {
      window.speechSynthesis.addEventListener("voiceschanged", refreshVoice);
    } else {
      window.speechSynthesis.onvoiceschanged = refreshVoice;
    }
  }

  /** Unlock TTS inside a user gesture (needed on iOS / some Android WebViews). */
  function unlockSpeak() {
    if (speakUnlocked || !window.speechSynthesis) return;
    speakUnlocked = true;
    try {
      var warm = new SpeechSynthesisUtterance("");
      warm.volume = 0;
      warm.rate = 1;
      warm.lang = "en-US";
      window.speechSynthesis.speak(warm);
      window.speechSynthesis.cancel();
    } catch (e) {}
  }

  function speak(text, rate) {
    var t = String(text || "").trim();
    if (!t) return;
    var r = typeof rate === "number" ? rate : 0.9;
    if (!window.speechSynthesis || typeof window.SpeechSynthesisUtterance === "undefined") {
      alert("此瀏覽器不支援英文語音（speechSynthesis）。");
      return;
    }
    unlockSpeak();
    refreshVoice();
    if (speakTimer) {
      clearTimeout(speakTimer);
      speakTimer = null;
    }
    try {
      window.speechSynthesis.cancel();
    } catch (e) {}

    function fire() {
      refreshVoice();
      var u = new SpeechSynthesisUtterance(t);
      u.lang = "en-US";
      u.rate = r;
      u.pitch = 1;
      u.volume = 1;
      var v = speakVoice || englishVoice();
      if (v) {
        u.voice = v;
        if (v.lang) u.lang = v.lang;
      }
      try {
        window.speechSynthesis.speak(u);
      } catch (err) {
        alert("無法播放發音，請稍後再試。");
      }
    }

    // cancel()+speak() race on Chrome/Android: brief defer helps
    speakTimer = setTimeout(fire, 40);
  }

  /** Filled speaker icon — stroke-only SVG showed as empty tofu on some Android phones. */
  function speakIconSvg() {
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">' +
      '<path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>' +
      "</svg>"
    );
  }

  function phonHint(vocab) {
    if (!vocab) return "";
    if (vocab.say) return vocab.say;
    // Recover say from course data for older bank entries that only stored IPA
    var t = String(vocab.term || "").toLowerCase();
    if (t) {
      var g, i, list;
      for (g = 0; g < GATES.length; g++) {
        list = GATES[g].vocab || [];
        for (i = 0; i < list.length; i++) {
          if (list[i].term.toLowerCase() === t && list[i].say) return list[i].say;
        }
      }
    }
    // Never show raw IPA on mobile — missing glyphs become □
    return "";
  }


  /** Longest-first vocab phrases + every remaining English word → tappable. */
  function vocabTermList(preferGate) {
    var seen = {};
    var out = [];
    function addTerm(term) {
      if (!term) return;
      var k = String(term).toLowerCase();
      if (seen[k]) return;
      seen[k] = true;
      out.push(String(term));
    }
    function add(list) {
      (list || []).forEach(function (v) {
        if (!v || !v.term) return;
        addTerm(v.term);
      });
    }
    if (preferGate) add(preferGate.vocab);
    GATES.forEach(function (g) {
      add(g.vocab);
    });
    Object.keys(GLOSSARY).forEach(function (k) {
      var g = GLOSSARY[k];
      addTerm((g && g.term) || k);
    });
    out.sort(function (a, b) {
      return b.length - a.length;
    });
    return out;
  }

  function isEnWordChar(c) {
    return /[A-Za-z0-9']/.test(c);
  }

  function linkAllEnglish(text, gate, gateId) {
    var s = String(text || "");
    if (!s) return "";
    var terms = vocabTermList(gate);
    var gid = gateId || "";
    var known = {};
    terms.forEach(function (t) {
      known[t.toLowerCase()] = true;
    });
    var out = "";
    var i = 0;
    while (i < s.length) {
      var ch = s.charAt(i);
      if (!/[A-Za-z]/.test(ch)) {
        out += escapeHtml(ch);
        i += 1;
        continue;
      }
      var matched = null;
      var matchLen = 0;
      var ti;
      for (ti = 0; ti < terms.length; ti++) {
        var term = terms[ti];
        var len = term.length;
        if (i + len > s.length) continue;
        var slice = s.substr(i, len);
        if (slice.toLowerCase() !== term.toLowerCase()) continue;
        var after = i + len < s.length ? s.charAt(i + len) : "";
        if (after && isEnWordChar(after)) continue;
        matched = slice;
        matchLen = len;
        break;
      }
      if (matched) {
        out +=
          '<button type="button" class="term known" data-gate="' +
          escapeHtml(gid) +
          '" data-term="' +
          escapeHtml(matched) +
          '">' +
          escapeHtml(matched) +
          "</button>";
        i += matchLen;
        continue;
      }
      var j = i + 1;
      while (j < s.length && /[A-Za-z0-9'-]/.test(s.charAt(j))) j += 1;
      var word = s.slice(i, j);
      var cls = known[word.toLowerCase()] ? "term known" : "term word";
      out +=
        '<button type="button" class="' +
        cls +
        '" data-gate="' +
        escapeHtml(gid) +
        '" data-term="' +
        escapeHtml(word) +
        '">' +
        escapeHtml(word) +
        "</button>";
      i = j;
    }
    return out;
  }

  function stemAlts(t) {
    var alts = [];
    if (t.length > 4 && t.slice(-1) === "s") alts.push(t.slice(0, -1));
    if (t.length > 5 && t.slice(-2) === "es") alts.push(t.slice(0, -2));
    if (t.length > 5 && t.slice(-3) === "ies") alts.push(t.slice(0, -3) + "y");
    if (t.length > 5 && t.slice(-3) === "ing") {
      alts.push(t.slice(0, -3));
      alts.push(t.slice(0, -3) + "e");
    }
    if (t.length > 4 && t.slice(-2) === "ed") {
      alts.push(t.slice(0, -2));
      alts.push(t.slice(0, -1));
    }
    if (t.length > 4 && t.slice(-2) === "ly") alts.push(t.slice(0, -2));
    if (t.length > 5 && t.slice(-4) === "tion") alts.push(t.slice(0, -4) + "te");
    if (t.length > 5 && t.slice(-4) === "sion") alts.push(t.slice(0, -4) + "de");
    return alts;
  }

  function packHit(term, hit) {
    return {
      term: (hit && hit.term) || String(term || "").trim() || term,
      zh: (hit && hit.zh) || "",
      ipa: (hit && hit.ipa) || "",
      say: (hit && hit.say) || "",
      gloss: (hit && (hit.gloss || hit.zh)) || "",
      _needsEnrich: false,
    };
  }

  function findVocab(term, gate) {
    var t = String(term || "").toLowerCase();
    var i, g, list, hit;
    if (gate && gate.vocab) {
      for (i = 0; i < gate.vocab.length; i++) {
        if (gate.vocab[i].term.toLowerCase() === t) return packHit(term, gate.vocab[i]);
      }
    }
    for (g = 0; g < GATES.length; g++) {
      list = GATES[g].vocab || [];
      for (i = 0; i < list.length; i++) {
        if (list[i].term.toLowerCase() === t) return packHit(term, list[i]);
      }
    }
    hit = GLOSSARY[t];
    if (hit) return packHit(term, hit);

    var alts = stemAlts(t);
    for (i = 0; i < alts.length; i++) {
      hit = GLOSSARY[alts[i]];
      if (hit) return packHit(term, hit);
    }

    // Runtime cache from previous lookups
    var cached = loadGlossCache()[t];
    if (cached && (cached.zh || cached.gloss)) {
      return {
        term: cached.term || String(term || "").trim() || term,
        zh: cached.zh || "",
        ipa: cached.ipa || "",
        say: cached.say || "",
        gloss: cached.gloss || cached.zh || "",
        _needsEnrich: false,
      };
    }

    var display = String(term || "").trim() || term;
    return {
      term: display,
      zh: "",
      ipa: "",
      say: "",
      gloss: "查緊解釋…",
      _needsEnrich: true,
    };
  }

  function applySheetVocab(vocab) {
    if (!sheetTerm || !vocab) return;
    if (
      String(sheetTerm.vocab.term || "").toLowerCase() !==
      String(vocab.term || "").toLowerCase()
    ) {
      return;
    }
    sheetTerm.vocab = vocab;
    document.getElementById("sheet-term").textContent = vocab.term;
    document.getElementById("sheet-zh").textContent = vocab.zh || "";
    var ipa = document.getElementById("sheet-ipa");
    var hint = phonHint(vocab);
    if (hint) {
      ipa.hidden = false;
      ipa.textContent = hint;
    } else {
      ipa.hidden = true;
      ipa.textContent = "";
    }
    document.getElementById("sheet-gloss").textContent = vocab.gloss || vocab.zh || "";
  }

  function enrichVocab(term, gateId) {
    var key = String(term || "").toLowerCase().trim();
    if (!key || enrichInflight[key]) return;
    enrichInflight[key] = true;
    var display = String(term || "").trim() || term;

    function finish(zh, gloss, say) {
      var packed = {
        term: display,
        zh: zh || "",
        ipa: "",
        say: say || "",
        gloss: gloss || zh || "可聽發音並加進生字卡複習。",
        _needsEnrich: false,
      };
      if (packed.zh || (packed.gloss && packed.gloss.indexOf("查緊") !== 0)) {
        loadGlossCache()[key] = {
          term: packed.term,
          zh: packed.zh,
          gloss: packed.gloss,
          say: packed.say,
        };
        saveGlossCache();
        // also seed in-memory glossary for this session
        if (!GLOSSARY[key]) {
          GLOSSARY[key] = {
            term: packed.term,
            zh: packed.zh,
            gloss: packed.gloss,
            say: packed.say,
            ipa: "",
          };
        }
      }
      applySheetVocab(packed);
      delete enrichInflight[key];
    }

    function failSoft() {
      finish(
        display,
        "「" + display + "」——課文英文詞。點喇叭聽發音；可加進生字卡。",
        ""
      );
    }

    var q = encodeURIComponent(display);
    var zhP = fetch(
      "https://api.mymemory.translated.net/get?q=" + q + "&langpair=en|zh-TW"
    )
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        var zh = ((data && data.responseData) || {}).translatedText || "";
        if (!zh || /MYMEMORY WARNING/i.test(zh) || zh.trim().toLowerCase() === display.toLowerCase()) {
          return "";
        }
        return zh.trim();
      })
      .catch(function () {
        return "";
      });

    var defP = fetch(
      "https://api.datamuse.com/words?sp=" + encodeURIComponent(key) + "&md=d&max=1"
    )
      .then(function (r) {
        return r.json();
      })
      .then(function (arr) {
        if (!arr || !arr[0] || !arr[0].defs || !arr[0].defs.length) return "";
        var raw = String(arr[0].defs[0] || "");
        // strip leading part-of-speech tag like "n\t"
        return raw.replace(/^[a-z]+\t/, "").replace(/^[a-z]\t/, "").trim();
      })
      .catch(function () {
        return "";
      });

    Promise.all([zhP, defP]).then(function (pair) {
      var zh = pair[0] || "";
      var enDef = pair[1] || "";
      if (!zh && !enDef) {
        failSoft();
        return;
      }
      if (enDef && zh) {
        // translate definition for gloss
        fetch(
          "https://api.mymemory.translated.net/get?q=" +
            encodeURIComponent(enDef.slice(0, 280)) +
            "&langpair=en|zh-TW"
        )
          .then(function (r) {
            return r.json();
          })
          .then(function (data) {
            var g =
              ((data && data.responseData) || {}).translatedText || "";
            if (!g || /MYMEMORY WARNING/i.test(g)) g = zh + "。" + enDef;
            finish(zh, g, "");
          })
          .catch(function () {
            finish(zh, zh + "。" + enDef, "");
          });
        return;
      }
      if (zh) {
        finish(zh, "「" + display + "」意思：" + zh + "。", "");
        return;
      }
      // only English def
      finish(display, enDef, "");
    });
  }

  function clearTermActive() {
    var nodes = main.querySelectorAll("button.term.active");
    for (var i = 0; i < nodes.length; i++) nodes[i].classList.remove("active");
  }

  function openSheet(vocab, gateId, termEl) {
    sheetTerm = { vocab: vocab, gateId: gateId || "" };
    if (termEl && termEl.classList) {
      clearTermActive();
      termEl.classList.add("active");
    }
    document.getElementById("sheet-term").textContent = vocab.term;
    document.getElementById("sheet-zh").textContent = vocab.zh || "";
    var ipa = document.getElementById("sheet-ipa");
    var hint = phonHint(vocab);
    if (hint) {
      ipa.hidden = false;
      ipa.textContent = hint;
    } else {
      ipa.hidden = true;
      ipa.textContent = "";
    }
    document.getElementById("sheet-gloss").textContent = vocab.gloss || "";
    var key = vocab.term.toLowerCase();
    var saved = isLiveBankItem(state.bank[key]);
    document.getElementById("sheet-save").hidden = saved;
    document.getElementById("sheet-remove").hidden = !saved;
    var note = document.getElementById("sheet-note");
    if (saved && state.bank[key].due) {
      note.hidden = false;
      note.textContent =
        "已儲存 · 下次複習 " +
        state.bank[key].due +
        (syncConfigured() ? " · 會同步到 Drive 共用庫" : " · 而家只存本機（可去同步開線上）");
    } else {
      note.hidden = true;
    }
    backdrop.hidden = false;
    sheet.hidden = false;
    sheet.focus();
    if (vocab && vocab._needsEnrich) {
      enrichVocab(vocab.term, gateId);
    }
  }

  function closeSheet() {
    backdrop.hidden = true;
    sheet.hidden = true;
    sheetTerm = null;
    clearTermActive();
  }

  function saveVocab() {
    if (!sheetTerm) return;
    var v = sheetTerm.vocab;
    var key = v.term.toLowerCase();
    state.bank[key] = touchBankItem({
      term: v.term,
      zh: v.zh || "",
      ipa: v.ipa || "",
      say: v.say || phonHint(v) || "",
      gloss: v.gloss || "",
      gateId: sheetTerm.gateId || "",
      stage: 0,
      rating: "new",
      reviewed: false,
      due: todayISO(),
      dueAt: Date.now(),
      added: todayISO(),
    });
    saveState(state);
    updateBadge();
    openSheet(v, sheetTerm.gateId);
  }

  function removeVocab() {
    if (!sheetTerm) return;
    var key = sheetTerm.vocab.term.toLowerCase();
    state.bank[key] = touchBankItem({
      term: sheetTerm.vocab.term,
      deleted: true,
    });
    saveState(state);
    updateBadge();
    openSheet(sheetTerm.vocab, sheetTerm.gateId);
  }

  document.getElementById("sheet-close").addEventListener("click", closeSheet);
  backdrop.addEventListener("click", closeSheet);
  document.getElementById("sheet-save").addEventListener("click", saveVocab);
  document.getElementById("sheet-remove").addEventListener("click", removeVocab);
  function sheetSpeak(rate) {
    if (!sheetTerm || !sheetTerm.vocab) return;
    speak(sheetTerm.vocab.term, rate);
  }

  /** One speak control; long-press (~0.55s) for slow rate. */
  function bindSpeakControl(el) {
    if (!el) return;
    var timer = null;
    var didLong = false;
    function clearTimer() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    }
    el.addEventListener("pointerdown", function () {
      didLong = false;
      clearTimer();
      timer = setTimeout(function () {
        didLong = true;
        timer = null;
        sheetSpeak(0.55);
      }, 550);
    });
    el.addEventListener("pointerup", function () {
      if (timer) {
        clearTimer();
        if (!didLong) sheetSpeak(0.9);
      }
    });
    el.addEventListener("pointercancel", clearTimer);
    el.addEventListener("pointerleave", clearTimer);
    el.addEventListener("contextmenu", function (e) {
      e.preventDefault();
    });
  }
  bindSpeakControl(document.getElementById("sheet-speak"));

  main.addEventListener("click", function (e) {
    var t = e.target.closest(".term");
    if (!t) return;
    e.preventDefault();
    var gateId = t.getAttribute("data-gate") || "";
    var gate = null;
    for (var i = 0; i < GATES.length; i++) {
      if (GATES[i].id === gateId) {
        gate = GATES[i];
        break;
      }
    }
    openSheet(findVocab(t.getAttribute("data-term"), gate), gateId, t);
  });

  function clearedCount() {
    return Object.keys(state.cleared).filter(function (k) {
      return state.cleared[k];
    }).length;
  }


  function lectureById(id) {
    for (var i = 0; i < LECTURES.length; i++) {
      if (LECTURES[i].id === id) return LECTURES[i];
    }
    return null;
  }

  function gatesForLecture(lectureId) {
    return GATES.filter(function (g) {
      return g.lecture === lectureId;
    });
  }

  function lectureProgress(lectureId) {
    var gs = gatesForLecture(lectureId);
    var done = 0;
    gs.forEach(function (g) {
      if (state.cleared[g.id]) done += 1;
    });
    return { done: done, total: gs.length };
  }

  function firstGateForLecture(lectureId) {
    var gs = gatesForLecture(lectureId);
    return gs.length ? gs[0] : null;
  }

  function nextOpenGate(lectureId) {
    var gs = gatesForLecture(lectureId);
    var i;
    for (i = 0; i < gs.length; i++) {
      if (!state.cleared[gs[i].id] && isUnlocked(gs[i].id)) return gs[i];
    }
    for (i = 0; i < gs.length; i++) {
      if (!state.cleared[gs[i].id]) return gs[i];
    }
    return gs.length ? gs[gs.length - 1] : null;
  }

  function renderLevels() {
    setNav("levels");
    var total = GATES.length;
    var done = clearedCount();
    var pct = total ? Math.round((done / total) * 100) : 0;
    var html =
      '<p class="kicker">Life Sciences</p>' +
      "<h2>關卡列表</h2>" +
      '<p class="lede">每課流程：<strong>讀全文</strong> → <strong>溫重點</strong> → <strong>測驗通關</strong>。點英文可存生字。</p>' +
      '<div class="card feature"><div class="cardtop"><span class="pill">總進度</span><strong>' +
      done +
      " / " +
      total +
      '</strong></div><div class="progress" aria-hidden="true"><span style="width:' +
      pct +
      '%"></span></div>' +
      '<p class="hint" style="margin:6px 0 0">建議先讀該課全文，再逐關溫重點同測驗。</p></div>';

    var lectureIds = [];
    GATES.forEach(function (g) {
      if (lectureIds.indexOf(g.lecture) === -1) lectureIds.push(g.lecture);
    });
    // Ensure L1/L2/L3 order even if lecture-only entries exist
    LECTURES.forEach(function (L) {
      if (lectureIds.indexOf(L.id) === -1) lectureIds.push(L.id);
    });

    lectureIds.forEach(function (lid) {
      var L = lectureById(lid);
      var titleZh = L ? L.titleZh : lid;
      var titleEn = L ? L.titleEn : "";
      var prog = lectureProgress(lid);
      var lpct = prog.total ? Math.round((prog.done / prog.total) * 100) : 0;
      var gs = gatesForLecture(lid);
      html +=
        '<section class="lecture-block card feature" id="lec-' +
        escapeHtml(lid) +
        '">' +
        '<div class="cardtop"><span class="pill lecture">' +
        escapeHtml(lid) +
        '</span><span class="pill">' +
        prog.done +
        "/" +
        prog.total +
        " 關</span></div>" +
        "<h3>" +
        escapeHtml(titleZh) +
        '</h3><p class="entitle">' +
        escapeHtml(titleEn) +
        '</p><div class="progress" aria-hidden="true"><span style="width:' +
        lpct +
        '%"></span></div>' +
        '<div class="flow-steps" aria-label="本課學習步驟">' +
        '<span class="flow-step">① 讀全文</span>' +
        '<span class="flow-arrow">→</span>' +
        '<span class="flow-step">② 溫重點</span>' +
        '<span class="flow-arrow">→</span>' +
        '<span class="flow-step">③ 測驗</span></div>' +
        '<div class="gate-actions">' +
        '<a class="primary" href="#/lecture/' +
        encodeURIComponent(lid) +
        '">讀全文</a>' +
        (function () {
          var _L = lectureById(lid);
          var _pg = _L ? savedPageFor(_L) : 0;
          return _pg
            ? '<a class="ghost" href="#/lecture/' +
              encodeURIComponent(lid) +
              '/resume">繼續上次（第 ' +
              _pg +
              ' 頁）</a>'
            : '';
        })();
      var next = nextOpenGate(lid);
      if (next) {
        html +=
          '<a class="ghost" href="#/gate/' +
          next.id +
          '">溫重點／測驗</a>';
      }
      html += "</div>";

      html += '<div class="gate-mini-list">';
      gs.forEach(function (g, i) {
        var unlocked = isUnlocked(g.id);
        var cleared = isCleared(g.id);
        var status = cleared ? "✓" : unlocked ? "·" : "🔒";
        var gi = gateIndex(g.id);
        html +=
          '<a class="gate-mini' +
          (cleared ? " done" : "") +
          (!unlocked ? " locked" : "") +
          '" href="#/gate/' +
          g.id +
          '"><span class="gm-n">關 ' +
          (gi + 1) +
          '</span><span class="gm-t">' +
          escapeHtml(g.titleZh) +
          '</span><span class="gm-s">' +
          status +
          '</span></a>';
      });
      html += "</div></section>";
    });

    main.innerHTML = html;
  }


  function lecturePageCount(L) {
    if (!L) return 1;
    if (L.pages && L.pages.length) return L.pages.length;
    if (L.pageCount) return L.pageCount;
    return 1;
  }

  /** readPos stores 1-based PDF page. Legacy scrollY values (> pageCount) reset to 1. */
  function savedPageFor(L) {
    var saved = (state.readPos && state.readPos[L.id]) || 0;
    var total = lecturePageCount(L);
    if (!saved || saved < 1) return 0;
    if (saved > total) return 0; // legacy scroll pixels
    return Math.floor(saved);
  }

  function persistReadPage(lectureId, page) {
    if (!state.readPos) state.readPos = {};
    state.readPos[lectureId] = page;
    saveState(state);
  }

  function ensureFigLightbox() {
    var box = document.getElementById("fig-lightbox");
    if (box) return box;
    box = document.createElement("div");
    box.id = "fig-lightbox";
    box.className = "fig-lightbox";
    box.hidden = true;
    box.innerHTML =
      '<button type="button" class="fig-lb-close" aria-label="關閉">×</button>' +
      '<div class="fig-lb-stage">' +
      '<img class="fig-lb-img" alt="" draggable="false" />' +
      "</div>" +
      '<p class="fig-lb-hint">雙指或滾輪縮放 · 拖移移動 · 點空白／Esc 關閉</p>';
    document.body.appendChild(box);

    var img = box.querySelector(".fig-lb-img");
    var stage = box.querySelector(".fig-lb-stage");
    var state = { scale: 1, x: 0, y: 0, px: 0, py: 0, dragging: false, pointers: new Map(), pinch: 0 };

    function apply() {
      img.style.transform =
        "translate(" + state.x + "px," + state.y + "px) scale(" + state.scale + ")";
    }
    function resetView() {
      state.scale = 1;
      state.x = 0;
      state.y = 0;
      apply();
    }
    function close() {
      box.hidden = true;
      box.classList.remove("open");
      document.body.classList.remove("lb-open");
      img.removeAttribute("src");
      resetView();
    }
    box._hqClose = close;
    box._hqReset = resetView;
    box._hqApply = apply;
    box._hqState = state;

    box.querySelector(".fig-lb-close").addEventListener("click", function (e) {
      e.stopPropagation();
      close();
    });
    box.addEventListener("click", function (e) {
      if (e.target === box || e.target === stage) close();
    });
    document.addEventListener("keydown", function (e) {
      if (!box.hidden && e.key === "Escape") close();
    });

    stage.addEventListener(
      "wheel",
      function (e) {
        if (box.hidden) return;
        e.preventDefault();
        var delta = e.deltaY > 0 ? -0.12 : 0.12;
        state.scale = Math.min(5, Math.max(1, state.scale + delta));
        if (state.scale === 1) {
          state.x = 0;
          state.y = 0;
        }
        apply();
      },
      { passive: false }
    );

    stage.addEventListener("pointerdown", function (e) {
      if (box.hidden) return;
      stage.setPointerCapture(e.pointerId);
      state.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (state.pointers.size === 1) {
        state.dragging = true;
        state.px = e.clientX - state.x;
        state.py = e.clientY - state.y;
      } else if (state.pointers.size === 2) {
        var pts = Array.from(state.pointers.values());
        var dx = pts[0].x - pts[1].x;
        var dy = pts[0].y - pts[1].y;
        state.pinch = Math.hypot(dx, dy) || 1;
      }
    });
    stage.addEventListener("pointermove", function (e) {
      if (!state.pointers.has(e.pointerId)) return;
      state.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (state.pointers.size === 2) {
        var pts = Array.from(state.pointers.values());
        var dx = pts[0].x - pts[1].x;
        var dy = pts[0].y - pts[1].y;
        var dist = Math.hypot(dx, dy) || 1;
        if (state.pinch) {
          var ratio = dist / state.pinch;
          state.scale = Math.min(5, Math.max(1, state.scale * ratio));
          state.pinch = dist;
          apply();
        }
      } else if (state.dragging && state.scale > 1) {
        state.x = e.clientX - state.px;
        state.y = e.clientY - state.py;
        apply();
      }
    });
    function endPtr(e) {
      state.pointers.delete(e.pointerId);
      if (state.pointers.size < 2) state.pinch = 0;
      if (state.pointers.size === 0) state.dragging = false;
    }
    stage.addEventListener("pointerup", endPtr);
    stage.addEventListener("pointercancel", endPtr);
    stage.addEventListener("dblclick", function () {
      if (state.scale > 1) resetView();
      else {
        state.scale = 2.2;
        apply();
      }
    });
    return box;
  }

  function openFigLightbox(src, alt) {
    if (!src) return;
    var box = ensureFigLightbox();
    var img = box.querySelector(".fig-lb-img");
    box._hqReset();
    img.alt = alt || "";
    img.src = src;
    box.hidden = false;
    box.classList.add("open");
    document.body.classList.add("lb-open");
  }

  function renderLecture(id, opts) {
    opts = opts || {};
    var L = lectureById(id);
    setNav("levels");
    if (!L) {
      main.innerHTML =
        '<div class="card"><p>找不到此課全文。</p><a class="primary" href="#/">返回</a></div>';
      return;
    }
    if (window.__hqScrollCleanup) {
      try { window.__hqScrollCleanup(); } catch (e) {}
    }

    var pages = L.pages && L.pages.length ? L.pages : [{ n: 1, blocks: L.blocks || [], figures: [] }];
    var total = pages.length;
    var savedPg = savedPageFor(L);
    var pageNum = opts.page || (opts.resume && savedPg ? savedPg : 1);
    if (pageNum < 1) pageNum = 1;
    if (pageNum > total) pageNum = total;
    var page = pages[pageNum - 1] || pages[0];
    var prog = lectureProgress(L.id);
    var next = nextOpenGate(L.id);
    var preferGate = firstGateForLecture(L.id);

    persistReadPage(L.id, pageNum);

    var html =
      '<a class="backlink" href="#/">← 關卡列表</a>' +
      '<p class="kicker">' +
      escapeHtml(L.id) +
      " · 全文 · PDF 分頁</p>" +
      "<h2>" +
      escapeHtml(L.titleZh) +
      '</h2><p class="entitle">' +
      escapeHtml(L.titleEn) +
      "</p>" +
      '<div class="flow-steps compact"><span class="flow-step on">① 讀全文</span><span class="flow-arrow">→</span><span class="flow-step">② 溫重點</span><span class="flow-arrow">→</span><span class="flow-step">③ 測驗</span></div>' +
      '<p class="lede reader-hint">跟 PDF 一頁一頁讀；圖表喺文字下面，點圖可放大。點英文可睇解釋／發音／存生字。進度 ' +
      prog.done +
      "/" +
      prog.total +
      " 關已通。</p>" +
      '<div class="reader-toolbar card page-toolbar">' +
      '<button type="button" class="chipbtn' +
      (showZh ? " on" : "") +
      '" id="toggle-zh" aria-pressed="' +
      (showZh ? "true" : "false") +
      '">' +
      (showZh ? "隱藏中文" : "顯示中文") +
      "</button>" +
      '<div class="page-nav" role="navigation" aria-label="PDF 頁">' +
      '<button type="button" class="ghost page-btn" id="page-prev"' +
      (pageNum <= 1 ? " disabled" : "") +
      ">上一頁</button>" +
      '<span class="page-indicator" id="page-indicator">' +
      pageNum +
      " / " +
      total +
      "</span>" +
      '<button type="button" class="ghost page-btn" id="page-next"' +
      (pageNum >= total ? " disabled" : "") +
      ">下一頁</button></div>" +
      '<span class="hint reader-pos-hint" id="read-pos-hint">已記到第 ' +
      pageNum +
      " 頁</span></div>" +
      '<article class="card reader' +
      (showZh ? "" : " hide-zh") +
      '" id="lecture-reader" data-page="' +
      pageNum +
      '">';

    (page.blocks || []).forEach(function (b, bi) {
      var t = b.t || "";
      var zh = b.zh || "";
      var k = b.k || "p";
      var linked = linkAllEnglish(t, preferGate, preferGate ? preferGate.id : "");
      var zhHtml = zh
        ? '<p class="reader-zh" lang="zh-Hant">' + escapeHtml(zh) + "</p>"
        : "";
      var wrapOpen = '<div class="reader-seg" data-bi="' + bi + '">';
      var wrapClose = zhHtml + "</div>";
      if (k === "h") {
        html += wrapOpen + '<h3 class="reader-h">' + linked + "</h3>" + wrapClose;
      } else if (k === "li") {
        html += wrapOpen + '<p class="reader-li">' + linked + "</p>" + wrapClose;
      } else {
        html += wrapOpen + '<p class="reader-p">' + linked + "</p>" + wrapClose;
      }
    });

    var figs = page.figures || [];
    if (figs.length) {
      html += '<div class="fig-grid" aria-label="本頁圖表">';
      figs.forEach(function (f, fi) {
        var src = f.src || "";
        if (!src) return;
        html +=
          '<figure class="fig-card">' +
          '<button type="button" class="fig-btn" data-fig-src="' +
          escapeHtml(src) +
          '" data-fig-alt="第 ' +
          pageNum +
          " 頁圖 " +
          (fi + 1) +
          '" aria-label="放大圖 ' +
          (fi + 1) +
          '">' +
          '<img class="fig-img" src="' +
          escapeHtml(src) +
          '" alt="第 ' +
          pageNum +
          " 頁圖 " +
          (fi + 1) +
          '" loading="lazy" decoding="async"' +
          (f.w ? ' width="' + f.w + '"' : "") +
          (f.h ? ' height="' + f.h + '"' : "") +
          " />" +
          '<span class="fig-zoom-hint" aria-hidden="true">🔍</span>' +
          "</button>" +
          '<figcaption class="hint">圖 ' +
          (fi + 1) +
          (figs.length > 1 ? " / " + figs.length : "") +
          " · 點圖放大</figcaption></figure>";
      });
      html += "</div>";
    }

    html +=
      '<div class="page-nav bottom card" role="navigation">' +
      '<button type="button" class="ghost page-btn" id="page-prev-b"' +
      (pageNum <= 1 ? " disabled" : "") +
      ">← 上一頁</button>" +
      '<span class="page-indicator">' +
      pageNum +
      " / " +
      total +
      "</span>" +
      '<button type="button" class="primary page-btn" id="page-next-b"' +
      (pageNum >= total ? " disabled" : "") +
      ">" +
      (pageNum >= total ? "已到最後頁" : "下一頁 →") +
      "</button></div>";

    if (pageNum >= total) {
      html +=
        '<div class="card feature reader-next" id="lecture-next">' +
        "<p><strong>讀完？下一步溫重點同測驗。</strong></p>" +
        '<div class="gate-actions">' +
        (next
          ? '<a class="primary" href="#/gate/' +
            next.id +
            '">② 溫重點／測驗 →</a>'
          : "") +
        '<a class="ghost" href="#/">返回關卡</a></div></div>';
    }

    html += "</article>";
    main.innerHTML = html;
    window.scrollTo(0, 0);

    var reader = document.getElementById("lecture-reader");
    var toggle = document.getElementById("toggle-zh");
    if (toggle) {
      toggle.addEventListener("click", function () {
        showZh = !showZh;
        saveShowZh(showZh);
        toggle.classList.toggle("on", showZh);
        toggle.setAttribute("aria-pressed", showZh ? "true" : "false");
        toggle.textContent = showZh ? "隱藏中文" : "顯示中文";
        if (reader) reader.classList.toggle("hide-zh", !showZh);
      });
    }

    function goPage(n) {
      if (n < 1 || n > total) return;
      persistReadPage(L.id, n);
      location.hash = "#/lecture/" + encodeURIComponent(L.id) + "/p/" + n;
    }
    function bindNav(prevId, nextId) {
      var prev = document.getElementById(prevId);
      var nxt = document.getElementById(nextId);
      if (prev) prev.addEventListener("click", function () { goPage(pageNum - 1); });
      if (nxt) nxt.addEventListener("click", function () { goPage(pageNum + 1); });
    }
    bindNav("page-prev", "page-next");
    bindNav("page-prev-b", "page-next-b");

    if (reader) {
      reader.querySelectorAll(".fig-btn").forEach(function (btn) {
        btn.addEventListener("click", function () {
          openFigLightbox(btn.getAttribute("data-fig-src"), btn.getAttribute("data-fig-alt") || "");
        });
      });
    }
  }


  function renderGate(id) {
    var g = null;
    var i;
    for (i = 0; i < GATES.length; i++) {
      if (GATES[i].id === id) {
        g = GATES[i];
        break;
      }
    }
    if (!g) {
      main.innerHTML =
        '<div class="card"><p>找不到此關卡。</p><a class="primary" href="#/">返回</a></div>';
      return;
    }
    setNav("levels");
    var unlocked = isUnlocked(g.id);
    var cleared = isCleared(g.id);
    var gi = gateIndex(g.id);
    var html =
      '<a class="backlink" href="#/">← 關卡列表</a>' +
      '<p class="kicker">關 ' +
      (gi + 1) +
      " · " +
      escapeHtml(g.lecture) +
      "</p>" +
      "<h2>" +
      escapeHtml(g.titleZh) +
      '</h2><p class="entitle">' +
      escapeHtml(g.titleEn) +
      "</p>" +
      '<div class="flow-steps" aria-label="學習步驟">' +
      '<a class="flow-step link" href="#/lecture/' +
      encodeURIComponent(g.lecture) +
      '">① 讀全文</a>' +
      '<span class="flow-arrow">→</span>' +
      '<button type="button" class="flow-step on" data-pane="study">② 溫重點</button>' +
      '<span class="flow-arrow">→</span>' +
      '<button type="button" class="flow-step" data-pane="quiz">③ 測驗</button>' +
      "</div>";

    if (!unlocked) {
      html +=
        '<div class="card locked"><p><strong class="lock-icon">🔒 尚未解鎖</strong></p><p class="hint">請先通過上一關測驗。你仍可預覽以下筆記內容。</p></div>';
    } else if (cleared) {
      html +=
        '<div class="card feature"><p class="pill ok">已通關</p><p class="hint" style="margin:8px 0 0">可重溫重點或重做測驗。</p></div>';
    }

    html +=
      '<div class="seg"><button type="button" class="chipbtn on" data-pane="study">重點</button>' +
      '<button type="button" class="chipbtn" data-pane="quiz">測驗</button>' +
      '<button type="button" class="chipbtn" data-pane="vocab">生字</button></div>';

    html += '<div id="pane-study">';
    (g.cards || []).forEach(function (c, idx) {
      var titleEn = c.titleEn || "";
      var titleZh = c.titleZh || "";
      var titleFallback = c.title || "";
      html +=
        '<article class="card study-card"><p class="kicker">卡片 ' +
        (idx + 1) +
        '</p><div class="bi-head">';
      if (titleEn) {
        html +=
          '<h3 class="bi-en-title">' +
          linkAllEnglish(titleEn, g, g.id) +
          "</h3>";
      }
      if (titleZh) {
        html += '<p class="bi-zh-title">' + escapeHtml(titleZh) + "</p>";
      }
      if (!titleEn && !titleZh) {
        html +=
          "<h3>" + linkAllEnglish(titleFallback, g, g.id) + "</h3>";
      }
      html += "</div>";
      (c.bullets || []).forEach(function (b) {
        var en = typeof b === "string" ? b : b.en || "";
        var zh = typeof b === "string" ? "" : b.zh || "";
        html += '<div class="bi-pair">';
        if (en) {
          html +=
            '<p class="bi-en"><span class="lang-pill">EN</span>' +
            linkAllEnglish(en, g, g.id) +
            "</p>";
        }
        if (zh) {
          html +=
            '<p class="bi-zh"><span class="lang-pill">中</span>' +
            escapeHtml(zh) +
            "</p>";
        }
        html += "</div>";
      });
      html += "</article>";
    });
    html +=
      '<div class="gate-actions"><button type="button" class="primary" id="go-quiz">③ 開始測驗</button>' +
      '<a class="ghost" href="#/lecture/' +
      encodeURIComponent(g.lecture) +
      '">① 讀全文</a></div></div>';

    html +=
      '<div id="pane-quiz" hidden><div class="card" id="quiz-root"></div></div>';

    html += '<div id="pane-vocab" hidden>';
    (g.vocab || []).forEach(function (v) {
      html +=
        '<div class="card vocab-card"><button type="button" class="vocab-main" data-open-vocab="' +
        escapeHtml(v.term) +
        '" data-gate="' +
        g.id +
        '"><strong>' +
        escapeHtml(v.term) +
        "</strong> · " +
        escapeHtml(v.zh || "") +
        '<p class="hint" style="margin:4px 0 0">' +
        escapeHtml(v.gloss || "") +
        '</p></button><button type="button" class="speakbtn tiny" data-speak="' +
        escapeHtml(v.term) +
        '" aria-label="發音 ' +
        escapeHtml(v.term) +
        '">' +
        speakIconSvg() +
        "</button></div>";
    });
    html += "</div>";

    main.innerHTML = html;

    var panes = {
      study: document.getElementById("pane-study"),
      quiz: document.getElementById("pane-quiz"),
      vocab: document.getElementById("pane-vocab"),
    };

    function showPane(name) {
      main.querySelectorAll(".chipbtn").forEach(function (b) {
        b.classList.toggle("on", b.getAttribute("data-pane") === name);
      });
      main.querySelectorAll(".flow-step[data-pane]").forEach(function (b) {
        b.classList.toggle("on", b.getAttribute("data-pane") === name);
      });
      Object.keys(panes).forEach(function (k) {
        panes[k].hidden = k !== name;
      });
      if (name === "quiz") startQuiz(g);
    }

    main.querySelectorAll(".chipbtn, .flow-step[data-pane]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var pane = btn.getAttribute("data-pane");
        if (pane) showPane(pane);
      });
    });
    document.getElementById("go-quiz").addEventListener("click", function () {
      showPane("quiz");
    });
    main.querySelectorAll("[data-open-vocab]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        openSheet(findVocab(btn.getAttribute("data-open-vocab"), g), g.id);
      });
    });
    main.querySelectorAll("[data-speak]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        speak(btn.getAttribute("data-speak"), 0.9);
      });
    });
  }

  function startQuiz(g) {
    var root = document.getElementById("quiz-root");
    if (!root) return;
    var questions = (g.quiz || []).slice();
    var idx = 0;
    var correct = 0;
    var answered = false;

    function showQ() {
      answered = false;
      if (idx >= questions.length) {
        var pass = correct >= Math.ceil(questions.length * 0.6);
        var html =
          '<p class="kicker">結果</p><p class="score">' +
          correct +
          " / " +
          questions.length +
          "</p>";
        if (pass) {
          state.cleared[g.id] = true;
          saveState(state);
          html +=
            "<p>通關成功！下一關已解鎖。</p>" +
            '<div class="gate-actions"><a class="primary" href="#/">返回關卡</a>';
          var next = GATES[gateIndex(g.id) + 1];
          if (next) {
            html +=
              '<a class="ghost" href="#/gate/' + next.id + '">下一關 →</a>';
          }
          html += "</div>";
        } else {
          html +=
            "<p>未達通關線（需約 60%）。再溫筆記後重試。</p>" +
            '<div class="gate-actions">' +
            '<button type="button" class="primary" id="retry-quiz">重做測驗</button>' +
            '<a class="ghost" href="#/">返回關卡</a></div>';
        }
        root.innerHTML = html;
        var retry = document.getElementById("retry-quiz");
        if (retry) {
          retry.addEventListener("click", function () {
            idx = 0;
            correct = 0;
            showQ();
          });
        }
        return;
      }

      var q = questions[idx];
      var html =
        '<p class="kicker">題 ' +
        (idx + 1) +
        " / " +
        questions.length +
        '</p><p class="quiz-q">' +
        escapeHtml(q.q) +
        '</p><div class="options">';
      (q.choices || []).forEach(function (c, ci) {
        html +=
          '<button type="button" class="option" data-i="' +
          ci +
          '">' +
          escapeHtml(c) +
          "</button>";
      });
      html +=
        '</div><p class="explain" id="q-explain" hidden></p>' +
        '<div class="gate-actions" style="margin-top:14px">' +
        '<button type="button" class="primary" id="next-q" hidden>下一題</button></div>';
      root.innerHTML = html;

      root.querySelectorAll(".option").forEach(function (btn) {
        btn.addEventListener("click", function () {
          if (answered) return;
          answered = true;
          var choice = Number(btn.getAttribute("data-i"));
          var ok = choice === q.answer;
          if (ok) correct += 1;
          root.querySelectorAll(".option").forEach(function (b) {
            b.disabled = true;
            var bi = Number(b.getAttribute("data-i"));
            if (bi === q.answer) b.classList.add("correct");
            if (bi === choice && !ok) b.classList.add("wrong");
          });
          var ex = document.getElementById("q-explain");
          if (q.explain) {
            ex.hidden = false;
            ex.textContent = q.explain;
          } else if (!ok) {
            ex.hidden = false;
            ex.textContent = "正確： " + (q.choices[q.answer] || "");
          }
          var nq = document.getElementById("next-q");
          nq.hidden = false;
          nq.textContent = idx + 1 >= questions.length ? "看結果" : "下一題";
        });
      });
      document.getElementById("next-q").addEventListener("click", function () {
        idx += 1;
        showQ();
      });
    }
    showQ();
  }

  function renderBank() {
    setNav("bank");
    var keys = liveBankKeys().sort();
    var cfg = loadSyncCfg();
    var html =
      '<p class="kicker">生字庫</p><h2>已儲存生字</h2>' +
      '<p class="lede">筆記入面所有英文都可點：睇解釋、發音、儲生字；複習頁會按間隔提醒。</p>' +
      '<div class="card sync-card">' +
      '<div class="sync-row"><strong>雲端同步</strong> ' +
      (syncConfigured()
        ? '<span class="sync-inline synced">共用庫已開 · ' + escapeHtml(cfg.bank || "hazel") + "</span>"
        : '<span class="sync-inline setup">未開（而家只存呢部機）</span>') +
      '</div>' +
      '<div class="gate-actions sync-actions">' +
      '<a class="primary" href="#/sync">同步</a>' +
      '<button type="button" class="ghost" id="btn-export">匯出備份</button>' +
      '<label class="ghost file-btn">匯入<input type="file" id="btn-import" accept="application/json,.json" hidden /></label>' +
      "</div>" +
      '<p class="hint">生字庫存喺 Will 嘅 Google Drive；朋友唔使登 Google。無網都可用本機快取。</p>' +
      "</div>";
    if (!keys.length) {
      html +=
        '<div class="card empty"><p>未有生字。</p>' +
        '<p class="hint">喺全文或重點筆記點任何英文詞／片語，再加進生字卡。</p>' +
        '<a class="primary" href="#/">去關卡</a></div>';
    } else {
      html += '<p class="hint">共 ' + keys.length + " 個</p>";
      keys.forEach(function (k) {
        var v = state.bank[k];
        html +=
          '<div class="card vocab-card bank-item"><button type="button" class="vocab-main" data-bank="' +
          escapeHtml(k) +
          '"><strong>' +
          escapeHtml(v.term) +
          "</strong> · " +
          escapeHtml(v.zh || "") +
          '<p class="meta"><span class="rating-chip rating-' +
          escapeHtml(itemRating(v)) +
          '">' +
          escapeHtml(ratingLabel(itemRating(v))) +
          "</span> · 下次 " +
          escapeHtml(formatDue(v)) +
          '</p></button><button type="button" class="speakbtn tiny" data-speak="' +
          escapeHtml(v.term) +
          '" aria-label="發音">' +
          speakIconSvg() +
          "</button></div>";
      });
    }
    main.innerHTML = html;
    var ex = document.getElementById("btn-export");
    if (ex) ex.addEventListener("click", exportStateFile);
    var imp = document.getElementById("btn-import");
    if (imp)
      imp.addEventListener("change", function () {
        if (imp.files && imp.files[0]) importStateFile(imp.files[0]);
        imp.value = "";
      });
    main.querySelectorAll("[data-bank]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var v = state.bank[btn.getAttribute("data-bank")];
        if (v) openSheet(v, v.gateId || "");
      });
    });
    main.querySelectorAll("[data-speak]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        speak(btn.getAttribute("data-speak"), 0.9);
      });
    });
  }

  function renderSync() {
    setNav("bank");
    var cfg = loadSyncCfg();
    var urlLocked = !!(DEFAULT_SYNC_URL && cfg.url === DEFAULT_SYNC_URL);
    main.innerHTML =
      '<p class="kicker">雲端</p><h2>共用生字庫</h2>' +
      '<p class="lede">生字／關卡／複習進度寫入 Will 嘅 Google Drive（檔案 <code>hazelquiz-shared-bank.json</code>）。朋友<strong>唔使登入 Google</strong>；開網站就會自動同步。本機仍有快取。</p>' +
      '<div class="card">' +
      (urlLocked
        ? '<p class="hint">已內建同步網址 · 庫名 <strong>' +
          escapeHtml(cfg.bank || "hazel") +
          "</strong>。撳下面即可同步。</p>"
        : '<label class="field"><span>Apps Script 網址（/exec）— 只需 Will 貼一次</span>' +
          '<input id="sync-url" type="url" placeholder="https://script.google.com/macros/s/…/exec" value="' +
          escapeHtml(cfg.url) +
          '" /></label>' +
          '<p class="hint">部署見 Drive 資料夾 <code>HazelQuiz-Sync-DEPLOY.md</code>。貼完之後朋友開網站就得，唔使填 PIN／登入。</p>') +
      '<div class="gate-actions">' +
      (urlLocked
        ? ""
        : '<button type="button" class="primary" id="sync-save">儲存並同步</button>') +
      '<button type="button" class="primary" id="sync-now">' +
      (urlLocked ? "立即同步" : "立即同步") +
      "</button>" +
      '<a class="ghost" href="#/bank">返回生字</a>' +
      "</div>" +
      '<p class="hint" id="sync-msg"></p>' +
      "</div>" +
      '<div class="card">' +
      '<h3 class="sync-h3">本機備份</h3>' +
      '<div class="gate-actions">' +
      '<button type="button" class="ghost" id="sync-export">匯出 JSON</button>' +
      '<label class="ghost file-btn">匯入 JSON<input type="file" id="sync-import" accept="application/json,.json" hidden /></label>' +
      "</div></div>";

    function msg(t, ok) {
      var el = document.getElementById("sync-msg");
      if (!el) return;
      el.textContent = t;
      el.style.color = ok ? "var(--ok)" : "var(--bad)";
    }

    function startSync(url) {
      var next = {
        url: (url || cfg.url || "").trim(),
        bank: DEFAULT_BANK,
      };
      if (!next.url || next.url.indexOf("http") !== 0) return msg("請貼 Apps Script /exec 網址", false);
      saveSyncCfg(next);
      syncGen += 1;
      cloudReady = false;
      cloudPending = true;
      msg("正在同步到 Drive…", true);
      updateSyncStatus();
      pullCloud();
      setTimeout(function () {
        updateSyncStatus();
        if (syncStatus === "synced") msg("已同步到雲端 ✓（hazelquiz-shared-bank.json）", true);
        else if (syncStatus === "error") msg("同步失敗：" + (syncError || "請檢查網址／授權"), false);
      }, 1500);
    }

    var saveBtn = document.getElementById("sync-save");
    if (saveBtn) {
      saveBtn.addEventListener("click", function () {
        var input = document.getElementById("sync-url");
        startSync(input ? input.value.trim() : "");
      });
    }
    document.getElementById("sync-now").addEventListener("click", function () {
      if (!syncConfigured() && !urlLocked) {
        var input = document.getElementById("sync-url");
        return startSync(input ? input.value.trim() : "");
      }
      if (!syncConfigured()) return msg("尚未設定同步網址", false);
      cloudPending = true;
      pullCloud();
      msg("同步中…", true);
      setTimeout(function () {
        updateSyncStatus();
        if (syncStatus === "synced") msg("已同步 ✓", true);
        else if (syncStatus === "error") msg("同步失敗：" + (syncError || ""), false);
      }, 1500);
    });
    document.getElementById("sync-export").addEventListener("click", exportStateFile);
    document.getElementById("sync-import").addEventListener("change", function (e) {
      var f = e.target.files && e.target.files[0];
      if (f) importStateFile(f);
      e.target.value = "";
    });
  }

  function formatDue(item) {
    var at = itemDueAt(item);
    if (!at) return "—";
    var d = new Date(at);
    var now = Date.now();
    var diff = at - now;
    if (diff <= 0) return "而家";
    if (diff < 60 * 60 * 1000) return Math.max(1, Math.round(diff / 60000)) + " 分鐘後";
    if (diff < 24 * 60 * 60 * 1000) return Math.max(1, Math.round(diff / 3600000)) + " 小時後";
    var iso =
      d.getFullYear() +
      "-" +
      String(d.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(d.getDate()).padStart(2, "0");
    return iso;
  }

  function gradeRating(v, ratingId) {
    var key = v.term.toLowerCase();
    var item = state.bank[key];
    if (!item) return;
    var meta = RATING_META[ratingId] || RATING_META.again;
    var now = Date.now();
    var dueAt = now + (meta.intervalMs || 0);
    item.rating = meta.id;
    item.lastRating = meta.id;
    item.reviewed = true;
    item.stage =
      meta.id === "again" ? 0 : meta.id === "hard" ? 1 : meta.id === "ok" ? 2 : 3;
    item.dueAt = dueAt;
    item.due =
      new Date(dueAt).getFullYear() +
      "-" +
      String(new Date(dueAt).getMonth() + 1).padStart(2, "0") +
      "-" +
      String(new Date(dueAt).getDate()).padStart(2, "0");
    state.bank[key] = touchBankItem(item);
    saveState(state);
    updateBadge();
  }

  function renderReviewHub() {
    setNav("review");
    var counts = bucketCounts();
    var news = newWordCount();
    var dueOnly = 0;
    liveBankKeys().forEach(function (k) {
      var it = state.bank[k];
      if (itemRating(it) !== "new" && isDueItem(it)) dueOnly += 1;
    });
    var sessionN = news + dueOnly;
    var html =
      '<p class="kicker">單字卡</p><h2 class="rev-title">單字卡複習</h2>' +
      '<section class="rev-section"><h3 class="rev-h3">單字表</h3><div class="bucket-list">';
    RATING_ORDER.forEach(function (id) {
      var m = RATING_META[id];
      html +=
        '<a class="bucket-row bucket-' +
        m.color +
        '" href="#/review/bucket/' +
        id +
        '"><span class="bucket-icon" aria-hidden="true"></span><span class="bucket-label">' +
        escapeHtml(m.label) +
        '</span><span class="bucket-count">' +
        (counts[id] || 0) +
        '</span><span class="bucket-chevron" aria-hidden="true">›</span></a>';
    });
    html +=
      "</div></section>" +
      '<section class="rev-section"><h3 class="rev-h3">今日練習 <span class="rev-dumbbell" aria-hidden="true">🏋️</span></h3>' +
      '<div class="today-practice">' +
      '<div class="today-stat"><div class="today-stat-n">' +
      news +
      '</div><div class="today-stat-l">新單字</div><div class="today-stat-sub">' +
      news +
      " 個單字</div></div>" +
      '<div class="today-plus" aria-hidden="true">+</div>' +
      '<div class="today-stat"><div class="today-stat-n">' +
      dueOnly +
      '</div><div class="today-stat-l">待複習</div><div class="today-stat-sub">' +
      dueOnly +
      " 個單字</div></div>" +
      "</div>";
    if (sessionN > 0) {
      html +=
        '<a class="primary rev-start" href="#/review/go">複習 ' +
        sessionN +
        " 個單字</a>";
    } else {
      html +=
        '<div class="card empty rev-empty"><p>今日無需複習 🎉</p>' +
        '<p class="hint">生字庫共 ' +
        liveBankKeys().length +
        ' 個。喺全文點英文加生字後會出現喺呢度。</p>' +
        '<a class="ghost" href="#/bank">查看生字</a></div>';
    }
    html += "</section>";
    main.innerHTML = html;
  }

  function renderReviewBucket(ratingId) {
    setNav("review");
    var meta = RATING_META[ratingId] || RATING_META.new;
    var items = [];
    liveBankKeys().forEach(function (k) {
      var it = state.bank[k];
      if (itemRating(it) === meta.id) items.push(it);
    });
    items.sort(function (a, b) {
      return (a.term || "").localeCompare(b.term || "");
    });
    var dueInBucket = items.filter(isDueItem);
    var html =
      '<a class="backlink" href="#/review">← 單字卡複習</a>' +
      '<p class="kicker">單字表</p><h2>' +
      escapeHtml(meta.label) +
      "</h2>" +
      '<p class="lede">共 ' +
      items.length +
      " 個" +
      (dueInBucket.length ? " · 其中 " + dueInBucket.length + " 個到期" : "") +
      "</p>";
    if (dueInBucket.length) {
      html +=
        '<a class="primary rev-start" href="#/review/go/' +
        meta.id +
        '">複習呢啲到期（' +
        dueInBucket.length +
        "）</a>";
    }
    if (!items.length) {
      html += '<div class="card empty"><p>呢個分類暫時未有生字。</p></div>';
    } else {
      items.forEach(function (v) {
        html +=
          '<div class="card vocab-card bank-item"><button type="button" class="vocab-main" data-bank="' +
          escapeHtml(v.term.toLowerCase()) +
          '"><strong>' +
          escapeHtml(v.term) +
          "</strong> · " +
          escapeHtml(v.zh || "") +
          '<p class="meta">下次 ' +
          escapeHtml(formatDue(v)) +
          (isDueItem(v) ? " · 到期" : "") +
          '</p></button><button type="button" class="speakbtn tiny" data-speak="' +
          escapeHtml(v.term) +
          '" aria-label="發音">' +
          speakIconSvg() +
          "</button></div>";
      });
    }
    main.innerHTML = html;
    main.querySelectorAll("[data-bank]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var v = state.bank[btn.getAttribute("data-bank")];
        if (v) openSheet(v, v.gateId || "");
      });
    });
    main.querySelectorAll("[data-speak]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        speak(btn.getAttribute("data-speak"), 0.9);
      });
    });
  }

  function renderReviewSession(filterRating) {
    setNav("review");
    var queue = reviewQueue(filterRating || null);
    // If filter is a non-new bucket, reviewQueue already filters; for "new" include only new
    if (filterRating === "new") {
      queue = [];
      liveBankKeys().forEach(function (k) {
        var it = state.bank[k];
        if (itemRating(it) === "new") queue.push(it);
      });
    } else if (filterRating && filterRating !== "new") {
      queue = [];
      liveBankKeys().forEach(function (k) {
        var it = state.bank[k];
        if (itemRating(it) === filterRating && isDueItem(it)) queue.push(it);
      });
      queue.sort(function (a, b) {
        return itemDueAt(a) - itemDueAt(b);
      });
    }

    var newsLeft = queue.filter(function (v) {
      return itemRating(v) === "new";
    }).length;
    var dueLeft = queue.length - newsLeft;
    var i = 0;
    var revealed = false;

    function headerChips() {
      return (
        '<div class="fc-top">' +
        '<a class="fc-navback" href="#/review" aria-label="返回">‹</a>' +
        '<span class="fc-chip">新單字 ' +
        newsLeft +
        '</span><span class="fc-chip on">待複習 ' +
        Math.max(0, queue.length - i) +
        "</span></div>"
      );
    }

    function showCard() {
      if (i >= queue.length) {
        main.innerHTML =
          '<div class="card feature rev-done"><h2>複習完成</h2><p>今次處理咗 ' +
          queue.length +
          ' 個單字。</p><a class="primary" href="#/review">返回單字卡</a></div>';
        updateBadge();
        return;
      }
      var v = queue[i];
      var r = itemRating(v);
      var rMeta = RATING_META[r] || RATING_META.new;
      revealed = false;
      var concept = (v.gloss || "").trim();
      if (concept && v.zh && concept === v.zh) concept = "";
      if (!concept && v.gloss) concept = v.gloss;
      main.innerHTML =
        headerChips() +
        '<div class="fc-card">' +
        '<div class="fc-tags">' +
        '<span class="fc-tag fc-tag-rating rating-' +
        r +
        '">' +
        escapeHtml(rMeta.short) +
        "</span>" +
        (v.gateId
          ? '<span class="fc-tag fc-tag-muted">' + escapeHtml(String(v.gateId).replace(/^g-?/, "")) + "</span>"
          : "") +
        "</div>" +
        '<div class="fc-front">' +
        '<p class="fc-term">' +
        escapeHtml(v.term) +
        "</p>" +
        '<div class="fc-tools"><button type="button" class="speakbtn" id="rev-speak" aria-label="發音">' +
        speakIconSvg() +
        "</button></div>" +
        "</div>" +
        '<div class="fc-divider" aria-hidden="true"><span></span></div>' +
        '<div class="fc-answer" id="fc-back" hidden>' +
        '<p class="fc-zh">' +
        escapeHtml(v.zh || "（未有翻譯）") +
        "</p>" +
        (concept
          ? '<p class="fc-concept">' + escapeHtml(concept) + "</p>"
          : '<p class="fc-concept muted">暫未有概念解釋 — 可返筆記再點一次詞彙補齊。</p>') +
        (phonHint(v) ? '<p class="phon">' + escapeHtml(phonHint(v)) + "</p>" : "") +
        "</div></div>" +
        '<div class="fc-actions" id="fc-actions">' +
        '<button type="button" class="primary fc-reveal" id="rev-reveal">揭曉答案 ✨</button>' +
        "</div>";

      document.getElementById("rev-speak").addEventListener("click", function () {
        speak(v.term, 0.9);
      });
      document.getElementById("rev-reveal").addEventListener("click", function () {
        revealed = true;
        document.getElementById("fc-back").hidden = false;
        var box = document.getElementById("fc-actions");
        box.innerHTML =
          '<div class="fc-grades">' +
          '<button type="button" class="grade-btn grade-again" data-grade="again"><span>再複習一次</span><small>1分鐘</small></button>' +
          '<button type="button" class="grade-btn grade-hard" data-grade="hard"><span>困難</span><small>10分鐘</small></button>' +
          '<button type="button" class="grade-btn grade-ok" data-grade="ok"><span>還可以</span><small>2天</small></button>' +
          '<button type="button" class="grade-btn grade-easy" data-grade="easy"><span>簡單</span><small>4天</small></button>' +
          "</div>";
        box.querySelectorAll("[data-grade]").forEach(function (btn) {
          btn.addEventListener("click", function () {
            var wasNew = itemRating(v) === "new";
            gradeRating(v, btn.getAttribute("data-grade"));
            if (wasNew) newsLeft = Math.max(0, newsLeft - 1);
            i += 1;
            showCard();
          });
        });
      });
    }

    if (!queue.length) {
      main.innerHTML =
        '<a class="backlink" href="#/review">← 返回</a>' +
        '<div class="card empty"><p>呢度暫時冇要複習嘅單字。</p></div>';
      return;
    }
    showCard();
  }

  function renderReview() {
    var hash = location.hash || "#/review";
    var bm = hash.match(/^#\/review\/bucket\/(\w+)/);
    if (bm) {
      renderReviewBucket(bm[1]);
      return;
    }
    var gm = hash.match(/^#\/review\/go(?:\/(\w+))?/);
    if (gm) {
      renderReviewSession(gm[1] || null);
      return;
    }
    renderReviewHub();
  }

  function route() {
    closeSheet();
    if (window.__hqScrollCleanup) {
      try {
        window.__hqScrollCleanup();
      } catch (e) {}
    }
    var hash = location.hash || "#/";
    var m = hash.match(/^#\/gate\/([\w-]+)/);
    if (m) {
      renderGate(m[1]);
      return;
    }
    var lm = hash.match(/^#\/lecture\/([\w-]+)(?:\/p\/(\d+)|(\/resume))?/);
    if (lm) {
      var pageOpt = lm[2] ? parseInt(lm[2], 10) : 0;
      renderLecture(lm[1], {
        resume: !!lm[3],
        page: pageOpt || undefined,
      });
      return;
    }
    if (hash.indexOf("#/sync") === 0) {
      renderSync();
      return;
    }
    if (hash.indexOf("#/bank") === 0) {
      renderBank();
      return;
    }
    if (hash.indexOf("#/review") === 0) {
      renderReview();
      return;
    }
    renderLevels();
  }

  todayLabel.textContent = todayISO();
  updateBadge();
  updateSyncStatus();
  window.addEventListener("hashchange", route);
  route();
  pullCloud();
})();
