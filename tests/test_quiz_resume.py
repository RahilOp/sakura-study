"""Browser regression tests. Run: python3 -m unittest discover -s tests -v

Requires Playwright and its Chromium browser. Firebase is stubbed; no requests
are made to a live database, authentication service, or LLM provider.
"""
import functools
import http.server
import os
import threading
import unittest
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
DRAFT_KEY = "sakura-study-quizzes-v1:"

FIREBASE_STUB = """
(function () {
  var authChanged;
  function user() {
    return { uid: localStorage.getItem('test-user') || 'student', email: 'student@example.test' };
  }
  function cloud() { return JSON.parse(localStorage.getItem('test-cloud') || '{}'); }
  function snapshot(value) {
    return { exists: !!value, data: function () { return value; } };
  }
  var auth = {
    onAuthStateChanged: function (fn) { authChanged = fn; fn(user()); },
    signOut: function () { authChanged(null); return Promise.resolve(); },
    signInWithEmailAndPassword: function (email) {
      localStorage.setItem('test-user', email.split('@')[0]);
      authChanged(user()); return Promise.resolve();
    }
  };
  function collection(name) {
    return {
      doc: function (id) {
        return {
          get: function () {
            if (name === 'grammar_exercises') {
              window.testGrammarReads = (window.testGrammarReads || 0) + 1;
              if (window.testGrammarOffline) return Promise.reject(new Error('offline'));
              return Promise.resolve(snapshot({
                id: id, date: id.replace('grammar-', ''), title: 'Grammar test', focus: ['Tenses'],
                questions: [
                  {q: 'She ___ here yesterday.', o: ['was', 'is', 'are', 'were'], a: 0, topic: 'Tenses', explanation: 'Use the past tense.'},
                  {q: 'He ___ ready now.', o: ['is', 'are', 'were', 'be'], a: 0, topic: 'Tenses'},
                  {q: 'We ___ friends.', o: ['are', 'is', 'was', 'be'], a: 0, topic: 'Tenses'},
                  {q: 'They ___ tomorrow.', o: ['will come', 'came', 'comes', 'has come'], a: 0, topic: 'Tenses'}
                ]
              }));
            }
            return Promise.resolve(snapshot(cloud()[name + '/' + id]));
          },
          set: function (value) {
            var data = cloud(); data[name + '/' + id] = value;
            localStorage.setItem('test-cloud', JSON.stringify(data)); return Promise.resolve();
          }
        };
      },
      add: function (value) {
        var attempts = JSON.parse(localStorage.getItem('test-attempts') || '[]');
        attempts.push(value); localStorage.setItem('test-attempts', JSON.stringify(attempts));
        return Promise.resolve();
      },
      where: function () { return this; },
      orderBy: function () { return this; },
      get: function () {
        return Promise.resolve({empty: true, forEach: function () {}});
      }
    };
  }
  function firestore() { return { collection: collection }; }
  firestore.FieldValue = {serverTimestamp: function () { return 1; }};
  window.firebase = {initializeApp: function () {}, auth: function () { return auth; }, firestore: firestore};
})();
"""


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass


class QuizResumeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        handler = functools.partial(QuietHandler, directory=str(ROOT))
        cls.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = "http://127.0.0.1:%s/index.html" % cls.server.server_port
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(executable_path=os.environ.get("CHROMIUM_PATH"))

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def setUp(self):
        self.context = self.browser.new_context(viewport={"width": 390, "height": 844}, reduced_motion="reduce")
        self.context.add_init_script("localStorage.setItem('sakura_intro_seen_v1', 'true');")
        self.context.route("https://**/*", lambda route: route.fulfill(body="", content_type="application/javascript"))
        self.context.route("**/firebase-config.js", lambda route: route.fulfill(body="window.FIREBASE_CONFIG = {};", content_type="application/javascript"))
        self.context.add_init_script(FIREBASE_STUB)
        self.page = self.context.new_page()
        self.errors = []
        self.page.on("pageerror", lambda err: self.errors.append(str(err)))
        self.page.goto(self.url)
        self.page.wait_for_selector("#startDaily")

    def tearDown(self):
        try:
            self.assertEqual(self.errors, [], "Unexpected JavaScript errors")
        finally:
            self.context.close()

    def drafts(self, user="student"):
        return self.page.evaluate("key => JSON.parse(localStorage.getItem(key) || '{}')", DRAFT_KEY + user)

    def total(self):
        return self.page.evaluate("JSON.parse(localStorage.getItem('sakura-study-v1') || '{}').total || 0")

    def leave(self):
        self.page.click('[data-tab="course"]')
        self.page.click('[data-tab="home"]')

    def resume(self, key=None):
        selector = '[data-resume="%s"]' % key if key else '[data-resume]'
        self.page.locator(selector).first.click()

    def mock(self):
        self.page.click('[data-tab="course"]')
        self.page.click('[data-paper="eng-sem2"]')
        self.page.once("dialog", lambda dialog: dialog.accept())
        self.page.click("#mockExam")
        self.page.wait_for_selector(".qclock")

    def test_tab_switch_keeps_answers_order_and_position(self):
        self.page.click("#startDaily")
        first_question = self.page.inner_text(".qtext")
        first_options = self.page.locator(".opt").all_inner_texts()
        self.page.click('.opt[data-n="1"]')
        self.page.click("#nextBtn")
        second_question = self.page.inner_text(".qtext")
        self.page.click('.opt[data-n="2"]')
        self.leave()
        self.assertEqual(self.page.locator("[data-resume]").count(), 1)
        self.resume()
        self.assertEqual(self.page.inner_text(".qtext"), second_question)
        self.assertIn("2 of 15", self.page.inner_text(".qhead"))
        self.assertEqual(self.page.locator(".opt[disabled]").count(), 4)
        self.page.click("#prevBtn")
        self.assertEqual(self.page.inner_text(".qtext"), first_question)
        self.assertEqual(self.page.locator(".opt").all_inner_texts(), first_options)
        self.assertEqual(self.total(), 2)
        self.assertEqual(self.page.locator(".qgrid-btn.grid-ok, .qgrid-btn.grid-no").count(), 2)

    def test_reload_and_reopen_do_not_count_answers_twice(self):
        self.page.click("#startDaily")
        self.page.click('.opt[data-n="0"]')
        self.page.click('.qgrid-btn[data-j="4"]')
        question = self.page.inner_text(".qtext")
        self.page.reload()
        self.page.wait_for_selector("[data-resume]")
        self.resume()
        self.assertEqual(self.page.inner_text(".qtext"), question)
        self.assertIn("5 of 15", self.page.inner_text(".qhead"))
        self.page.click('.qgrid-btn[data-j="0"]')
        self.assertEqual(self.page.locator(".opt[disabled]").count(), 4)
        self.assertEqual(self.total(), 1)
        self.page.close()
        self.page = self.context.new_page()
        self.page.goto(self.url)
        self.page.wait_for_selector("[data-resume]")
        self.resume()
        self.assertIn("1 of 15", self.page.inner_text(".qhead"))
        self.assertEqual(self.page.locator(".opt[disabled]").count(), 4)
        self.assertEqual(self.total(), 1)

    def test_same_start_button_resumes_and_finish_clears_draft(self):
        self.page.click("#startDaily")
        self.page.click("#nextBtn")
        question = self.page.inner_text(".qtext")
        self.leave()
        self.page.click("#startDaily")
        self.assertEqual(self.page.inner_text(".qtext"), question)
        self.page.once("dialog", lambda dialog: dialog.accept())
        self.page.click("#gridFinish")
        self.page.wait_for_selector(".result")
        self.assertEqual(self.drafts(), {})
        self.page.click("#againBtn")
        self.assertIn("1 of 15", self.page.inner_text(".qhead"))
        self.assertEqual(self.page.locator(".opt[disabled]").count(), 0)

    def test_paper_and_unit_have_separate_drafts_and_discard_is_confirmed(self):
        self.page.click('[data-tab="course"]')
        self.page.click('[data-paper="eng-sem2"]')
        self.page.click("#wholePaper")
        self.page.click('.opt[data-n="0"]')
        self.page.click("#backBtn")
        self.page.click('[data-unit="u1"]')
        self.page.click('.opt[data-n="1"]')
        self.leave()
        self.assertEqual(set(self.drafts()), {"paper/eng-sem2", "unit/eng-sem2/u1"})
        self.page.once("dialog", lambda dialog: dialog.dismiss())
        self.page.click('[data-discard="paper/eng-sem2"]')
        self.assertEqual(len(self.drafts()), 2)
        self.page.once("dialog", lambda dialog: dialog.accept())
        self.page.click('[data-discard="paper/eng-sem2"]')
        self.assertEqual(set(self.drafts()), {"unit/eng-sem2/u1"})
        self.resume("unit/eng-sem2/u1")
        self.assertEqual(self.page.locator(".opt[disabled]").count(), 4)

    def test_mock_keeps_deadline_and_expires_without_overwriting_other_screens(self):
        self.page.clock.install()
        self.mock()
        self.page.click('.opt[data-n="0"]')
        deadline = self.drafts()["mock/eng-sem2"]["deadline"]
        self.page.click('[data-tab="course"]')
        self.page.clock.fast_forward(120000)
        self.assertIn("Course", self.page.inner_text("h1"))
        self.page.click('[data-tab="home"]')
        self.resume("mock/eng-sem2")
        self.assertEqual(self.drafts()["mock/eng-sem2"]["deadline"], deadline)
        self.assertEqual(self.page.inner_text(".qclock"), "88:00")
        self.page.click('[data-tab="course"]')
        self.page.clock.fast_forward(90 * 60 * 1000)
        self.assertEqual(self.page.locator(".result").count(), 0)
        self.page.reload()
        self.page.wait_for_selector("[data-resume]")
        self.resume("mock/eng-sem2")
        self.assertIn("Time is up", self.page.inner_text(".result"))
        self.assertEqual(self.drafts(), {})
        self.assertEqual(self.total(), 1)

    def test_grammar_resume_uses_saved_questions_offline_and_submits_once(self):
        self.page.click("#startGrammar")
        self.page.wait_for_selector(".opt")
        self.page.click('.opt[data-n="0"]')
        self.page.click("#nextBtn")
        self.page.click('.opt[data-n="1"]')
        self.page.reload()
        self.page.wait_for_selector("[data-resume]")
        self.page.evaluate("window.testGrammarOffline = true")
        self.page.click("#startGrammar")
        self.assertIn("2 of 4", self.page.inner_text(".qhead"))
        self.assertEqual(self.page.locator(".opt[disabled]").count(), 4)
        self.assertEqual(self.page.evaluate("window.testGrammarReads || 0"), 0)
        self.assertEqual(self.page.evaluate("localStorage.getItem('test-attempts')"), None)
        self.page.click("#prevBtn")
        self.assertTrue(self.page.is_visible(".explain"))
        self.page.click("#nextBtn")
        self.page.click("#nextBtn")
        self.page.click('.opt[data-n="0"]')
        self.page.click("#nextBtn")
        self.page.click('.opt[data-n="0"]')
        self.page.click("#nextBtn")
        self.page.wait_for_selector(".result")
        attempts = self.page.evaluate("JSON.parse(localStorage.getItem('test-attempts'))")
        self.assertEqual(len(attempts), 1)
        self.assertEqual(attempts[0]["score"], 3)
        self.assertEqual(attempts[0]["responses"], [{"chosen": 0}, {"chosen": 1}, {"chosen": 0}, {"chosen": 0}])
        self.assertEqual(self.drafts(), {})

    def test_logout_preserves_own_draft_but_other_account_cannot_resume_it(self):
        self.page.click("#startDaily")
        self.page.click('.opt[data-n="0"]')
        self.leave()
        self.page.once("dialog", lambda dialog: dialog.accept())
        self.page.click("#logoutBtn")
        self.page.wait_for_selector("#loginEmail")
        self.page.fill("#loginEmail", "other@example.test")
        self.page.fill("#loginPass", "password")
        self.page.click("#loginBtn")
        self.page.wait_for_selector("#startDaily")
        self.assertEqual(self.page.locator("[data-resume]").count(), 0)
        self.assertEqual(self.drafts("other"), {})
        self.assertEqual(len(self.drafts("student")), 1)
        self.page.evaluate("localStorage.setItem('test-user', 'student')")
        self.page.reload()
        self.page.wait_for_selector("[data-resume]")
        self.resume()
        self.assertEqual(self.page.locator(".opt[disabled]").count(), 4)
        self.assertEqual(self.total(), 1)

    def test_restored_score_and_review_status_survive_until_finish(self):
        self.page.click("#startDaily")
        draft = next(iter(self.drafts().values()))
        self.page.click('.opt[data-n="%s"]' % draft["items"][0]["q"]["a"])
        self.page.click("#nextBtn")
        wrong = (draft["items"][1]["q"]["a"] + 1) % 4
        self.page.click('.opt[data-n="%s"]' % wrong)
        self.page.reload()
        self.page.wait_for_selector("[data-resume]")
        self.resume()
        self.assertTrue(self.page.is_visible(".verdict.no"))
        self.assertEqual(self.page.locator(".qgrid-btn.grid-ok").count(), 1)
        self.assertEqual(self.page.locator(".qgrid-btn.grid-no").count(), 1)
        self.page.click("#nextBtn")
        for index in range(2, 15):
            self.page.click('.opt[data-n="%s"]' % draft["items"][index]["q"]["a"])
            self.page.click("#nextBtn")
        self.page.wait_for_selector(".result")
        self.assertEqual(self.page.inner_text(".score"), "14")
        self.assertEqual(self.total(), 15)
        self.assertEqual(self.page.evaluate("JSON.parse(localStorage.getItem('sakura-study-v1')).correct"), 14)
        self.assertEqual(self.drafts(), {})

    def test_review_can_resume_after_wrong_set_becomes_empty(self):
        self.page.click("#startDaily")
        question = next(iter(self.drafts().values()))["items"][0]["q"]
        self.page.click('.opt[data-n="%s"]' % ((question["a"] + 1) % 4))
        self.page.click('[data-tab="review"]')
        self.page.click("#doReview")
        self.page.click('.opt[data-n="%s"]' % question["a"])
        self.page.click('[data-tab="course"]')
        self.page.click('[data-tab="review"]')
        self.assertEqual(self.page.inner_text("#doReview"), "Resume review")
        self.page.click("#doReview")
        self.assertEqual(self.page.locator(".opt[disabled]").count(), 4)
        self.page.click("#nextBtn")
        self.assertEqual(self.page.inner_text(".score"), "1")
        self.assertEqual(self.total(), 2)
        self.assertNotIn("review", self.drafts())

    def test_saved_questions_do_not_change_when_question_bank_changes(self):
        self.page.click("#startDaily")
        draft = next(iter(self.drafts().values()))
        question = self.page.inner_text(".qtext")
        self.page.click('.opt[data-n="0"]')
        self.page.reload()
        self.page.wait_for_selector("[data-resume]")
        self.page.evaluate("""id => {
          var parts = id.split('/');
          [SUBJECT_SOCIOLOGY, SUBJECT_ENGLISH, SUBJECT_ECONOMICS].forEach(sub => {
            sub.papers.forEach(p => {
              if (p.id !== parts[0]) return;
              p.units.forEach(u => {
                if (u.id === parts[1]) u.questions[Number(parts[2])].q = 'Changed question';
              });
            });
          });
        }""", draft["items"][0]["id"])
        self.resume()
        self.assertEqual(self.page.inner_text(".qtext"), question)
        self.assertEqual(self.page.locator(".opt[disabled]").count(), 4)

    def test_storage_failure_warns_instead_of_claiming_answers_are_saved(self):
        self.page.evaluate("""() => {
          var original = Storage.prototype.setItem;
          Storage.prototype.setItem = function (key, value) {
            if (key.indexOf('sakura-study-quizzes-v1:') === 0) throw new Error('Storage full');
            return original.call(this, key, value);
          };
        }""")
        self.page.click("#startDaily")
        self.assertTrue(self.page.is_visible("#quizSaveWarning"))
        self.page.click('.opt[data-n="0"]')
        self.assertTrue(self.page.is_visible("#quizSaveWarning"))
        self.assertTrue(self.page.is_visible(".verdict"))
        self.assertEqual(self.drafts(), {})

    def test_local_only_mode_can_resume_after_reload(self):
        self.context.route("**/firebase-config.js", lambda route: route.fulfill(body="window.FIREBASE_CONFIG = null;", content_type="application/javascript"))
        self.page.reload()
        self.page.wait_for_selector("#startDaily")
        self.page.click("#startDaily")
        self.page.click('.opt[data-n="0"]')
        self.assertEqual(len(self.drafts("local")), 1)
        self.page.reload()
        self.page.wait_for_selector("[data-resume]")
        self.resume()
        self.assertEqual(self.page.locator(".opt[disabled]").count(), 4)
        self.assertEqual(self.total(), 1)

    def test_reset_clears_saved_tests_and_invalid_storage_does_not_crash(self):
        self.page.click("#startDaily")
        self.page.click('.opt[data-n="0"]')
        self.page.click('[data-tab="progress"]')
        self.page.once("dialog", lambda dialog: dialog.accept())
        self.page.click("#resetAll")
        self.assertEqual(self.drafts(), {})
        self.page.click('[data-tab="home"]')
        self.assertEqual(self.page.locator("[data-resume]").count(), 0)
        self.page.evaluate("key => localStorage.setItem(key, '{broken')", DRAFT_KEY + "student")
        self.page.reload()
        self.page.wait_for_selector("#startDaily")
        self.assertEqual(self.page.locator("[data-resume]").count(), 0)


if __name__ == "__main__":
    unittest.main()
