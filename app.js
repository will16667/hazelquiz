/* HazelQuiz — mobile-first study SPA */
(function () {
  "use strict";

  var META = window.HAZEL_META || {
    appName: "HazelQuiz",
    storageKey: "hazelquiz-v1",
    srsIntervals: [1, 3, 7, 14, 30],
  };
  var GATES = window.HAZEL_GATES || [];
  var STORAGE_KEY = META.storageKey || "hazelquiz-v1";
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
      if (!raw) return { cleared: {}, bank: {}, progress: {} };
      var data = JSON.parse(raw);
      return {
        cleared: data.cleared || {},
        bank: data.bank || {},
        progress: data.progress || {},
      };
    } catch (e) {
      return { cleared: {}, bank: {}, progress: {} };
    }
  }

  function saveState(state) {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        cleared: state.cleared,
        bank: state.bank,
        progress: state.progress,
        v: 1,
      })
    );
  }

  var state = loadState();

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

  function linkTerms(text, vocab, gateId) {
    if (!vocab || !vocab.length) return escapeHtml(text);
    var terms = vocab
      .map(function (v) {
        return v.term;
      })
      .filter(Boolean)
      .sort(function (a, b) {
        return b.length - a.length;
      });
    if (!terms.length) return escapeHtml(text);
    var re = new RegExp(
      "(" +
        terms
          .map(function (t) {
            return t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          })
          .join("|") +
        ")",
      "g"
    );
    var gid = gateId || "";
    return escapeHtml(text).replace(re, function (m) {
      return (
        '<button type="button" class="term" data-gate="' +
        escapeHtml(gid) +
        '" data-term="' +
        escapeHtml(m) +
        '">' +
        m +
        "</button>"
      );
    });
  }

  function findVocab(term, gate) {
    var t = term.toLowerCase();
    var i, g, list;
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
    return { term: term, zh: "", ipa: "", gloss: "筆記生字" };
  }

  function openSheet(vocab, gateId) {
    sheetTerm = { vocab: vocab, gateId: gateId || "" };
    document.getElementById("sheet-term").textContent = vocab.term;
    document.getElementById("sheet-zh").textContent = vocab.zh || "";
    var ipa = document.getElementById("sheet-ipa");
    if (vocab.ipa) {
      ipa.hidden = false;
      ipa.textContent = vocab.ipa;
    } else {
      ipa.hidden = true;
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

  function renderLevels() {
    setNav("levels");
    var total = GATES.length;
    var done = clearedCount();
    var pct = total ? Math.round((done / total) * 100) : 0;
    var html =
      '<p class="kicker">Life Sciences</p>' +
      "<h2>關卡列表</h2>" +
      '<p class="lede">Higher Diploma · AS114218 · 依序闖關溫習筆記重點</p>' +
      '<div class="card feature"><div class="cardtop"><span class="pill">進度</span><strong>' +
      done +
      " / " +
      total +
      '</strong></div><div class="progress" aria-hidden="true"><span style="width:' +
      pct +
      '%"></span></div>' +
      '<p class="hint" style="margin:6px 0 0">通關測驗後解鎖下一關；未解鎖亦可預覽（軟鎖）。</p></div>';

    var lecture = "";
    GATES.forEach(function (g, i) {
      if (g.lecture !== lecture) {
        lecture = g.lecture;
        html +=
          '<p class="kicker" style="margin-top:18px">' +
          escapeHtml(lecture) +
          " · " +
          escapeHtml(g.lectureTitle || "") +
          "</p>";
      }
      var unlocked = isUnlocked(g.id);
      var cleared = isCleared(g.id);
      var cls =
        "card" + (cleared ? " cleared" : "") + (!unlocked ? " locked" : "");
      var status = cleared
        ? '<span class="pill ok">已通關 ✓</span>'
        : unlocked
          ? '<span class="pill">可挑戰</span>'
          : '<span class="pill lock">🔒 未解鎖</span>';
      html +=
        '<a class="cardlink" href="#/gate/' +
        g.id +
        '"><article class="' +
        cls +
        '"><div class="cardtop">' +
        '<span class="pill lecture">關 ' +
        (i + 1) +
        "</span>" +
        status +
        "</div><h3>" +
        escapeHtml(g.titleZh) +
        '</h3><p class="entitle">' +
        escapeHtml(g.titleEn) +
        '</p><p class="hint" style="margin:8px 0 0">' +
        (g.cards ? g.cards.length : 0) +
        " 張筆記卡 · " +
        (g.quiz ? g.quiz.length : 0) +
        " 題測驗</p></article></a>";
    });
    main.innerHTML = html;
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
      "</p>";

    if (!unlocked) {
      html +=
        '<div class="card locked"><p><strong class="lock-icon">🔒 尚未解鎖</strong></p><p class="hint">請先通過上一關測驗。你仍可預覽以下筆記內容。</p></div>';
    } else if (cleared) {
      html +=
        '<div class="card feature"><p class="pill ok">已通關</p><p class="hint" style="margin:8px 0 0">可重溫筆記或重做測驗。</p></div>';
    }

    html +=
      '<div class="seg"><button type="button" class="chipbtn on" data-pane="study">筆記</button>' +
      '<button type="button" class="chipbtn" data-pane="quiz">測驗</button>' +
      '<button type="button" class="chipbtn" data-pane="vocab">生字</button></div>';

    html += '<div id="pane-study">';
    (g.cards || []).forEach(function (c, idx) {
      html +=
        '<article class="card study-card"><p class="kicker">卡片 ' +
        (idx + 1) +
        "</p><h3>" +
        linkTerms(c.title, g.vocab, g.id) +
        "</h3><ul>";
      (c.bullets || []).forEach(function (b) {
        html += "<li>" + linkTerms(b, g.vocab, g.id) + "</li>";
      });
      html += "</ul></article>";
    });
    html +=
      '<div class="gate-actions"><button type="button" class="primary" id="go-quiz">開始測驗</button></div></div>';

    html +=
      '<div id="pane-quiz" hidden><div class="card" id="quiz-root"></div></div>';

    html += '<div id="pane-vocab" hidden>';
    (g.vocab || []).forEach(function (v) {
      html +=
        '<button type="button" class="card" style="width:100%;text-align:left" data-open-vocab="' +
        escapeHtml(v.term) +
        '" data-gate="' +
        g.id +
        '"><strong>' +
        escapeHtml(v.term) +
        "</strong> · " +
        escapeHtml(v.zh || "") +
        '<p class="hint" style="margin:4px 0 0">' +
        escapeHtml(v.gloss || "") +
        "</p></button>";
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
      Object.keys(panes).forEach(function (k) {
        panes[k].hidden = k !== name;
      });
      if (name === "quiz") startQuiz(g);
    }

    main.querySelectorAll(".chipbtn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        showPane(btn.getAttribute("data-pane"));
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
      '<p class="lede">點英文詞睇解釋；複習頁會按間隔提醒。</p>';
    if (!keys.length) {
      html +=
        '<div class="card empty"><p>未有生字。</p>' +
        '<p class="hint">喺關卡筆記點藍色英文詞，再加進生字卡。</p>' +
        '<a class="primary" href="#/">去關卡</a></div>';
    } else {
      html += '<p class="hint">共 ' + keys.length + " 個</p>";
      keys.forEach(function (k) {
        var v = state.bank[k];
        html +=
          '<button type="button" class="card bank-item" style="width:100%;text-align:left" data-bank="' +
          escapeHtml(k) +
          '"><strong>' +
          escapeHtml(v.term) +
          "</strong> · " +
          escapeHtml(v.zh || "") +
          '<p class="meta">下次複習 ' +
          escapeHtml(v.due || "—") +
          " · 階段 " +
          (v.stage || 0) +
          "</p></button>";
      });
    }
    main.innerHTML = html;
    main.querySelectorAll("[data-bank]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var v = state.bank[btn.getAttribute("data-bank")];
        if (v) openSheet(v, v.gateId || "");
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
        '</p><div class="card feature"><h2>' +
        escapeHtml(v.term) +
        '</h2><p class="gloss" id="rev-zh" hidden>' +
        escapeHtml(v.zh || "") +
        '</p><p class="ex" id="rev-gloss" hidden>' +
        escapeHtml(v.gloss || "") +
        '</p><p class="ipa" id="rev-ipa" hidden></p>' +
        '<div class="gate-actions">' +
        '<button type="button" class="ghost" id="rev-reveal">顯示答案</button>' +
        '<button type="button" class="primary" id="rev-know" hidden>記住了</button>' +
        '<button type="button" class="ghost" id="rev-forget" hidden>唔記得</button>' +
        "</div></div>";
      var ipaEl = document.getElementById("rev-ipa");
      if (v.ipa) {
        ipaEl.textContent = v.ipa;
      }
      document.getElementById("rev-reveal").addEventListener("click", function () {
        document.getElementById("rev-zh").hidden = false;
        document.getElementById("rev-gloss").hidden = false;
        if (v.ipa) ipaEl.hidden = false;
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
    var hash = location.hash || "#/";
    var m = hash.match(/^#\/gate\/([\w-]+)/);
    if (m) {
      renderGate(m[1]);
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
