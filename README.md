# Sakura Study

A daily MCQ practice app for CSJM University BA papers. Static site, no build step.

Currently loaded: **2,098 subject questions** (761 English, 189 Economics, 1,148 Sociology) plus daily ICSE-style English grammar MCQs.

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

## Firebase setup

1. Create a Firebase project at https://console.firebase.google.com/.
2. Enable **Email/Password** authentication.
3. Create two users:
   - `ksugra17@gmail.com` (Sugra)
   - `rahilrizvi0786110@gmail.com` (admin)
4. Create a **Cloud Firestore** database in production mode.
5. Paste the rules from `scripts/firestore-rules.txt` into Firestore Security Rules.
6. Set `rahilrizvi0786110@gmail.com` as an admin using the Admin SDK custom claims, or rely on the hard-coded admin check in `app.js`.
7. Copy `firebase-config.template.js` to `firebase-config.js` and fill in your Firebase project keys.
8. Add GitHub secrets for the daily grammar generator:
   - `FIREBASE_PROJECT_ID`
   - `FIREBASE_SERVICE_ACCOUNT` (the contents of a service-account JSON with Firestore write permission)

## What's in it

- **Today** — 15 subject questions a day, drawn from what she hasn't seen yet. Tracks a daily streak.
- **English Grammar Daily** — 20 ICSE-style MCQs every day (prepositions, tenses, direct/indirect, active/passive, phrasal verbs, error correction). Past exercises can be re-attempted.
- **Course** — every paper in semester order, 2 then 4 then 6.
- **Review** — every question she has answered wrong, collected automatically. A question leaves the list once she gets it right.
- **Progress** — accuracy, coverage per paper, days practised.
- **Mock exam** — inside any paper: 75 questions, 90-minute countdown, matching the real format.
- **Admin dashboard** — for `rahilrizvi0786110@gmail.com` to track Sugra's subject progress and grammar exercise scores.

Progress is stored in **Firebase Firestore** and synced locally. She can use the app from any device after logging in.

## Adding questions

Everything lives in `data/`. The format is:

```js
{ q: "Question text", o: ["option A", "option B", "option C", "option D"], a: 2 }
```

`a` is the index of the correct option, counting from 0. So `a: 2` means option C.

## Source notes

- **English Poetry** — CSJMU Prashn Bank, course code A020201T (Semester 2).
- **Indian and New Literature in English** — CSJMU Prashn Bank, course code A040601T (Semester 6).
- **Media and Journalistic Writing** — B.A. Semester 6 exam booklet (Set A), course code A040603T. Answers are worked out, not from an official key.
- **Principles of Macro Economics** — real Sem II exam paper, code A080201T. Answers worked out.
- **Money, Banking and Public Finance** — real Sem IV exam paper, code A080401T (Set A). Answers worked out.
- **Sociology** — CSJMU Prashn Bank for all three papers.

Pending papers (no MCQ source found): English Sem 5 Classical Literature & History and Fiction; Economics Sem 5/6 papers; Psychology Psychopathology; Vocational AI for Arts/Humanities/Social Science.
