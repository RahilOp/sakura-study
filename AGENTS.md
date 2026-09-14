# Sakura Study — Project Spec

> Agent reference document. Read this before making changes so the app stays small, consistent, and deployable.

---

## 1. What this is

Sakura Study is a static, single-page MCQ practice web app built for one user (Sugra) studying CSJM University BA papers. It runs entirely in the browser with no build step, no framework, and no backend. Progress is stored in `localStorage`.

It is deliberately simple: vanilla JS, one CSS file, one HTML file, and subject data loaded as global scripts.

---

## 2. Repository layout

```
sakura-study/
├── AGENTS.md              # this file
├── index.html             # entry point
├── styles.css
├── app.js
├── vercel.json
├── README.md
├── .gitignore
└── data/
    ├── english.js         # canonical English data
    ├── economics.js       # canonical Economics data
    └── sociology.js       # canonical Sociology scaffold
```

**Important:** the deployable site lives at the repo root. Vercel serves `index.html` directly. `vercel.json` is at root level.

---

## 3. Tech stack

- HTML5
- CSS3 with custom properties
- Vanilla JavaScript (ES5-ish style: `var`, IIFE, no modules, no classes)
- No build tools, no npm, no framework
- Google Fonts: Shippori Mincho (serif), Zen Kaku Gothic New (sans)
- Deploy target: Vercel static

---

## 4. Data schema

Each subject is a global object attached to `window`:

```js
window.SUBJECT_ENGLISH = {
  id: "english",
  name: "English",
  papers: [
    {
      id: "eng-sem2",
      semester: 2,
      name: "English Poetry",
      status: "ready",        // "ready" or "pending"
      note: "...",
      source: "...",          // optional external source link
      units: [
        {
          id: "u1",
          name: "Forms of poetry",
          blurb: "...",
          questions: [
            { q: "...", o: ["A", "B", "C", "D"], a: 0 }
          ]
        }
      ]
    }
  ]
};
```

Rules:
- `a` is the zero-based index of the correct option.
- Every question must have exactly four options.
- `status: "pending"` papers are scaffolded but have no questions; the UI disables them and may show a source link.
- Keep ids stable. A question's identity is `uid(paperId, unitId, questionIndex)`. If questions are reordered, the index changes and progress for that question is effectively lost.

---

## 5. State management

Stored under the localStorage key `sakura-study-v1`:

```js
{
  seen:   { "paper/unit/index": 1, ... },   // questions the user has answered
  wrong:  { "paper/unit/index": 1, ... },   // questions currently answered wrong
  days:   { "2026-9-14": true, ... },      // days on which practice happened
  streak: 0,                                // consecutive active days
  lastDay: "2026-9-14",                     // last day practice happened
  total: 0,                                 // total lifetime answers
  correct: 0                                // total lifetime correct answers
}
```

- `load()` merges missing keys from `blank()` so schema upgrades are safe.
- `save()` is called after every answer.
- Resetting progress wipes everything back to `blank()`.

---

## 6. Navigation model

The app uses a hand-rolled stack-based navigator:

- `go(fn, push)` renders a screen and (usually) pushes it onto `stack`.
- The back button pops the stack and re-renders the previous screen.
- Tab buttons clear the stack and push the selected tab's root screen.

Tabs and their root screens:

| Tab button | Screen function | Purpose |
|------------|-----------------|---------|
| Today      | `screenHome`    | Daily set, subject list, review shortcut |
| Course     | `screenCourse`  | All papers grouped by semester |
| Review     | `screenReview`  | Wrong-answer list |
| Progress   | `screenProgress`| Stats and reset |

---

## 7. Screens in detail

### `screenHome`
- Shows today's practice card with counts: seen / new / to revisit.
- Button starts a 15-question daily set (see algorithm below).
- If questions have been answered today, card says "Practice done for today".
- Lists subjects as row links; tapping opens `screenSubject`.
- If there are wrong answers, shows "Review the N you got wrong" ghost button.

### `screenSubject(subject)`
- Lists papers for that subject with semester tags.
- Tapping a paper opens `screenPaper`.

### `screenCourse`
- Lists every paper from every subject grouped by semester: 2, then 4, then 6.
- Papers with no questions are disabled.

### `screenPaper(paper)`
- Card to practise the whole paper (shuffled).
- Mock exam button: 75 questions, 90-minute timer.
- Lists units with progress bars.
- Tapping a unit starts a shuffled quiz for that unit.
- If the paper has no questions, shows an empty state and the optional `source` link.

### `screenReview`
- Shows the count of wrong-answer questions.
- Button starts a shuffled quiz of the wrong set.

### `screenProgress`
- Shows accuracy, coverage, days practised, and revisit count.
- Lists progress bars per paper.
- Has a "Reset all progress" button with confirm dialog.

### `screenQuiz(items, title, seconds)`
- Renders one question at a time with A-D options.
- On answer: disables options, highlights correct/wrong, shows verdict.
- Updates `seen`, `total`, `correct`, `wrong` in state.
- If `seconds` is provided, shows a countdown in the header; time-up forces finish.
- Finish screen shows score, percentage, and a motivational message.

---

## 8. Daily set algorithm

`dailySet()` picks up to `DAILY_COUNT` (15) questions:

1. Unseen questions first (`shuffle(unseen).slice(0, 15)`).
2. If fewer than 15, fill with previously wrong questions (shuffled).
3. If still fewer than 15, fill with any remaining questions (shuffled), avoiding duplicates.

The streak is marked when any quiz finishes (via `markDay()`), not when the daily set starts.

---

## 9. Streak logic

- `today()` returns `YYYY-M-D` (no leading zeros).
- `markDay()` runs when a quiz finishes.
- If `lastDay` is today, do nothing.
- If `lastDay` is yesterday, increment streak.
- Otherwise reset streak to 1.
- Record today in `S.days`.

The streak chip appears in the top bar whenever `S.streak > 0`.

---

## 10. Styling conventions

- CSS custom properties in `:root` define the palette. Names are Japanese-derived:
  - `--kinari` page background
  - `--ink` primary text
  - `--sakura` / `--sakura-deep` pinks
  - `--koubai` accent/deep pink (buttons, correct highlights)
  - `--matcha` green for success states
  - `--line` borders
  - `--card` white cards
- Fonts: `--serif` for headings, `--sans` for body.
- Mobile-first; max content width 620px.
- Bottom tab bar is fixed; main has bottom padding for safe areas.
- Canvas `#petals` draws falling petals behind content; disabled for `prefers-reduced-motion`.

When adding new UI, reuse existing classes: `card`, `rowlink`, `primary`, `ghost`, `lede`, `sectiontitle`, `bar`, `todaymeta`.

---

## 11. Special intro overlay

The bottom of `index.html` contains a self-contained sakura-letter intro for Sugra:
- Shows once on first visit (`localStorage sakura_intro_seen_v1`).
- Tap the blossom to open a letter, then "Continue" dismisses it.
- A small blossom bud in the bottom-right corner can replay it.
- Pure CSS/HTML/inline JS; no dependencies.

Be careful not to break this when editing `index.html`. It is intentionally separate from `app.js`.

---

## 12. Deployment

- Target: Vercel static.
- `vercel.json`:
  - `cleanUrls: true`
  - Sets `Cache-Control: public, max-age=0, must-revalidate` for `/data/*` so new question data is not cached aggressively.
- No build command; choose "Other" in Vercel if asked.

---

## 13. Adding or editing questions

1. Edit the canonical file under `data/`.
2. Keep the four-option format and zero-based `a` index.
3. Keep `status: "ready"` for papers that have questions.

Sociology is the main gap: three papers are scaffolded with source URLs in `data/sociology.js`.

---

## 14. Current content status

- English: 1,302 questions ready (`eng-sem2`, English Poetry; `eng-sem4-drama`, British and American Drama; `eng-sem6-indian-new`, Indian and New Literature in English; `eng-sem6-film-media`, Literature in Film and Media Studies).
- Economics: 89 questions ready (`eco-sem2`, Principles of Macro Economics).
- Sociology: 1,148 questions ready across all three papers (`soc-sem2`, `soc-sem2-research`, `soc-sem4`).
- Pending Economics papers: Money/Banking/Public Finance (sem 4 — past paper found but no official answer key), Financial Literacy (sem 4), Sem 6 Economics.
- Economics International (sem 5, course code A080503T) was found but contains no MCQs in the downloaded booklet, only notes and short/long questions.

---

## 15. Common extension points

If the user asks to add a feature, prefer the simplest path:

- **Notes / study material:** add a `notes` string to unit objects and render a "Read notes" button before starting a unit quiz.
- **More subjects:** create `data/newsubject.js`, attach as `window.SUBJECT_NEW`, load it in `index.html`, and add it to the `SUBJECTS` array in `app.js`.
- **Question count per day:** change `DAILY_COUNT` in `app.js`.
- **Timer for daily practice:** pass a `seconds` value when calling `screenQuiz` from the daily start button.
- **Export/import progress:** add buttons that serialize/deserialize the `sakura-study-v1` localStorage value.
- **Offline/PWA:** add a service worker and web manifest. The app is already cache-friendly because it is static.

---

## 16. Things to preserve

- Keep the app static and dependency-free unless there is a strong reason not to.
- Match the existing ES5/IIFE style in `app.js`.
- Avoid frameworks.
- Do not remove the intro overlay or petal canvas unless explicitly asked.
- Do not change existing question ordering if it would break stored progress.
- Prefer editing `data/*` files for content; keep `app.js` for behavior.

---

## 17. Testing locally

Because there is no build step, open `index.html` directly in a browser or serve the project root with any static server, e.g.:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.
