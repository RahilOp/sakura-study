/* Sakura Study — daily MCQ practice
   Static frontend backed by Firebase Auth + Firestore. */

(function () {
  "use strict";

  var SUBJECTS = [window.SUBJECT_SOCIOLOGY, window.SUBJECT_ENGLISH, window.SUBJECT_ECONOMICS, window.SUBJECT_PSYCHOLOGY, window.SUBJECT_VOCATIONAL];
  var DAILY_COUNT = 15;
  var MOCK_COUNT = 75;
  var MOCK_SECONDS = 90 * 60;
  var LOCAL_KEY = "sakura-study-v1";
  var OWNER_KEY = "sakura-study-owner";
  var ADMIN_EMAIL = "rahilrizvi0786110@gmail.com";

  var app = document.getElementById("app");
  var backBtn = document.getElementById("backBtn");
  var streakChip = document.getElementById("streakChip");
  var tabbar = document.getElementById("tabbar");

  /* ---------- Firebase ---------- */

  var fbApp = null;
  var fbAuth = null;
  var fbDb = null;
  var currentUser = null;
  var isAdmin = false;

  function initFirebase() {
    if (!window.FIREBASE_CONFIG || typeof firebase === "undefined") {
      console.warn("Firebase not available. Running in local-only mode.");
      return false;
    }
    fbApp = firebase.initializeApp(window.FIREBASE_CONFIG);
    fbAuth = firebase.auth();
    fbDb = firebase.firestore();
    return true;
  }

  function blank() {
    return { seen: {}, wrong: {}, days: {}, streak: 0, lastDay: null, total: 0, correct: 0 };
  }

  var S = loadLocal();
  var syncTimer = null;

  function loadLocal() {
    try {
      var raw = localStorage.getItem(LOCAL_KEY);
      if (!raw) return blank();
      var p = JSON.parse(raw);
      var b = blank();
      for (var k in b) if (!(k in p)) p[k] = b[k];
      return p;
    } catch (e) {
      return blank();
    }
  }

  function saveLocal() {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(S)); } catch (e) {}
  }

  function markDirty() {
    saveLocal();
    if (!fbDb || !currentUser) return;
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(syncProgress, 1500);
  }

  function syncProgress() {
    if (syncTimer) { clearTimeout(syncTimer); syncTimer = null; }
    if (!fbDb || !currentUser) return Promise.resolve();
    var payload = {
      seen: S.seen,
      wrong: S.wrong,
      days: S.days,
      streak: S.streak,
      lastDay: S.lastDay,
      total: S.total,
      correct: S.correct,
      email: currentUser.email,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    // No merge: a merge would keep map keys we deleted (wrong answers put right, a reset).
    return fbDb.collection("progress").doc(currentUser.uid).set(payload).catch(function (err) {
      console.error("syncProgress failed", err);
    });
  }

  /* Cloud wins unless this device holds newer answers for the same user
     (total only ever grows, so the larger total is the newer copy). */
  function loadProgressFromCloud(uid) {
    var owner = null;
    try { owner = localStorage.getItem(OWNER_KEY); } catch (e) {}
    // Progress from before accounts existed (no owner) belongs to whoever logs in first.
    var localIsMine = !owner || owner === uid;
    if (!localIsMine) S = blank();
    try { localStorage.setItem(OWNER_KEY, uid); } catch (e) {}

    return new Promise(function (resolve) {
      if (!fbDb) { resolve(); return; }
      fbDb.collection("progress").doc(uid).get().then(function (doc) {
        var cloud = doc.exists ? doc.data() : null;
        if (cloud && (cloud.total || 0) >= (S.total || 0)) {
          var b = blank();
          for (var k in b) S[k] = k in cloud ? cloud[k] : b[k];
          saveLocal();
        } else if (S.total) {
          syncProgress();
        }
        resolve();
      }).catch(function () { resolve(); });
    });
  }

  function clearLocalProgress() {
    S = blank();
    try {
      localStorage.removeItem(LOCAL_KEY);
      localStorage.removeItem(OWNER_KEY);
    } catch (e) {}
  }

  function save() { markDirty(); }

  function today() {
    var d = new Date();
    return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
  }

  function yesterday() {
    var y = new Date(); y.setDate(y.getDate() - 1);
    return y.getFullYear() + "-" + (y.getMonth() + 1) + "-" + y.getDate();
  }

  /* The stored streak only counts while it is still unbroken. */
  function liveStreak() {
    return S.lastDay === today() || S.lastDay === yesterday() ? S.streak : 0;
  }

  function markDay() {
    var t = today();
    if (S.lastDay === t) return;
    S.streak = S.lastDay === yesterday() ? S.streak + 1 : 1;
    S.lastDay = t;
    S.days[t] = true;
    save();
  }

  /* ---------- question helpers ---------- */

  function uid(paperId, unitId, i) { return paperId + "/" + unitId + "/" + i; }

  function allQuestions() {
    var out = [];
    SUBJECTS.forEach(function (sub) {
      if (!sub) return;
      sub.papers.forEach(function (p) {
        (p.units || []).forEach(function (u) {
          (u.questions || []).forEach(function (q, i) {
            out.push({ id: uid(p.id, u.id, i), q: q, subject: sub, paper: p, unit: u });
          });
        });
      });
    });
    return out;
  }

  function paperQuestions(paper) {
    var out = [];
    (paper.units || []).forEach(function (u) {
      (u.questions || []).forEach(function (q, i) {
        out.push({ id: uid(paper.id, u.id, i), q: q, paper: paper, unit: u });
      });
    });
    return out;
  }

  function unitQuestions(paper, unit) {
    return (unit.questions || []).map(function (q, i) {
      return { id: uid(paper.id, unit.id, i), q: q, paper: paper, unit: unit };
    });
  }

  function readyCount(sub) {
    var n = 0;
    sub.papers.forEach(function (p) {
      (p.units || []).forEach(function (u) { n += (u.questions || []).length; });
    });
    return n;
  }

  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* Daily set: unseen questions first, then ones she got wrong, then anything. */
  function dailySet() {
    var all = allQuestions();
    if (!all.length) return [];
    var unseen = all.filter(function (x) { return !S.seen[x.id]; });
    var wrong = all.filter(function (x) { return S.wrong[x.id]; });
    var pick = shuffle(unseen).slice(0, DAILY_COUNT);
    if (pick.length < DAILY_COUNT) {
      var have = {}; pick.forEach(function (x) { have[x.id] = 1; });
      shuffle(wrong).forEach(function (x) {
        if (pick.length < DAILY_COUNT && !have[x.id]) { pick.push(x); have[x.id] = 1; }
      });
      shuffle(all).forEach(function (x) {
        if (pick.length < DAILY_COUNT && !have[x.id]) { pick.push(x); have[x.id] = 1; }
      });
    }
    return pick;
  }

  function wrongSet() {
    return allQuestions().filter(function (x) { return S.wrong[x.id]; });
  }

  /* Count only ids that still exist, so edited data can't skew the numbers. */
  function seenCount(list) {
    return list.filter(function (x) { return S.seen[x.id]; }).length;
  }

  /* ---------- view helpers ---------- */

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }



  function el(html) {
    var d = document.createElement("div");
    d.innerHTML = html.trim();
    return d.firstChild;
  }

  function render(html) {
    app.innerHTML = html;
    window.scrollTo(0, 0);
  }

  var stack = [];
  var quizTimer = null; // mock-exam countdown; must stop when the quiz screen is left

  function stopQuizTimer() {
    if (quizTimer) { clearInterval(quizTimer); quizTimer = null; }
  }

  // Bumped on every navigation so late async results don't overwrite a newer screen.
  var navId = 0;

  function go(fn, push) {
    stopQuizTimer();
    navId++;
    if (push !== false) stack.push(fn);
    fn();
    backBtn.hidden = stack.length <= 1;
    updateStreak();
  }

  backBtn.addEventListener("click", function () {
    stopQuizTimer();
    navId++;
    stack.pop();
    var prev = stack[stack.length - 1];
    if (prev) { prev(); backBtn.hidden = stack.length <= 1; updateStreak(); }
  });

  function setChrome(show) {
    tabbar.hidden = !show;
    if (!show) { backBtn.hidden = true; streakChip.hidden = true; }
  }

  function updateStreak() {
    var n = liveStreak();
    if (n > 0 && !tabbar.hidden) {
      streakChip.hidden = false;
      streakChip.textContent = n + (n === 1 ? " day" : " days") + " running";
    } else {
      streakChip.hidden = true;
    }
  }

  /* ---------- screens ---------- */

  function screenHome() {
    var all = allQuestions();
    var seenN = seenCount(all);
    var wrongN = wrongSet().length;
    var doneToday = S.days[today()];

    var html = '<section class="today">' +
      '<h1>' + (doneToday ? "Practice done for today" : "Today's practice") + "</h1>" +
      '<p class="lede">' +
      (all.length
        ? (doneToday
            ? "You can keep going if you want more, or come back tomorrow."
            : DAILY_COUNT + " questions, drawn from what you haven't seen yet. About ten minutes.")
        : "No questions loaded yet. Add them in the data folder to get started.") +
      "</p>" +
      '<div class="todaymeta">' +
        '<div><span class="n">' + seenN + "</span><span class=\"k\">questions seen</span></div>" +
        '<div><span class="n">' + (all.length - seenN) + "</span><span class=\"k\">still new</span></div>" +
        '<div><span class="n">' + wrongN + "</span><span class=\"k\">to revisit</span></div>" +
      "</div>" +
      '<button class="primary" id="startDaily"' + (all.length ? "" : " disabled") + ">" +
        (doneToday ? "Practise again" : "Start today's practice") + "</button>" +
      (wrongN ? '<button class="ghost" id="startWrong">Review the ' + wrongN + " you got wrong</button>" : "") +
      "</section>";

    if (fbDb) {
      html += '<div class="card grammarcard">' +
        '<h3>English Grammar Daily</h3>' +
        '<p class="lede">20 ICSE-style MCQs: tenses, prepositions, active-passive, direct-indirect and more.</p>' +
        '<button class="primary" id="startGrammar">Start today\'s grammar exercise</button>' +
        '<button class="ghost" id="pastGrammar">Past grammar exercises</button>' +
        '</div>';
    }

    html += '<h2 class="sectiontitle">Subjects</h2>';
    SUBJECTS.forEach(function (sub) {
      if (!sub) return;
      var n = readyCount(sub);
      html += '<button class="rowlink" data-sub="' + sub.id + '">' +
        '<span class="semtag">' + esc(sub.name.slice(0, 3)) + "</span>" +
        '<span class="body"><span class="title">' + esc(sub.name) + "</span>" +
        '<span class="sub">' + (n ? n + " questions ready" : "Notes / resources only") + "</span></span>" +
        '<span class="chev">&#8250;</span></button>';
    });

    if (isAdmin) {
      html += '<button class="ghost" id="adminBtn" style="margin-top:18px">Admin dashboard</button>';
    }

    if (currentUser) {
      html += '<div class="account"><span>Signed in as ' + esc(currentUser.email || "") + '</span>' +
        '<button class="linkbtn" id="logoutBtn">Log out</button></div>';
    }

    render(html);

    var b = document.getElementById("startDaily");
    if (b) b.onclick = function () { var set = dailySet(); if (set.length) go(function () { screenQuiz(set, "Today's practice"); }); };
    var w = document.getElementById("startWrong");
    if (w) w.onclick = function () { var set = shuffle(wrongSet()); if (set.length) go(function () { screenQuiz(set, "Review"); }); };
    var g = document.getElementById("startGrammar");
    if (g) g.onclick = function () { go(screenGrammarToday); };
    var p = document.getElementById("pastGrammar");
    if (p) p.onclick = function () { go(screenGrammarPast); };
    var admin = document.getElementById("adminBtn");
    if (admin) admin.onclick = function () { go(screenAdmin); };
    var logout = document.getElementById("logoutBtn");
    if (logout) logout.onclick = function () {
      if (!confirm("Log out of Sakura Study?")) return;
      logout.disabled = true;
      // Flush pending answers first, then wipe this device so the next account starts clean.
      // onAuthStateChanged shows the login screen.
      syncProgress().then(function () {
        clearLocalProgress();
        return fbAuth.signOut();
      });
    };

    app.querySelectorAll("[data-sub]").forEach(function (btn) {
      btn.onclick = function () {
        var sub = SUBJECTS.filter(function (s) { return s && s.id === btn.dataset.sub; })[0];
        go(function () { screenSubject(sub); });
      };
    });
  }

  function screenCourse() {
    var html = "<h1>Course</h1><p class=\"lede\">Every paper, in semester order. Work through them from the top.</p>";
    var sems = [];
    SUBJECTS.forEach(function (sub) {
      if (!sub) return;
      sub.papers.forEach(function (p) { if (sems.indexOf(p.semester) < 0) sems.push(p.semester); });
    });
    sems.sort(function (a, b) { return a - b; });
    sems.forEach(function (sem) {
      var rows = "";
      SUBJECTS.forEach(function (sub) {
        if (!sub) return;
        sub.papers.filter(function (p) { return p.semester === sem; }).forEach(function (p) {
          rows += paperRow(p, sem, esc(sub.name) + " &middot; ");
        });
      });
      if (rows) html += '<h2 class="sectiontitle">Semester ' + sem + "</h2>" + rows;
    });
    render(html);
    bindPaperRows();
  }

  function screenSubject(sub) {
    var html = "<h1>" + esc(sub.name) + "</h1><p class=\"lede\">Papers in semester order.</p>";
    sub.papers.slice().sort(function (a, b) { return a.semester - b.semester; }).forEach(function (p) {
      html += paperRow(p, p.semester, "");
    });
    render(html);
    bindPaperRows();
  }

  /* One paper row with a coverage bar. Papers with nothing to open are disabled. */
  function paperRow(p, sem, prefix) {
    var qs = paperQuestions(p);
    var n = qs.length;
    var hasContent = n > 0 || (p.units || []).length > 0 || p.source;
    var sub = n ? n + " questions" : (p.units || []).length ? "Study notes only" : "Not added yet";
    return '<button class="rowlink" data-paper="' + p.id + '"' + (hasContent ? "" : " disabled") + ">" +
      '<span class="semtag">' + sem + "</span>" +
      '<span class="body"><span class="title">' + esc(p.name) + "</span>" +
      '<span class="sub">' + prefix + sub + "</span>" +
      (n ? '<span class="bar"><i style="width:' + Math.round(seenCount(qs) / n * 100) + '%"></i></span>' : "") +
      "</span>" +
      '<span class="chev">&#8250;</span></button>';
  }

  function findPaper(id) {
    var found = null;
    SUBJECTS.forEach(function (sub) {
      if (!sub) return;
      sub.papers.forEach(function (p) { if (p.id === id) found = p; });
    });
    return found;
  }

  function bindPaperRows() {
    app.querySelectorAll("[data-paper]").forEach(function (btn) {
      btn.onclick = function () {
        var p = findPaper(btn.dataset.paper);
        if (p) go(function () { screenPaper(p); });
      };
    });
  }

  function screenStudy(unit, paper) {
    var notePath = "notes/" + paper.id + "/" + unit.id + ".html";
    var html = "<h1>" + esc(unit.name) + "</h1>" +
      '<p class="lede">' + esc(unit.blurb || "") + "</p>" +
      '<div class="card" id="notesCard"><h3>Notes</h3>' +
      '<div class="empty">Loading notes…</div></div>';

    if (unit.resources && unit.resources.length) {
      html += '<div class="card"><h3>Resources</h3><ul class="reslist">';
      unit.resources.forEach(function (r) {
        html += '<li><a href="' + esc(r.url) + '" target="_blank" rel="noopener">' + esc(r.title) + "</a></li>";
      });
      html += "</ul></div>";
    }

    var unitQs = unitQuestions(paper, unit);
    if (unitQs.length) html += '<button class="primary" id="studyStart">Practise this unit &middot; ' + unitQs.length + " questions</button>";
    render(html);

    var notesCard = document.getElementById("notesCard");
    var nav = navId;
    fetch(notePath)
      .then(function (r) { return r.ok ? r.text() : Promise.reject(r.status); })
      .then(function (text) {
        if (nav !== navId) return;
        var rawPages = text.split(/<hr\s+class="page-break"\s*\/?>/i);
        var pages = rawPages.map(function (p) { return p.trim(); }).filter(function (p) { return p; });
        if (pages.length === 0) pages = [text.trim()];
        var pageIndex = 0;

        function showPage() {
          notesCard.innerHTML = '<h3>Notes <span class="pagecount">' + (pageIndex + 1) + " / " + pages.length + "</span></h3>" +
            '<div class="pageview" id="pageView">' + pages[pageIndex] + "</div>" +
            '<div class="pagenav">' +
            '<button class="ghost" id="pagePrev" aria-label="Previous page">&#8249;</button>' +
            '<div class="pagedots" id="pageDots"></div>' +
            '<button class="ghost" id="pageNext" aria-label="Next page">&#8250;</button>' +
            "</div>";
          document.getElementById("pagePrev").disabled = pageIndex === 0;
          document.getElementById("pageNext").disabled = pageIndex === pages.length - 1;
          bindPage();
        }

        function bindPage() {
          var prev = document.getElementById("pagePrev");
          var next = document.getElementById("pageNext");
          var view = document.getElementById("pageView");
          var dots = document.getElementById("pageDots");
          if (prev) prev.onclick = function () { if (pageIndex > 0) { pageIndex--; turnPage(); } };
          if (next) next.onclick = function () { if (pageIndex < pages.length - 1) { pageIndex++; turnPage(); } };
          if (dots) {
            dots.innerHTML = "";
            pages.forEach(function (_, n) {
              var d = document.createElement("button");
              d.className = "pagedot" + (n === pageIndex ? " active" : "");
              d.setAttribute("aria-label", "Page " + (n + 1));
              d.onclick = function () { pageIndex = n; turnPage(); };
              dots.appendChild(d);
            });
          }
          if (view) {
            var startX = null, startY = null;
            view.addEventListener("touchstart", function (e) {
              startX = e.changedTouches[0].screenX; startY = e.changedTouches[0].screenY;
            }, { passive: true });
            view.addEventListener("touchend", function (e) {
              if (startX === null) return;
              var dx = e.changedTouches[0].screenX - startX;
              var dy = e.changedTouches[0].screenY - startY;
              startX = null;
              // Ignore vertical scrolls and sideways scrolls of wide tables.
              if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
              if (e.target.closest && e.target.closest(".table-wrap")) return;
              if (dx < 0 && pageIndex < pages.length - 1) { pageIndex++; turnPage(); }
              if (dx > 0 && pageIndex > 0) { pageIndex--; turnPage(); }
            }, { passive: true });
          }
        }

        // Bring the top of the new page into view instead of leaving her at the bottom.
        function turnPage() {
          showPage();
          var top = notesCard.getBoundingClientRect().top;
          if (top < 0) window.scrollBy(0, top - 70);
        }

        showPage();
      })
      .catch(function () {
        if (nav !== navId) return;
        notesCard.innerHTML = '<h3>Notes</h3><div class="empty">Notes not available for this unit yet.</div>';
      });

    var start = document.getElementById("studyStart");
    if (start) start.onclick = function () {
      go(function () { screenQuiz(shuffle(unitQs), unit.name); });
    };
  }

  function screenPaper(paper) {
    var qs = paperQuestions(paper);
    var html = "<h1>" + esc(paper.name) + "</h1>" +
      '<p class="lede">Semester ' + paper.semester + (paper.note ? " &middot; " + esc(paper.note) : "") + "</p>";

    var mockN = Math.min(MOCK_COUNT, qs.length);

    if (qs.length) {
      html += '<div class="card" style="margin-top:18px">' +
        "<h3>Practise the whole paper</h3>" +
        '<p class="lede">' + qs.length + " questions, shuffled. " + seenCount(qs) + " seen so far.</p>" +
        '<button class="primary" id="wholePaper" style="margin-top:14px">Start</button>' +
        '<button class="ghost" id="mockExam">Mock exam &middot; ' + mockN + " questions, 90 minutes</button>" +
        "</div>";
    } else {
      html += '<div class="card" style="margin-top:18px"><div class="empty">MCQs for this paper haven\'t been added yet.' +
        ((paper.units || []).length ? " Read the unit notes below in the meantime." : "") +
        (paper.source ? '<br><br><a href="' + esc(paper.source) + '" target="_blank" rel="noopener">Open the source</a>' : "") +
        "</div></div>";
    }

    if (paper.units && paper.units.length) {
      html += '<h2 class="sectiontitle">Units</h2>';
      paper.units.forEach(function (u) {
        var uqs = unitQuestions(paper, u);
        var n = uqs.length;
        // A notes-only unit opens its notes directly instead of sitting there disabled.
        html += '<button class="rowlink" ' + (n ? 'data-unit="' : 'data-study="') + esc(u.id) + '">' +
          '<span class="body"><span class="title">' + esc(u.name) + "</span>" +
          '<span class="sub">' + esc(u.blurb || "") + "</span>" +
          (n ? '<span class="sub unitcount">' + seenCount(uqs) + " of " + n + " seen</span>" +
               '<span class="bar"><i style="width:' + Math.round(seenCount(uqs) / n * 100) + '%"></i></span>'
             : '<span class="sub unitcount">Study notes</span>') +
          "</span>" +
          '<span class="chev">&#8250;</span></button>';
        if (n) html += '<div class="study-bar"><button class="linkbtn study-btn" data-study="' + esc(u.id) + '">Study notes</button></div>';
      });
    }

    render(html);

    var whole = document.getElementById("wholePaper");
    if (whole) whole.onclick = function () { go(function () { screenQuiz(shuffle(qs), paper.name); }); };
    var mock = document.getElementById("mockExam");
    if (mock) mock.onclick = function () {
      if (!confirm("Start a " + mockN + "-question mock exam? The 90-minute timer starts now and the exam ends when time is up.")) return;
      go(function () { screenQuiz(shuffle(qs).slice(0, mockN), paper.name + " · mock", MOCK_SECONDS); });
    };
    app.querySelectorAll("[data-unit]").forEach(function (btn) {
      btn.onclick = function () {
        var u = paper.units.filter(function (x) { return x.id === btn.dataset.unit; })[0];
        go(function () { screenQuiz(shuffle(unitQuestions(paper, u)), u.name); });
      };
    });
    app.querySelectorAll("[data-study]").forEach(function (btn) {
      btn.onclick = function (e) {
        e.stopPropagation();
        var u = paper.units.filter(function (x) { return x.id === btn.dataset.study; })[0];
        go(function () { screenStudy(u, paper); });
      };
    });
  }

  function screenReview() {
    var set = wrongSet();
    var html = "<h1>Review</h1><p class=\"lede\">Questions you've answered wrong at least once. They leave this list once you get them right.</p>";
    if (!set.length) {
      html += '<div class="card" style="margin-top:18px"><div class="empty">Nothing to review. Answer some questions first, and anything you miss will collect here.</div></div>';
      render(html);
      return;
    }
    html += '<div class="card" style="margin-top:18px"><h3>' + set.length + " to revisit</h3>" +
      '<p class="lede">This is the highest-value practice there is. Do these before anything new.</p>' +
      '<button class="primary" id="doReview" style="margin-top:14px">Start review</button></div>';
    render(html);
    document.getElementById("doReview").onclick = function () {
      go(function () { screenQuiz(shuffle(set), "Review"); });
    };
  }

  function screenProgress() {
    var all = allQuestions();
    var seenN = seenCount(all);
    var wrongN = wrongSet().length;
    var acc = S.total ? Math.round(S.correct / S.total * 100) : 0;
    var days = Object.keys(S.days).length;

    var html = "<h1>Progress</h1><p class=\"lede\">Accuracy is the number that matters. Aim to hold it above 70 per cent.</p>" +
      '<div class="card statcard" style="margin-top:18px"><div class="todaymeta">' +
      '<div><span class="n">' + acc + '%</span><span class="k">accuracy</span></div>' +
      '<div><span class="n">' + seenN + "/" + all.length + '</span><span class="k">coverage</span></div>' +
      '<div><span class="n">' + days + '</span><span class="k">days practised</span></div>' +
      '<div><span class="n">' + wrongN + '</span><span class="k">to revisit</span></div>' +
      '<div><span class="n">' + liveStreak() + '</span><span class="k">day streak</span></div>' +
      "</div></div>";

    html += '<h2 class="sectiontitle">By paper</h2>';
    SUBJECTS.forEach(function (sub) {
      if (!sub) return;
      sub.papers.forEach(function (p) {
        var qs = paperQuestions(p);
        if (!qs.length) return;
        var done = seenCount(qs);
        html += '<div class="card"><h3>' + esc(p.name) + "</h3>" +
          '<p class="lede">' + esc(sub.name) + " &middot; Semester " + p.semester + " &middot; " + done + " of " + qs.length + " seen</p>" +
          '<span class="bar"><i style="width:' + Math.round(done / qs.length * 100) + '%"></i></span></div>';
      });
    });

    html += '<button class="ghost danger" id="resetAll" style="margin-top:20px">Reset all progress</button>';
    render(html);
    document.getElementById("resetAll").onclick = function () {
      if (confirm("This clears every answer and your streak" + (currentUser ? ", on this device and in the cloud" : "") + ". Continue?")) {
        S = blank(); saveLocal(); syncProgress(); updateStreak(); screenProgress();
      }
    };
  }

  /* ---------- quiz engine ---------- */

  function screenQuiz(items, title, seconds) {
    if (!items.length) {
      render('<div class="card"><div class="empty">There are no questions here yet.</div></div>');
      return;
    }
    var i = 0, score = 0, timeLeft = seconds || 0;
    var answers = new Array(items.length).fill(null);
    var corrects = new Array(items.length).fill(null);

    function answeredCount() {
      return answers.filter(function (a) { return a !== null; }).length;
    }

    function clock() {
      return Math.floor(timeLeft / 60) + ":" + ("0" + (timeLeft % 60)).slice(-2);
    }

    function finish() {
      stopQuizTimer();
      if (answeredCount()) markDay();
      var pct = Math.round(score / items.length * 100);
      var skipped = items.length - answeredCount();
      var msg = pct >= 85 ? "Strong. This is the level that earns a good grade."
              : pct >= 70 ? "Solid. Keep the wrong ones in review and go again."
              : pct >= 45 ? "Getting there. Work through the wrong answers before new material."
              : "Early days. Read the unit notes, then come back to these.";
      render('<div class="result"><div class="score">' + score + "</div>" +
        '<div class="of">out of ' + items.length + " &middot; " + pct + "%" +
        (skipped ? " &middot; " + skipped + " not answered" : "") + "</div>" +
        (seconds && timeLeft <= 0 ? '<p class="lede">Time is up.</p>' : "") +
        "<h2>" + msg + "</h2></div>" +
        '<button class="primary" id="againBtn" style="margin-top:24px">Practise again</button>' +
        '<button class="ghost" id="homeBtn">Back to today</button>');
      document.getElementById("againBtn").onclick = function () { screenQuiz(shuffle(items), title, seconds); };
      document.getElementById("homeBtn").onclick = function () { stack = []; go(screenHome); setTab("home"); };
    }

    function tryFinish() {
      var left = items.length - answeredCount();
      if (left && !confirm(left + (left === 1 ? " question is" : " questions are") + " not answered yet. Finish anyway?")) return;
      finish();
    }

    function goNext() {
      if (i >= items.length - 1) { tryFinish(); return; }
      i++; draw();
    }

    function goPrev() {
      if (i > 0) { i--; draw(); }
    }

    function gridHtml() {
      var html = '<div class="qgrid-title">Questions</div><div class="qgrid-btns">';
      items.forEach(function (it, idx) {
        html += '<button class="qgrid-btn" data-j="' + idx + '">' + (idx + 1) + "</button>";
      });
      html += '</div><button class="ghost" id="gridFinish" style="margin-top:12px">Finish</button>';
      return html;
    }

    function updateGrid() {
      app.querySelectorAll(".qgrid-btn").forEach(function (btn) {
        var j = parseInt(btn.dataset.j, 10);
        btn.className = "qgrid-btn";
        if (j === i) btn.classList.add("current");
        if (answers[j] !== null) btn.classList.add(corrects[j] ? "grid-ok" : "grid-no");
      });
    }

    function afterHtml(answered, n, ok, q) {
      var html = '<p class="verdict ' + (ok ? "ok" : "no") + '">' +
        (ok ? "Correct." : "Not this time.") + "</p>" +
        (ok ? "" : "<p>The answer is " + "ABCD"[q.a] + ": " + esc(q.o[q.a]) + ". This one goes to your review list.</p>") +
        navHtml();
      return html;
    }

    function navHtml() {
      var nextLabel = i === items.length - 1 ? "See result" : "Next question";
      return '<div class="quiz-nav">' +
        (i > 0 ? '<button class="ghost" id="prevBtn">Previous</button>' : "") +
        '<button class="primary" id="nextBtn">' + nextLabel + "</button>" +
        "</div>";
    }

    function bindMain(ok, n, it) {
      app.querySelectorAll(".opt").forEach(function (btn) {
        var bn = parseInt(btn.dataset.n, 10);
        if (answers[i] !== null) {
          btn.disabled = true;
          if (bn === it.q.a) btn.classList.add("correct");
          else if (bn === answers[i]) btn.classList.add("wrong");
        } else {
          btn.onclick = function () { choose(parseInt(btn.dataset.n, 10), it); };
        }
      });

      var next = document.getElementById("nextBtn");
      if (next) next.onclick = goNext;
      var prev = document.getElementById("prevBtn");
      if (prev) prev.onclick = goPrev;

      app.querySelectorAll(".qgrid-btn").forEach(function (btn) {
        btn.onclick = function () {
          i = parseInt(btn.dataset.j, 10);
          draw();
        };
      });
      var fin = document.getElementById("gridFinish");
      if (fin) fin.onclick = tryFinish;

      if (answers[i] !== null) {
        var after = document.getElementById("after");
        if (after) {
          after.innerHTML = afterHtml(true, answers[i], corrects[i], it.q);
          var next2 = document.getElementById("nextBtn");
          if (next2) next2.onclick = goNext;
          var prev2 = document.getElementById("prevBtn");
          if (prev2) prev2.onclick = goPrev;
        }
      }
      updateGrid();
    }

    function draw() {
      if (i >= items.length) return finish();
      var it = items[i];
      var q = it.q;
      var answered = answers[i] !== null;

      var head = (i + 1) + " of " + items.length;
      var right = seconds
        ? '<span class="qclock' + (timeLeft < 300 ? " low" : "") + '">' + clock() + "</span>"
        : "<span>" + esc(title) + "</span>";

      var main = '<div class="qhead"><span>' + head + "</span>" + right + "</div>" +
        '<span class="bar"><i style="width:' + Math.round(answeredCount() / items.length * 100) + '%"></i></span>' +
        '<p class="qtext">' + esc(q.q) + "</p>" +
        '<div id="opts">';
      q.o.forEach(function (o, n) {
        main += '<button class="opt" data-n="' + n + '"><span class="letter">' +
          "ABCD"[n] + '</span>' + esc(o) + "</button>";
      });
      main += '</div><div id="after">' + navHtml() + "</div>";

      render('<div class="quiz-layout"><div class="quiz-main">' + main + '</div>' +
        '<div class="quiz-grid">' + gridHtml() + "</div></div>");

      bindMain(answered, answers[i], it);
    }

    function choose(n, it) {
      if (answers[i] !== null) return;
      var q = it.q;
      var ok = n === q.a;
      answers[i] = n;
      corrects[i] = ok;

      S.seen[it.id] = 1;
      S.total++;
      if (ok) { score++; S.correct++; delete S.wrong[it.id]; }
      else { S.wrong[it.id] = 1; }
      save();

      app.querySelectorAll(".opt").forEach(function (btn) {
        var bn = parseInt(btn.dataset.n, 10);
        btn.disabled = true;
        if (bn === q.a) btn.classList.add("correct");
        else if (bn === n) btn.classList.add("wrong");
      });

      var after = document.getElementById("after");
      after.innerHTML = afterHtml(true, n, ok, q);
      var next = document.getElementById("nextBtn");
      if (next) next.onclick = goNext;
      var prev = document.getElementById("prevBtn");
      if (prev) prev.onclick = goPrev;
      if (next) next.focus({ preventScroll: true });
      var bar = app.querySelector(".quiz-main .bar i");
      if (bar) bar.style.width = Math.round(answeredCount() / items.length * 100) + "%";
      updateGrid();
    }

    stopQuizTimer();
    if (seconds) {
      quizTimer = setInterval(function () {
        timeLeft--;
        if (timeLeft <= 0) { timeLeft = 0; finish(); return; }
        var h = app.querySelector(".qclock");
        if (h) { h.textContent = clock(); h.classList.toggle("low", timeLeft < 300); }
      }, 1000);
    }

    draw();
  }

  /* ---------- grammar ---------- */

  function grammarDateString(d) {
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  }

  function screenLogin() {
    stack = [];
    setChrome(false);
    render('<div class="card login-card"><div class="mark" style="font-size:2.6rem;margin-bottom:6px" aria-hidden="true">&#10047;</div>' +
      '<h2>Welcome to Sakura Study</h2>' +
      '<p class="lede">Log in to keep your practice in sync.</p>' +
      '<input type="email" id="loginEmail" class="field" placeholder="Email" autocomplete="email" aria-label="Email">' +
      '<input type="password" id="loginPass" class="field" placeholder="Password" autocomplete="current-password" aria-label="Password">' +
      '<button class="primary" id="loginBtn">Log in</button>' +
      '<div id="loginErr" class="login-error" role="alert"></div></div>');
    var emailEl = document.getElementById("loginEmail");
    var passEl = document.getElementById("loginPass");
    var btn = document.getElementById("loginBtn");
    var errEl = document.getElementById("loginErr");
    function doLogin() {
      var email = emailEl.value.trim();
      var pass = passEl.value;
      if (!email || !pass) { errEl.textContent = "Enter your email and password."; return; }
      errEl.textContent = "";
      btn.disabled = true;
      btn.textContent = "Logging in…";
      fbAuth.signInWithEmailAndPassword(email, pass).catch(function (err) {
        btn.disabled = false;
        btn.textContent = "Log in";
        errEl.textContent = loginMessage(err);
      });
    }
    btn.onclick = doLogin;
    passEl.onkeydown = function (e) { if (e.key === "Enter") doLogin(); };
    emailEl.onkeydown = function (e) { if (e.key === "Enter") passEl.focus(); };
  }

  function loginMessage(err) {
    var code = (err && err.code) || "";
    if (code === "auth/invalid-email") return "That email address doesn't look right.";
    if (code === "auth/network-request-failed") return "No connection. Check your internet and try again.";
    if (code === "auth/too-many-requests") return "Too many attempts. Wait a few minutes and try again.";
    if (/auth\/(invalid-credential|invalid-login-credentials|wrong-password|user-not-found)/.test(code)) return "Email or password is incorrect.";
    return (err && err.message) || "Could not log in.";
  }

  function screenGrammarToday() {
    screenGrammarExercise("grammar-" + grammarDateString(new Date()), true);
  }

  function screenGrammarExercise(id, isToday) {
    if (!fbDb) {
      render('<div class="card"><div class="empty">Grammar exercises need Firebase. Please check that firebase-config.js is present.</div></div>');
      return;
    }
    var nav = navId;
    render('<div class="card"><div class="empty">Loading the grammar exercise…</div></div>');
    fbDb.collection("grammar_exercises").doc(id).get().then(function (doc) {
      if (nav !== navId) return;
      var ex = doc.exists ? doc.data() : null;
      if (!ex || !(ex.questions || []).length) {
        render('<div class="card"><div class="empty">' +
          (isToday ? "Today's exercise is not ready yet. It is generated daily at 5 AM IST." : "This exercise could not be found.") +
          "</div></div>");
        return;
      }
      var items = ex.questions.map(function (q, i) { return { id: id + "/" + i, q: q }; });
      screenQuizGrammar(items, ex.title || id, ex.id || id, ex.date || id.replace("grammar-", ""));
    }).catch(function (err) {
      if (nav !== navId) return;
      console.error("grammar load error", err);
      render('<div class="card"><div class="empty">Could not load the exercise. Please check your connection.</div></div>');
    });
  }

  function screenGrammarPast() {
    var head = '<h1>Past Grammar Exercises</h1><p class="lede">Pick any day to re-attempt.</p>';
    if (!fbDb) {
      render(head + '<div class="card"><div class="empty">Grammar exercises need Firebase. Please check that firebase-config.js is present.</div></div>');
      return;
    }
    var nav = navId;
    render(head + '<div class="card"><div class="empty">Loading…</div></div>');
    Promise.all([
      fbDb.collection("grammar_exercises").orderBy("date", "desc").get(),
      myGrammarBest()
    ]).then(function (results) {
      if (nav !== navId) return;
      var snap = results[0], best = results[1];
      var html = "";
      if (snap.empty) {
        html += '<div class="card"><div class="empty">No past exercises yet.</div></div>';
      } else {
        snap.forEach(function (doc) {
          var ex = doc.data();
          var b = best[doc.id];
          html += '<button class="rowlink" data-gid="' + esc(doc.id) + '">' +
            '<span class="semtag">' + esc(shortDate(ex.date)) + "</span>" +
            '<span class="body"><span class="title">' + esc(ex.title || doc.id) + "</span>" +
            '<span class="sub">' + (ex.questions || []).length + " questions" +
            (b ? " &middot; best " + b.score + "/" + b.total : " &middot; not attempted") + "</span></span>" +
            '<span class="chev">&#8250;</span></button>';
        });
      }
      render(head + html);
      app.querySelectorAll("[data-gid]").forEach(function (btn) {
        btn.onclick = function () {
          var gid = btn.dataset.gid;
          go(function () { screenGrammarExercise(gid, false); });
        };
      });
    }).catch(function (err) {
      if (nav !== navId) return;
      console.error("grammar past error", err);
      render(head + '<div class="card"><div class="empty">Could not load past exercises. Please check your connection.</div></div>');
    });
  }

  /* Best score per exercise for the signed-in user; empty if it can't be read. */
  function myGrammarBest() {
    if (!currentUser) return Promise.resolve({});
    return fbDb.collection("grammar_attempts").where("userId", "==", currentUser.uid).get().then(function (snap) {
      var best = {};
      snap.forEach(function (doc) {
        var a = doc.data();
        if (!best[a.exerciseId] || a.score > best[a.exerciseId].score) best[a.exerciseId] = a;
      });
      return best;
    }).catch(function () { return {}; });
  }

  function shortDate(dateStr) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || "");
    if (!m) return "";
    return parseInt(m[3], 10) + " " + "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ")[parseInt(m[2], 10) - 1];
  }

  function screenQuizGrammar(items, title, exerciseId, exerciseDate) {
    var i = 0, score = 0;
    var answers = new Array(items.length).fill(null);

    function recordAttempt() {
      if (!fbDb || !currentUser) return;
      var pct = Math.round(score / items.length * 100);
      fbDb.collection("grammar_attempts").add({
        userId: currentUser.uid,
        email: currentUser.email || "",
        exerciseId: exerciseId,
        date: exerciseDate,
        score: score,
        total: items.length,
        percentage: pct,
        answeredAt: firebase.firestore.FieldValue.serverTimestamp()
      }).catch(function (err) { console.error("recordAttempt failed", err); });
    }

    function finish() {
      recordAttempt();
      var pct = Math.round(score / items.length * 100);
      render('<div class="result"><div class="score">' + score + "</div>" +
        '<div class="of">out of ' + items.length + " &middot; " + pct + "%</div>" +
        "<h2>" + (pct >= 80 ? "Excellent work." : pct >= 60 ? "Good effort." : "Keep practising.") + "</h2></div>" +
        '<button class="primary" id="againBtn" style="margin-top:24px">Try again</button>' +
        '<button class="ghost" id="homeBtn">Back to today</button>');
      document.getElementById("againBtn").onclick = function () { screenQuizGrammar(items, title, exerciseId, exerciseDate); };
      document.getElementById("homeBtn").onclick = function () { stack = []; go(screenHome); setTab("home"); };
    }

    function draw() {
      if (i >= items.length) return finish();
      var q = items[i].q;
      var answered = answers[i] !== null;
      var html = '<div class="qhead"><span>' + (i + 1) + " of " + items.length + "</span><span>" + esc(title) + "</span></div>" +
        '<span class="bar"><i style="width:' + Math.round(i / items.length * 100) + '%"></i></span>' +
        (q.topic ? '<p class="qtopic">' + esc(q.topic) + "</p>" : "") +
        '<p class="qtext">' + esc(q.q) + "</p>" +
        '<div id="opts">';
      q.o.forEach(function (o, n) {
        html += '<button class="opt" data-n="' + n + '"><span class="letter">' + "ABCD"[n] + "</span>" + esc(o) + "</button>";
      });
      html += '</div><div id="after"></div>';
      render(html);
      if (answered) showAnswer(q, answers[i]);

      app.querySelectorAll(".opt").forEach(function (btn) {
        btn.onclick = function () {
          if (answers[i] !== null) return;
          var n = parseInt(btn.dataset.n, 10);
          answers[i] = n;
          if (n === q.a) score++;
          showAnswer(q, n);
          document.getElementById("nextBtn").focus({ preventScroll: true });
        };
      });
    }

    function showAnswer(q, n) {
      var ok = n === q.a;
      app.querySelectorAll(".opt").forEach(function (b) {
        var bn = parseInt(b.dataset.n, 10);
        b.disabled = true;
        if (bn === q.a) b.classList.add("correct");
        else if (bn === n) b.classList.add("wrong");
      });
      document.getElementById("after").innerHTML = '<p class="verdict ' + (ok ? "ok" : "no") + '">' +
        (ok ? "Correct." : "Not this time.") + "</p>" +
        (ok ? "" : "<p>The answer is " + "ABCD"[q.a] + ": " + esc(q.o[q.a]) + ".</p>") +
        '<div class="quiz-nav">' +
        (i > 0 ? '<button class="ghost" id="prevBtn">Previous</button>' : "") +
        '<button class="primary" id="nextBtn">' + (i === items.length - 1 ? "See result" : "Next question") + "</button></div>";
      document.getElementById("nextBtn").onclick = function () { i++; draw(); };
      var prev = document.getElementById("prevBtn");
      if (prev) prev.onclick = function () { i--; draw(); };
    }

    draw();
  }

  function screenAdmin() {
    if (!isAdmin || !fbDb) { go(screenHome); return; }
    var head = '<h1>Admin Dashboard</h1><p class="lede">Track Sugra\'s progress.</p>';
    var nav = navId;
    render(head + '<div class="card"><div class="empty">Loading…</div></div>');

    Promise.all([
      fbDb.collection("progress").get(),
      fbDb.collection("grammar_attempts").orderBy("answeredAt", "desc").limit(100).get()
    ]).then(function (results) {
      if (nav !== navId) return;
      var progressSnap = results[0];
      var attemptsSnap = results[1];
      var emails = {};

      var html = head + '<h2 class="sectiontitle">Subject Progress</h2>';
      if (progressSnap.empty) html += '<div class="card"><div class="empty">No one has practised yet.</div></div>';
      progressSnap.forEach(function (doc) {
        var data = doc.data();
        if (data.email) emails[doc.id] = data.email;
        var acc = data.total ? Math.round(data.correct / data.total * 100) : 0;
        var seen = Object.keys(data.seen || {}).length;
        var wrong = Object.keys(data.wrong || {}).length;
        var days = Object.keys(data.days || {}).length;
        html += '<div class="card statcard"><h3>' + esc(data.email || doc.id) + "</h3>" +
          '<p class="lede">Last practised ' + esc(data.lastDay || "never") + " &middot; " + (data.total || 0) + " answers</p>" +
          '<div class="todaymeta">' +
          '<div><span class="n">' + acc + '%</span><span class="k">accuracy</span></div>' +
          '<div><span class="n">' + seen + "</span><span class=\"k\">seen</span></div>" +
          '<div><span class="n">' + wrong + "</span><span class=\"k\">to revisit</span></div>" +
          '<div><span class="n">' + days + "</span><span class=\"k\">days</span></div>" +
          "</div></div>";
      });

      html += '<h2 class="sectiontitle">Grammar Attempts</h2>';
      if (attemptsSnap.empty) {
        html += '<div class="card"><div class="empty">No grammar attempts yet.</div></div>';
      } else {
        attemptsSnap.forEach(function (doc) {
          var a = doc.data();
          var who = a.email || emails[a.userId] || a.userId || "Unknown user";
          var when = a.answeredAt && a.answeredAt.toDate ? a.answeredAt.toDate().toLocaleString() : "";
          html += '<div class="rowlink static"><span class="semtag">' + esc(a.percentage) + "%</span>" +
            '<span class="body"><span class="title">' + esc(a.date || "Unknown date") + " &middot; " + esc(a.score) + "/" + esc(a.total) + "</span>" +
            '<span class="sub">' + esc(who) + (when ? " &middot; " + esc(when) : "") + "</span></span></div>";
        });
      }
      render(html);
    }).catch(function (err) {
      if (nav !== navId) return;
      render(head + '<p class="lede">Could not load data.</p><div class="card"><div class="empty">' + esc(err.message) + "</div></div>");
    });
  }

  /* ---------- tabs ---------- */

  var TABS = { home: screenHome, course: screenCourse, review: screenReview, progress: screenProgress };

  function setTab(name) {
    document.querySelectorAll(".tab").forEach(function (t) {
      t.classList.toggle("is-on", t.dataset.tab === name);
    });
  }

  document.querySelectorAll(".tab").forEach(function (t) {
    t.onclick = function () {
      setTab(t.dataset.tab);
      stack = [];
      go(TABS[t.dataset.tab]);
    };
  });

  /* ---------- petals ---------- */

  (function petals() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    var c = document.getElementById("petals");
    var x = c.getContext("2d");
    var w, h, ps = [];

    function size() {
      w = c.width = window.innerWidth;
      h = c.height = window.innerHeight;
    }
    size();
    window.addEventListener("resize", size);

    for (var i = 0; i < 14; i++) {
      ps.push({
        x: Math.random() * w, y: Math.random() * h,
        r: 4 + Math.random() * 5,
        sp: .18 + Math.random() * .32,
        dr: (Math.random() - .5) * .3,
        a: Math.random() * Math.PI * 2,
        va: (Math.random() - .5) * .012
      });
    }

    function tick() {
      x.clearRect(0, 0, w, h);
      ps.forEach(function (p) {
        p.y += p.sp; p.x += p.dr; p.a += p.va;
        if (p.y > h + 12) { p.y = -12; p.x = Math.random() * w; }
        x.save();
        x.translate(p.x, p.y);
        x.rotate(p.a);
        x.beginPath();
        x.moveTo(0, 0);
        x.bezierCurveTo(p.r, -p.r * .8, p.r * 1.4, p.r * .6, 0, p.r * 1.5);
        x.bezierCurveTo(-p.r * 1.4, p.r * .6, -p.r, -p.r * .8, 0, 0);
        x.fillStyle = "#E9C4CA";
        x.fill();
        x.restore();
      });
      requestAnimationFrame(tick);
    }
    tick();
  })();

  /* ---------- boot ---------- */

  function boot() {
    var hasFirebase = initFirebase();
    if (!hasFirebase) {
      setChrome(true);
      go(screenHome);
      return;
    }

    fbAuth.onAuthStateChanged(function (user) {
      if (user) {
        currentUser = user;
        isAdmin = user.email === ADMIN_EMAIL;
        render('<div class="card"><div class="empty">Loading your progress…</div></div>');
        loadProgressFromCloud(user.uid).then(function () {
          setChrome(true);
          setTab("home");
          stack = [];
          go(screenHome);
        });
      } else {
        currentUser = null;
        isAdmin = false;
        screenLogin();
      }
    });
  }

  boot();
})();
