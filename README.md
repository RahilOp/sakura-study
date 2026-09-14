# Sakura Study

A daily MCQ practice app for CSJM University BA papers. Static site, no build step, no dependencies.

Currently loaded: **2,539 questions** (1,302 English, 89 Economics, 1,148 Sociology).

## Deploy to Vercel

### From Git (recommended for updates)

1. Push this repo to GitHub.
2. Go to [vercel.com](https://vercel.com), click **Add New → Project**.
3. Import the GitHub repository.
4. Vercel should auto-detect it as a static site. If it asks for framework, pick **Other** and leave the build settings empty.
5. Deploy. Every future `git push` will auto-deploy.

### Manual drop or CLI

- Drag the project folder onto the Vercel dashboard, or run:

```bash
npm i -g vercel
cd sakura-study
vercel --prod
```

There is no framework to select and no build command.

Tell her to open the URL on her phone and use **Add to Home Screen**. It then behaves like an app.

## What's in it

- **Today** — 15 questions a day, drawn from what she hasn't seen yet. Tracks a daily streak.
- **Course** — every paper in semester order, 2 then 4 then 6.
- **Review** — every question she has answered wrong, collected automatically. A question leaves the list once she gets it right.
- **Progress** — accuracy, coverage per paper, days practised.
- **Mock exam** — inside any paper: 75 questions, 90-minute countdown, matching the real format.

Progress is stored in the browser on her device. It does not sync between phone and laptop, and clearing browser data wipes it.

## Adding questions

Everything lives in `data/`. Three files, one per subject. The format is:

```js
{ q: "Question text", o: ["option A", "option B", "option C", "option D"], a: 2 }
```

`a` is the index of the correct option, counting from 0. So `a: 2` means option C.

Units sit inside papers:

```js
{
  id: "u1",
  name: "Unit name",
  blurb: "One line describing what it covers.",
  questions: [ ...  ]
}
```

Sociology is now filled in from the university question bank:

- Society in India: 383 questions
- Basic Research Methodology and Statistics: 368 questions
- Social Problems and Social Development: 397 questions

Source links:

- Society in India: https://prashnbank.csjmu.ac.in/society-in-india-structure-organization-change/
- Basic Research Methodology and Statistics: https://prashnbank.csjmu.ac.in/basic-research-methodology-and-statistics/
- Social Problems and Social Development: https://prashnbank.csjmu.ac.in/social-problem-and-social-development/

The pending Economics papers still need an official or worked-out answer key before their questions can be added safely.

## English question sources

- **English Poetry** — CSJMU Prashn Bank, course code A020201T.
- **British and American Drama** — CSJMU Prashn Bank, course code A040301T. The booklet labels it as B.A.-II (Semester III); it is grouped under Semester 4 in the app.
- **Indian and New Literature in English** — CSJMU Prashn Bank, course code A040601T.
- **Literature in Film and Media Studies** — CSJMU Prashn Bank, course code A040602T.

## Where the questions came from

**English Poetry** — CSJMU Prashn Bank, the university's own question bank, written by Dr Shilpi Mishra and Dr Nidhish Kumar Singh. Answers are the ones printed in the bank's own answer keys.

**Principles of Macro Economics** — the real Sem II exam paper, code A080201T. The university did not publish an answer key for it, so **these answers were worked out rather than taken from an official source**. They are reliable, but if one ever contradicts a teacher or textbook, trust that instead.

One thing worth knowing: the Prashn Bank contains a few internal errors. Its Unit II key marks blank verse as rhymed, which is wrong, and it gives two different answers for the stanza form of Gray's Elegy in two different units. I left those questions out. Treat the bank as a very good predictor of what the exam will ask, not as a final authority on fact.

## Adding learning materials later

Each unit object already has a `blurb` field. The simplest next step is to add a `notes` field with the unit's text, and a "Read the notes" button on the unit row before practice starts. The Prashn Bank PDFs contain written notes for every unit, so that content already exists and just needs moving across.
