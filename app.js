/* Sakura Study — daily MCQ practice
   Static app, no build step. State lives in localStorage. */

(function () {
  "use strict";

  var SUBJECTS = [window.SUBJECT_SOCIOLOGY, window.SUBJECT_ENGLISH, window.SUBJECT_ECONOMICS];
  var DAILY_COUNT = 15;
  var KEY = "sakura-study-v1";

  var app = document.getElementById("app");
  var backBtn = document.getElementById("backBtn");
  var streakChip = document.getElementById("streakChip");

  /* ---------- state ---------- */

  function blank() {
    return { seen: {}, wrong: {}, days: {}, streak: 0, lastDay: null, total: 0, correct: 0 };
  }

  var S = load();

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return blank();
      var p = JSON.parse(raw);
      var b = blank();
      for (var k in b) if (!(k in p)) p[k] = b[k];
      return p;
    } catch (e) {
      return blank();
    }
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {}
  }

  function today() {
    var d = new Date();
    return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
  }

  function markDay() {
    var t = today();
    if (S.lastDay === t) return;
    var y = new Date(); y.setDate(y.getDate() - 1);
    var ystr = y.getFullYear() + "-" + (y.getMonth() + 1) + "-" + y.getDate();
    S.streak = S.lastDay === ystr ? S.streak + 1 : 1;
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

  function go(fn, push) {
    if (push !== false) stack.push(fn);
    fn();
    backBtn.hidden = stack.length <= 1;
    updateStreak();
  }

  backBtn.addEventListener("click", function () {
    stack.pop();
    var prev = stack[stack.length - 1];
    if (prev) { prev(); backBtn.hidden = stack.length <= 1; }
  });

  function updateStreak() {
    if (S.streak > 0) {
      streakChip.hidden = false;
      streakChip.textContent = S.streak + (S.streak === 1 ? " day" : " days") + " running";
    } else {
      streakChip.hidden = true;
    }
  }

  /* ---------- screens ---------- */

  function screenHome() {
    var all = allQuestions();
    var seenN = Object.keys(S.seen).length;
    var wrongN = Object.keys(S.wrong).length;
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

    html += '<h2 class="sectiontitle">Subjects</h2>';
    SUBJECTS.forEach(function (sub) {
      if (!sub) return;
      var n = readyCount(sub);
      html += '<button class="rowlink" data-sub="' + sub.id + '"' + (n ? "" : " disabled") + ">" +
        '<span class="semtag">' + esc(sub.name.slice(0, 3)) + "</span>" +
        '<span class="body"><span class="title">' + esc(sub.name) + "</span>" +
        '<span class="sub">' + (n ? n + " questions ready" : "No questions added yet") + "</span></span>" +
        '<span class="chev">&#8250;</span></button>';
    });

    render(html);

    var b = document.getElementById("startDaily");
    if (b) b.onclick = function () { var set = dailySet(); if (set.length) go(function () { screenQuiz(set, "Today's practice"); }); };
    var w = document.getElementById("startWrong");
    if (w) w.onclick = function () { var set = shuffle(wrongSet()); if (set.length) go(function () { screenQuiz(set, "Review"); }); };

    app.querySelectorAll("[data-sub]").forEach(function (btn) {
      btn.onclick = function () {
        var sub = SUBJECTS.filter(function (s) { return s && s.id === btn.dataset.sub; })[0];
        go(function () { screenSubject(sub); });
      };
    });
  }

  function screenCourse() {
    var html = "<h1>Course</h1><p class=\"lede\">Every paper, in semester order. Work through them from the top.</p>";
    [2, 4, 6].forEach(function (sem) {
      var rows = "";
      SUBJECTS.forEach(function (sub) {
        if (!sub) return;
        sub.papers.filter(function (p) { return p.semester === sem; }).forEach(function (p) {
          var n = paperQuestions(p).length;
          rows += '<button class="rowlink" data-paper="' + p.id + '"' + (n ? "" : " disabled") + ">" +
            '<span class="semtag">' + sem + "</span>" +
            '<span class="body"><span class="title">' + esc(p.name) + "</span>" +
            '<span class="sub">' + esc(sub.name) + " &middot; " + (n ? n + " questions" : "not added yet") + "</span></span>" +
            '<span class="chev">&#8250;</span></button>';
        });
      });
      if (rows) html += '<h2 class="sectiontitle">Semester ' + sem + "</h2>" + rows;
    });
    render(html);
    bindPaperRows();
  }

  function screenSubject(sub) {
    var html = "<h1>" + esc(sub.name) + "</h1><p class=\"lede\">Papers in semester order.</p>";
    sub.papers.forEach(function (p) {
      var n = paperQuestions(p).length;
      html += '<button class="rowlink" data-paper="' + p.id + '"' + (n ? "" : " disabled") + ">" +
        '<span class="semtag">' + p.semester + "</span>" +
        '<span class="body"><span class="title">' + esc(p.name) + "</span>" +
        '<span class="sub">' + (n ? n + " questions" : esc(p.note || "not added yet")) + "</span></span>" +
        '<span class="chev">&#8250;</span></button>';
    });
    render(html);
    bindPaperRows();
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

  function screenPaper(paper) {
    var qs = paperQuestions(paper);
    var html = "<h1>" + esc(paper.name) + "</h1>" +
      '<p class="lede">Semester ' + paper.semester + (paper.note ? " &middot; " + esc(paper.note) : "") + "</p>";

    if (!qs.length) {
      html += '<div class="card" style="margin-top:18px"><div class="empty">Questions for this paper haven\'t been added yet.' +
        (paper.source ? '<br><br><a href="' + esc(paper.source) + '" target="_blank" rel="noopener">Open the source</a>' : "") +
        "</div></div>";
      render(html);
      return;
    }

    html += '<div class="card" style="margin-top:18px">' +
      "<h3>Practise the whole paper</h3>" +
      '<p class="lede">' + qs.length + " questions, shuffled.</p>" +
      '<button class="primary" id="wholePaper" style="margin-top:14px">Start</button>' +
      '<button class="ghost" id="mockExam">Mock exam &middot; 75 questions, 90 minutes</button>' +
      "</div>";

    html += '<h2 class="sectiontitle">Units</h2>';
    paper.units.forEach(function (u) {
      var n = (u.questions || []).length;
      var done = 0;
      (u.questions || []).forEach(function (q, i) { if (S.seen[uid(paper.id, u.id, i)]) done++; });
      html += '<button class="rowlink" data-unit="' + u.id + '">' +
        '<span class="body"><span class="title">' + esc(u.name) + "</span>" +
        '<span class="sub">' + esc(u.blurb || "") + "</span>" +
        '<span class="bar"><i style="width:' + (n ? Math.round(done / n * 100) : 0) + '%"></i></span></span>' +
        '<span class="chev">&#8250;</span></button>';
    });

    render(html);

    document.getElementById("wholePaper").onclick = function () {
      go(function () { screenQuiz(shuffle(qs), paper.name); });
    };
    document.getElementById("mockExam").onclick = function () {
      go(function () { screenQuiz(shuffle(qs).slice(0, 75), paper.name + " &middot; mock", 90 * 60); });
    };
    app.querySelectorAll("[data-unit]").forEach(function (btn) {
      btn.onclick = function () {
        var u = paper.units.filter(function (x) { return x.id === btn.dataset.unit; })[0];
        go(function () { screenQuiz(shuffle(unitQuestions(paper, u)), u.name); });
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
    var seenN = Object.keys(S.seen).length;
    var wrongN = Object.keys(S.wrong).length;
    var acc = S.total ? Math.round(S.correct / S.total * 100) : 0;
    var days = Object.keys(S.days).length;

    var html = "<h1>Progress</h1><p class=\"lede\">Accuracy is the number that matters. Aim to hold it above 70 per cent.</p>" +
      '<div class="card" style="margin-top:18px"><div class="todaymeta" style="border-top:none;padding-top:0;margin:0;flex-wrap:wrap;gap:26px">' +
      '<div><span class="n">' + acc + '%</span><span class="k">accuracy</span></div>' +
      '<div><span class="n">' + seenN + "/" + all.length + '</span><span class="k">coverage</span></div>' +
      '<div><span class="n">' + days + '</span><span class="k">days practised</span></div>' +
      '<div><span class="n">' + wrongN + '</span><span class="k">to revisit</span></div>' +
      "</div></div>";

    html += '<h2 class="sectiontitle">By paper</h2>';
    SUBJECTS.forEach(function (sub) {
      if (!sub) return;
      sub.papers.forEach(function (p) {
        var qs = paperQuestions(p);
        if (!qs.length) return;
        var done = qs.filter(function (x) { return S.seen[x.id]; }).length;
        html += '<div class="card"><h3>' + esc(p.name) + "</h3>" +
          '<p class="lede">' + done + " of " + qs.length + " seen</p>" +
          '<span class="bar"><i style="width:' + Math.round(done / qs.length * 100) + '%"></i></span></div>';
      });
    });

    html += '<button class="ghost" id="resetAll" style="margin-top:20px">Reset all progress</button>';
    render(html);
    document.getElementById("resetAll").onclick = function () {
      if (confirm("This clears every answer and your streak. Continue?")) {
        S = blank(); save(); updateStreak(); screenProgress();
      }
    };
  }

  /* ---------- quiz engine ---------- */

  function screenQuiz(items, title, seconds) {
    var i = 0, score = 0, answered = false, timeLeft = seconds || 0, timer = null;

    function finish() {
      if (timer) clearInterval(timer);
      markDay();
      var pct = Math.round(score / items.length * 100);
      var msg = pct >= 85 ? "Strong. This is the level that earns a good grade."
              : pct >= 70 ? "Solid. Keep the wrong ones in review and go again."
              : pct >= 45 ? "Getting there. Work through the wrong answers before new material."
              : "Early days. Read the unit notes, then come back to these.";
      render('<div class="result"><div class="score">' + score + "</div>" +
        '<div class="of">out of ' + items.length + " &middot; " + pct + "%</div>" +
        "<h2>" + msg + "</h2></div>" +
        '<button class="primary" id="againBtn" style="margin-top:24px">Practise again</button>' +
        '<button class="ghost" id="homeBtn">Back to today</button>');
      document.getElementById("againBtn").onclick = function () { screenQuiz(shuffle(items), title, seconds); };
      document.getElementById("homeBtn").onclick = function () { stack = []; go(screenHome); setTab("home"); };
    }

    function draw() {
      if (i >= items.length) return finish();
      answered = false;
      var it = items[i];
      var q = it.q;

      var head = (i + 1) + " of " + items.length;
      var right = seconds
        ? Math.floor(timeLeft / 60) + ":" + ("0" + (timeLeft % 60)).slice(-2)
        : title;

      var html = '<div class="qhead"><span>' + head + "</span><span>" + right + "</span></div>" +
        '<span class="bar"><i style="width:' + Math.round(i / items.length * 100) + '%"></i></span>' +
        '<p class="qtext">' + esc(q.q) + "</p>" +
        '<div id="opts">';
      q.o.forEach(function (o, n) {
        html += '<button class="opt" data-n="' + n + '"><span class="letter">' +
          "ABCD"[n] + '</span>' + esc(o) + "</button>";
      });
      html += "</div><div id=\"after\"></div>";
      render(html);

      app.querySelectorAll(".opt").forEach(function (btn) {
        btn.onclick = function () { choose(parseInt(btn.dataset.n, 10), it); };
      });
    }

    function choose(n, it) {
      if (answered) return;
      answered = true;
      var q = it.q;
      var ok = n === q.a;

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
      after.innerHTML = '<p class="verdict ' + (ok ? "ok" : "no") + '">' +
        (ok ? "Correct." : "Not this time.") + "</p>" +
        (ok ? "" : "<p>The answer is " + "ABCD"[q.a] + ": " + esc(q.o[q.a]) + ". This one goes to your review list.</p>") +
        '<button class="primary" id="nextBtn" style="margin-top:18px">' +
        (i === items.length - 1 ? "See result" : "Next question") + "</button>";
      document.getElementById("nextBtn").onclick = function () { i++; draw(); };
      document.getElementById("nextBtn").focus();
    }

    if (seconds) {
      timer = setInterval(function () {
        timeLeft--;
        if (timeLeft <= 0) { clearInterval(timer); finish(); return; }
        var h = app.querySelector(".qhead span:last-child");
        if (h) h.textContent = Math.floor(timeLeft / 60) + ":" + ("0" + (timeLeft % 60)).slice(-2);
      }, 1000);
    }

    draw();
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

  updateStreak();
  go(screenHome);
})();
