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
  var SRS = META.srsIntervals || [1, 3, 7, 14, 30];

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

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { cleared: {}, bank: {}, progress: {}, readPos: {} };
      var data = JSON.parse(raw);
      return {
        cleared: data.cleared || {},
        bank: data.bank || {},
        progress: data.progress || {},
        readPos: data.readPos || {},
      };
    } catch (e) {
      return { cleared: {}, bank: {}, progress: {}, readPos: {} };
    }
  }

  function saveState(state) {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        cleared: state.cleared,
        bank: state.bank,
        progress: state.progress,
        readPos: state.readPos || {},
        v: 1,
      })
    );
  }

  var state = loadState();

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

  function dueCount() {
    var t = todayISO();
    var n = 0;
    Object.keys(state.bank).forEach(function (k) {
      var item = state.bank[k];
      if (item && item.due && item.due <= t) n += 1;
    });
    return n;
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

  function findVocab(term, gate) {
    var t = String(term || "").toLowerCase();
    var i, g, list, hit;
    if (gate && gate.vocab) {
      for (i = 0; i < gate.vocab.length; i++) {
        if (gate.vocab[i].term.toLowerCase() === t) return gate.vocab[i];
      }
    }
    for (g = 0; g < GATES.length; g++) {
      list = GATES[g].vocab || [];
      for (i = 0; i < list.length; i++) {
        if (list[i].term.toLowerCase() === t) return list[i];
      }
    }
    hit = GLOSSARY[t];
    if (hit) {
      return {
        term: hit.term || term,
        zh: hit.zh || "",
        ipa: hit.ipa || "",
        say: hit.say || "",
        gloss: hit.gloss || hit.zh || "",
      };
    }
    // light stemming: plurals / -ing / -ed for common academic words
    var alts = [];
    if (t.length > 4 && t.slice(-1) === "s") alts.push(t.slice(0, -1));
    if (t.length > 5 && t.slice(-3) === "ies") alts.push(t.slice(0, -3) + "y");
    if (t.length > 5 && t.slice(-3) === "ing") {
      alts.push(t.slice(0, -3));
      alts.push(t.slice(0, -3) + "e");
    }
    if (t.length > 4 && t.slice(-2) === "ed") {
      alts.push(t.slice(0, -2));
      alts.push(t.slice(0, -1));
    }
    for (i = 0; i < alts.length; i++) {
      hit = GLOSSARY[alts[i]];
      if (hit) {
        return {
          term: String(term || "").trim() || term,
          zh: hit.zh || "",
          ipa: hit.ipa || "",
          say: hit.say || "",
          gloss: hit.gloss || hit.zh || "",
        };
      }
    }
    var display = String(term || "").trim() || term;
    return {
      term: display,
      zh: "",
      ipa: "",
      say: "",
      gloss: "未有詳細解釋。可仍加進生字卡；之後更新詞庫會補上。",
    };
  }

  function openSheet(vocab, gateId) {
    sheetTerm = { vocab: vocab, gateId: gateId || "" };
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
    var saved = !!state.bank[key];
    document.getElementById("sheet-save").hidden = saved;
    document.getElementById("sheet-remove").hidden = !saved;
    var note = document.getElementById("sheet-note");
    if (saved && state.bank[key].due) {
      note.hidden = false;
      note.textContent = "已儲存 · 下次複習 " + state.bank[key].due;
    } else {
      note.hidden = true;
    }
    backdrop.hidden = false;
    sheet.hidden = false;
    sheet.focus();
  }

  function closeSheet() {
    backdrop.hidden = true;
    sheet.hidden = true;
    sheetTerm = null;
  }

  function saveVocab() {
    if (!sheetTerm) return;
    var v = sheetTerm.vocab;
    var key = v.term.toLowerCase();
    state.bank[key] = {
      term: v.term,
      zh: v.zh || "",
      ipa: v.ipa || "",
      say: v.say || phonHint(v) || "",
      gloss: v.gloss || "",
      gateId: sheetTerm.gateId || "",
      stage: 0,
      due: todayISO(),
      added: todayISO(),
    };
    saveState(state);
    updateBadge();
    openSheet(v, sheetTerm.gateId);
  }

  function removeVocab() {
    if (!sheetTerm) return;
    var key = sheetTerm.vocab.term.toLowerCase();
    delete state.bank[key];
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
    openSheet(findVocab(t.getAttribute("data-term"), gate), gateId);
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
        ((state.readPos && state.readPos[lid] > 80)
          ? '<a class="ghost" href="#/lecture/' +
            encodeURIComponent(lid) +
            '">繼續上次</a>'
          : '');
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

  function renderLecture(id) {
    var L = lectureById(id);
    setNav("levels");
    if (!L) {
      main.innerHTML =
        '<div class="card"><p>找不到此課全文。</p><a class="primary" href="#/">返回</a></div>';
      return;
    }
    var prog = lectureProgress(L.id);
    var next = nextOpenGate(L.id);
    var saved = (state.readPos && state.readPos[L.id]) || 0;
    var html =
      '<a class="backlink" href="#/">← 關卡列表</a>' +
      '<p class="kicker">' +
      escapeHtml(L.id) +
      " · 全文</p>" +
      "<h2>" +
      escapeHtml(L.titleZh) +
      '</h2><p class="entitle">' +
      escapeHtml(L.titleEn) +
      "</p>" +
      '<div class="flow-steps compact"><span class="flow-step on">① 讀全文</span><span class="flow-arrow">→</span><span class="flow-step">② 溫重點</span><span class="flow-arrow">→</span><span class="flow-step">③ 測驗</span></div>' +
      '<p class="lede reader-hint">像 Open Readle：掃全文，點唔識嘅英文就可睇解釋／發音／存生字。進度 ' +
      prog.done +
      "/" +
      prog.total +
      " 關已通。</p>" +
      '<div class="reader-toolbar card">' +
      '<button type="button" class="chipbtn' +
      (showZh ? " on" : "") +
      '" id="toggle-zh" aria-pressed="' +
      (showZh ? "true" : "false") +
      '">' +
      (showZh ? "隱藏中文" : "顯示中文") +
      "</button>" +
      (saved > 80
        ? '<button type="button" class="ghost" id="resume-read">繼續上次閱讀</button>'
        : "") +
      '<span class="hint reader-pos-hint" id="read-pos-hint">' +
      (saved > 80 ? "已記住閱讀位置" : "向下捲動會自動記住進度") +
      "</span></div>" +
      '<article class="card reader' +
      (showZh ? "" : " hide-zh") +
      '" id="lecture-reader">';

    var preferGate = firstGateForLecture(L.id);
    (L.blocks || []).forEach(function (b, bi) {
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

    // Next-step actions ONLY at end of body (not sticky / not floating)
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

    html += "</article>";

    main.innerHTML = html;

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
    var resumeBtn = document.getElementById("resume-read");
    if (resumeBtn && saved > 80) {
      resumeBtn.addEventListener("click", function () {
        window.scrollTo({ top: saved, behavior: "smooth" });
      });
    }
    // Auto-offer resume once if deep into page
    if (saved > 120) {
      requestAnimationFrame(function () {
        /* stay at top; user taps 繼續上次 — avoid jump surprise */
      });
    }

    var saveTimer = null;
    function persistPos() {
      if (!state.readPos) state.readPos = {};
      state.readPos[L.id] = window.scrollY || 0;
      saveState(state);
      var hint = document.getElementById("read-pos-hint");
      if (hint && state.readPos[L.id] > 80) {
        hint.textContent = "進度已存 · 可按「繼續上次閱讀」";
      }
    }
    function onScroll() {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(persistPos, 400);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    if (window.__hqScrollCleanup) {
      try {
        window.__hqScrollCleanup();
      } catch (e) {}
    }
    window.__hqScrollCleanup = function () {
      window.removeEventListener("scroll", onScroll);
      persistPos();
      window.__hqScrollCleanup = null;
    };
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
    var keys = Object.keys(state.bank).sort();
    var html =
      '<p class="kicker">生字庫</p><h2>已儲存生字</h2>' +
      '<p class="lede">筆記入面所有英文都可點：睇解釋、發音、儲生字；複習頁會按間隔提醒。</p>';
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
          '<p class="meta">下次複習 ' +
          escapeHtml(v.due || "—") +
          " · 階段 " +
          (v.stage || 0) +
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

  function grade(v, know) {
    var key = v.term.toLowerCase();
    var item = state.bank[key];
    if (!item) return;
    var stage = item.stage || 0;
    if (know) stage = Math.min(stage + 1, SRS.length - 1);
    else stage = 0;
    item.stage = stage;
    item.due = addDays(todayISO(), SRS[stage]);
    state.bank[key] = item;
    saveState(state);
    updateBadge();
  }

  function renderReview() {
    setNav("review");
    var t = todayISO();
    var due = [];
    Object.keys(state.bank).forEach(function (k) {
      var item = state.bank[k];
      if (item && item.due && item.due <= t) due.push(item);
    });
    due.sort(function (a, b) {
      return (a.due || "").localeCompare(b.due || "");
    });

    var html =
      '<p class="kicker">間隔複習</p><h2>今日複習</h2>' +
      '<p class="lede">間隔：1 · 3 · 7 · 14 · 30 日（記住／忘記會調整階段）</p>';

    if (!due.length) {
      html +=
        '<div class="card empty"><p>今日無需複習 🎉</p>' +
        '<p class="hint">生字庫有 ' +
        Object.keys(state.bank).length +
        " 個詞。</p>" +
        '<a class="primary" href="#/bank">查看生字</a></div>';
      main.innerHTML = html;
      return;
    }

    var i = 0;
    function showCard() {
      if (i >= due.length) {
        main.innerHTML =
          '<div class="card feature"><h2>複習完成</h2><p>今日 ' +
          due.length +
          ' 個已處理。</p><a class="primary" href="#/">返回關卡</a></div>';
        updateBadge();
        return;
      }
      var v = due[i];
      main.innerHTML =
        '<p class="kicker">複習 ' +
        (i + 1) +
        " / " +
        due.length +
        '</p><div class="card feature"><div class="sheet-head" style="margin-bottom:8px"><h2 style="margin:0">' +
        escapeHtml(v.term) +
        '</h2><button type="button" class="speakbtn" id="rev-speak" aria-label="發音">' +
        speakIconSvg() +
        '</button></div><p class="gloss" id="rev-zh" hidden>' +
        escapeHtml(v.zh || "") +
        '</p><p class="ex" id="rev-gloss" hidden>' +
        escapeHtml(v.gloss || "") +
        '</p><p class="phon" id="rev-ipa" hidden></p>' +
        '<div class="gate-actions">' +
        '<button type="button" class="ghost" id="rev-reveal">顯示答案</button>' +
        '<button type="button" class="primary" id="rev-know" hidden>記住了</button>' +
        '<button type="button" class="ghost" id="rev-forget" hidden>唔記得</button>' +
        "</div></div>";
      var ipaEl = document.getElementById("rev-ipa");
      var revHint = phonHint(v);
      if (revHint) {
        ipaEl.textContent = revHint;
      }
      document.getElementById("rev-speak").addEventListener("click", function () {
        speak(v.term, 0.9);
      });
      document.getElementById("rev-reveal").addEventListener("click", function () {
        document.getElementById("rev-zh").hidden = false;
        document.getElementById("rev-gloss").hidden = false;
        if (revHint) ipaEl.hidden = false;
        document.getElementById("rev-know").hidden = false;
        document.getElementById("rev-forget").hidden = false;
        this.hidden = true;
      });
      document.getElementById("rev-know").addEventListener("click", function () {
        grade(v, true);
        i += 1;
        showCard();
      });
      document
        .getElementById("rev-forget")
        .addEventListener("click", function () {
          grade(v, false);
          i += 1;
          showCard();
        });
    }
    showCard();
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
    var lm = hash.match(/^#\/lecture\/([\w-]+)/);
    if (lm) {
      renderLecture(lm[1]);
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
  window.addEventListener("hashchange", route);
  route();
})();
