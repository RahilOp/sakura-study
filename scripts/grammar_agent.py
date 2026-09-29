#!/usr/bin/env python3
"""Personalised daily grammar exercise, written by an LLM (free models via OpenRouter).

Runs once a day (GitHub Actions, 5 AM IST):
  1. Reads the student's grammar attempts from Firestore.
  2. Folds attempts it hasn't seen yet into her learner memory
     (grammar_memory/student): per-topic accuracy, recent mistakes,
     questions already used, and daily scores.
  3. Asks a model for today's questions, weighted toward her weak topics,
     together with updated notes on how she is doing.
  4. Has a second model answer every question blind and drops any question
     whose key it disagrees with or finds ambiguous.
  5. Tops up any shortfall from the template bank, shuffles options,
     uploads the exercise and saves the memory.

Without OPENROUTER_API_KEY, or if the API call fails, it still produces an
exercise from the templates in grammar_generator.py, with the topic mix
personalised from her stats.

Env: FIREBASE_PROJECT_ID (+ GOOGLE_APPLICATION_CREDENTIALS or
FIRESTORE_EMULATOR_HOST), OPENROUTER_API_KEY, optional GRAMMAR_MODELS and
GRAMMAR_VERIFY_MODELS (comma-separated OpenRouter model ids, tried in order).
"""
import argparse
import hashlib
import json
import os
import random
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import grammar_generator as templates  # noqa: E402

ADMIN_EMAIL = "rahilrizvi0786110@gmail.com"
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
# Free models come and go; override these with GRAMMAR_MODELS / GRAMMAR_VERIFY_MODELS
# instead of editing code. Only models that support structured outputs work.
# The checker leads with a different model so it doesn't share the writer's blind spots.
GENERATE_MODELS = [m.strip() for m in (os.environ.get("GRAMMAR_MODELS") or
                   "qwen/qwen3.8-27b:free,nvidia/nemotron-3-super-120b-a12b:free,"
                   "dots-studio/dots-3-note-preview:free").split(",") if m.strip()]
VERIFY_MODELS = [m.strip() for m in (os.environ.get("GRAMMAR_VERIFY_MODELS") or
                 "nvidia/nemotron-3-super-120b-a12b:free,qwen/qwen3.8-27b:free,"
                 "dots-studio/dots-3-note-preview:free").split(",") if m.strip()]
TOPICS = [
    "Prepositions",
    "Tenses",
    "Direct-Indirect Speech",
    "Active-Passive Voice",
    "Phrasal Verbs",
    "Error Correction",
]
DEFAULT_MIX = {
    "Prepositions": 3,
    "Tenses": 4,
    "Direct-Indirect Speech": 4,
    "Active-Passive Voice": 4,
    "Phrasal Verbs": 3,
    "Error Correction": 2,
}
TEMPLATE_BY_TOPIC = {
    "Prepositions": templates.q_preposition,
    "Tenses": templates.q_tense,
    "Direct-Indirect Speech": templates.q_direct_indirect,
    "Active-Passive Voice": templates.q_active_passive,
    "Phrasal Verbs": templates.q_phrasal_verb,
    "Error Correction": templates.q_error_correction,
}
# Answers per topic needed before the mix is driven by her results.
MIN_ANSWERS_TO_PERSONALISE = 20
RECENT_PER_TOPIC = 20

# Memory caps keep the Firestore document small.
MAX_MISTAKES = 30
MAX_USED_QUESTIONS = 400
MAX_HISTORY = 90
MAX_PROCESSED = 400


# ---------------------------------------------------------------------------
# Memory
# ---------------------------------------------------------------------------

def blank_memory() -> Dict[str, Any]:
    return {
        "topicStats": {t: {"correct": 0, "total": 0, "recent": []} for t in TOPICS},
        "recentMistakes": [],
        "usedQuestions": [],
        "history": [],
        "processedExercises": [],
        "notes": "",
        "focus": [],
    }


def normalise(memory: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Fill in any keys missing from an older or empty memory document."""
    m = blank_memory()
    for k, v in (memory or {}).items():
        m[k] = v
    for t in TOPICS:
        st = m["topicStats"].setdefault(t, {})
        st.setdefault("correct", 0)
        st.setdefault("total", 0)
        st.setdefault("recent", [])
    return m


def key(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip().lower())


def fold_attempt(memory: Dict[str, Any], attempt: Dict[str, Any], exercise: Optional[Dict[str, Any]]) -> None:
    """Add one first attempt at an exercise to the memory."""
    memory["history"].append({
        "date": attempt.get("date") or "",
        "score": attempt.get("score", 0),
        "total": attempt.get("total", 0),
    })
    memory["history"] = memory["history"][-MAX_HISTORY:]

    questions = (exercise or {}).get("questions") or []
    for i, r in enumerate(attempt.get("responses") or []):
        if i >= len(questions) or not isinstance(r, dict):
            break
        q = questions[i]
        topic = q.get("topic")
        chosen = r.get("chosen")
        if topic not in TOPICS or not isinstance(chosen, int):
            continue
        ok = chosen == q.get("a")
        st = memory["topicStats"][topic]
        st["total"] += 1
        st["correct"] += 1 if ok else 0
        st["recent"] = (st["recent"] + [ok])[-RECENT_PER_TOPIC:]
        if not ok and 0 <= chosen < len(q.get("o", [])):
            memory["recentMistakes"].append({
                "date": attempt.get("date") or "",
                "topic": topic,
                "subskill": q.get("subskill", ""),
                "q": q.get("q", ""),
                "chosen": q["o"][chosen],
                "answer": q["o"][q["a"]],
            })
    memory["recentMistakes"] = memory["recentMistakes"][-MAX_MISTAKES:]


def update_memory_from_attempts(memory: Dict[str, Any], attempts: List[Dict[str, Any]],
                                exercises: Dict[str, Dict[str, Any]]) -> int:
    """Fold in each exercise's first attempt that hasn't been processed yet.

    Retries of the same exercise are skipped: she has already seen the answers.
    `attempts` must be sorted oldest first. Returns how many were folded in.
    """
    done = set(memory["processedExercises"])
    folded = 0
    for a in attempts:
        ex_id = a.get("exerciseId")
        if not ex_id or ex_id in done:
            continue
        fold_attempt(memory, a, exercises.get(ex_id))
        done.add(ex_id)
        memory["processedExercises"].append(ex_id)
        folded += 1
    memory["processedExercises"] = memory["processedExercises"][-MAX_PROCESSED:]
    return folded


# ---------------------------------------------------------------------------
# Topic mix
# ---------------------------------------------------------------------------

def apportion(weights: Dict[str, float], n: int) -> Dict[str, int]:
    """Split n across topics in proportion to weights (largest remainder)."""
    total = sum(weights.values()) or 1.0
    raw = {t: n * w / total for t, w in weights.items()}
    out = {t: int(v) for t, v in raw.items()}
    left = n - sum(out.values())
    for t in sorted(raw, key=lambda t: (raw[t] - out[t], weights[t]), reverse=True)[:left]:
        out[t] += 1
    return out


def topic_mix(memory: Dict[str, Any], count: int) -> Dict[str, int]:
    """Default ICSE balance until there's enough data, then weight toward weak topics.

    Every topic keeps at least 2 questions (spaced review); the rest goes to the
    topics she has been getting wrong recently. Error rate is smoothed toward 30%
    so a single slip doesn't swing the whole day.
    """
    stats = memory["topicStats"]
    answered = sum(len(stats[t]["recent"]) for t in TOPICS)
    if answered < MIN_ANSWERS_TO_PERSONALISE:
        return apportion({t: float(DEFAULT_MIX[t]) for t in TOPICS}, count)
    floor = 2 if count >= 2 * len(TOPICS) else 0
    error = {}
    for t in TOPICS:
        recent = stats[t]["recent"]
        error[t] = (recent.count(False) + 1.5) / (len(recent) + 5)
    extra = apportion(error, count - floor * len(TOPICS))
    return {t: floor + extra[t] for t in TOPICS}


# ---------------------------------------------------------------------------
# Question validation
# ---------------------------------------------------------------------------

def clean_question(q: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Return a tidy question dict, or None if it isn't a usable 4-option MCQ."""
    try:
        text = str(q["q"]).strip()
        opts = [str(o).strip() for o in q["o"]]
        a = int(q["a"])
        topic = q["topic"]
    except (KeyError, TypeError, ValueError):
        return None
    if topic not in TOPICS or not text or len(text) > 400:
        return None
    if len(opts) != 4 or not all(opts) or len({key(o) for o in opts}) != 4:
        return None
    if not 0 <= a < 4:
        return None
    out = {"q": text, "o": opts, "a": a, "topic": topic}
    for extra in ("subskill", "difficulty", "explanation"):
        if q.get(extra):
            out[extra] = str(q[extra]).strip()
    return out


def shuffle_options(q: Dict[str, Any], rng: random.Random) -> Dict[str, Any]:
    """Shuffle options so the answer position isn't biased; remap the key."""
    answer = q["o"][q["a"]]
    opts = q["o"][:]
    rng.shuffle(opts)
    return dict(q, o=opts, a=opts.index(answer))


def template_question(topic: str, rng: random.Random, avoid: set) -> Dict[str, Any]:
    """A template question for the topic, avoiding repeats where the bank allows."""
    q = TEMPLATE_BY_TOPIC[topic](rng)
    for _ in range(60):
        if key(q["q"]) + "|" + key(q["o"][q["a"]]) not in avoid:
            break
        q = TEMPLATE_BY_TOPIC[topic](rng)
    return q


# ---------------------------------------------------------------------------
# LLM (OpenRouter)
# ---------------------------------------------------------------------------

GENERATE_SCHEMA = {
    "type": "object",
    "properties": {
        "learner_notes": {"type": "string"},
        "focus": {"type": "array", "items": {"type": "string"}},
        "questions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "topic": {"type": "string", "enum": TOPICS},
                    "subskill": {"type": "string"},
                    "difficulty": {"type": "string", "enum": ["easy", "medium", "hard"]},
                    "q": {"type": "string"},
                    "o": {"type": "array", "items": {"type": "string"}},
                    "a": {"type": "integer"},
                    "explanation": {"type": "string"},
                },
                "required": ["topic", "subskill", "difficulty", "q", "o", "a", "explanation"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["learner_notes", "focus", "questions"],
    "additionalProperties": False,
}

VERIFY_SCHEMA = {
    "type": "object",
    "properties": {
        "answers": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "integer"},
                    "a": {"type": "integer"},
                    "ambiguous": {"type": "boolean"},
                },
                "required": ["id", "a", "ambiguous"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["answers"],
    "additionalProperties": False,
}

GENERATE_SYSTEM = """You are a patient English grammar tutor preparing a daily multiple-choice exercise for an undergraduate (B.A.) student in India revising ICSE-style grammar.

You keep notes on her across days. Each day you receive her learner memory: per-topic accuracy, her recent mistakes (the exact question, what she chose, and the right answer), her daily scores, and your own notes from before. Use it to write today's questions:
- Target the specific sub-skills behind her recent mistakes (e.g. past perfect vs simple past, reporting-verb backshift, passive of continuous tenses), not just the broad topic. Test the same rule in a fresh sentence; never reuse a sentence she has already seen.
- Mix difficulty: mostly at her level, a few a step above. If a topic is strong, keep it to quick review.
- Every question has exactly four options and exactly one correct answer under standard Indian/British school grammar. Distractors must be plausible but clearly wrong. Avoid questions where two options could be defended.
- "a" is the zero-based index of the correct option.
- The explanation (1-2 sentences) states the rule and why the answer is right, in plain words she can learn from.
- Use natural sentences with Indian names and everyday contexts. For fill-in-the-blank questions, mark the blank as ___.
- Stick to the requested number of questions per topic.

learner_notes: your updated notes on her (at most 120 words): what she has improved on, what she keeps getting wrong, and what to try next. They are shown to her tutor and given back to you tomorrow.
focus: 2-4 short phrases naming today's focus areas, written to her (e.g. "Past perfect with 'by the time'")."""

VERIFY_SYSTEM = """You are checking a grammar exercise before it goes to a student. For each question, choose the single correct option under standard Indian/British school grammar. Set ambiguous to true if more than one option is defensible or none is correct. "a" is the zero-based index of your answer."""


def make_client():
    """A function that posts one chat request to OpenRouter, or None without a key."""
    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        return None

    def chat(body: Dict[str, Any]) -> Dict[str, Any]:
        req = urllib.request.Request(OPENROUTER_URL, data=json.dumps(body).encode("utf-8"), headers={
            "Authorization": "Bearer " + api_key,
            "Content-Type": "application/json",
            "X-Title": "Sakura Study",
        })
        error = ""
        for attempt in range(3):
            if attempt:
                time.sleep(30 * attempt)  # free models are often briefly rate-limited or busy
            try:
                with urllib.request.urlopen(req, timeout=300) as resp:
                    return json.loads(resp.read().decode("utf-8"))
            except urllib.error.HTTPError as e:
                error = f"HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:300]}"
                if e.code not in (408, 429, 500, 502, 503, 504):
                    break
            except (urllib.error.URLError, TimeoutError) as e:
                error = str(e)
            print(f"OpenRouter request failed ({error}).")
        raise RuntimeError(f"OpenRouter: {error}")

    return chat


def parse_json(text: str) -> Dict[str, Any]:
    """Parse the reply, tolerating code fences or chatter some free models add."""
    try:
        return json.loads(text)
    except ValueError:
        start, end = text.find("{"), text.rfind("}")
        if start < 0 or end < start:
            raise
        return json.loads(text[start:end + 1])


def ask_llm(client, models: List[str], system: str, user: str, schema: Dict[str, Any],
            name: str, max_tokens: int) -> Tuple[Dict[str, Any], str]:
    """Returns the parsed JSON reply and the model that actually answered."""
    data = client({
        "models": models,  # OpenRouter falls back down the list if one is down or rate-limited
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "response_format": {"type": "json_schema", "json_schema": {"name": name, "strict": True, "schema": schema}},
        "provider": {"require_parameters": True},  # only providers that enforce the schema
        "max_tokens": max_tokens,
    })
    if data.get("error"):
        raise RuntimeError(f"OpenRouter error: {data['error']}")
    choice = data["choices"][0]
    if choice.get("finish_reason") == "length":
        raise RuntimeError("The model's reply was cut off (max_tokens).")
    return parse_json(choice["message"].get("content") or ""), data.get("model") or models[0]


def memory_for_prompt(memory: Dict[str, Any]) -> Dict[str, Any]:
    stats = {}
    for t in TOPICS:
        st = memory["topicStats"][t]
        recent = st["recent"]
        stats[t] = {
            "all_time": f"{st['correct']}/{st['total']}",
            "last_answers": f"{recent.count(True)}/{len(recent)}",
        }
    return {
        "topic_accuracy": stats,
        "recent_mistakes": memory["recentMistakes"][-20:],
        "daily_scores": memory["history"][-14:],
        "your_notes": memory["notes"] or "(none yet: this is the first personalised day)",
    }


def generate_questions(client, memory: Dict[str, Any], mix: Dict[str, int],
                       date_str: str) -> Tuple[Dict[str, Any], str]:
    # One spare per topic so questions rejected in verification can be replaced.
    ask = {t: n + 1 for t, n in mix.items() if n > 0}
    recent_used = memory["usedQuestions"][-150:]
    user = (
        f"Date: {date_str}\n\n"
        f"Learner memory:\n{json.dumps(memory_for_prompt(memory), ensure_ascii=False, indent=1)}\n\n"
        f"Questions per topic for today: {json.dumps(ask)} (total {sum(ask.values())}).\n\n"
        "Sentences she has already seen (do not reuse):\n"
        + "\n".join("- " + q for q in recent_used)
    )
    # Generous budget: many free models "think" before answering and that counts too.
    return ask_llm(client, GENERATE_MODELS, GENERATE_SYSTEM, user, GENERATE_SCHEMA,
                   "grammar_exercise", max_tokens=32000)


def verify_questions(client, questions: List[Dict[str, Any]], writer: str) -> Tuple[List[Dict[str, Any]], str]:
    """Keep only questions whose key the checker reproduces blind and finds unambiguous."""
    listing = [{"id": i, "q": q["q"], "o": q["o"]} for i, q in enumerate(questions)]
    # A model checking its own questions tends to repeat its own mistakes.
    models = [m for m in VERIFY_MODELS if m != writer] or VERIFY_MODELS
    result, model = ask_llm(client, models, VERIFY_SYSTEM, json.dumps(listing, ensure_ascii=False, indent=1),
                            VERIFY_SCHEMA, "grammar_check", max_tokens=16000)
    verdict = {}
    for r in result.get("answers", []):
        try:
            # Anything but an explicit false counts as ambiguous.
            verdict[int(r["id"])] = (int(r["a"]), r.get("ambiguous") is not False)
        except (KeyError, TypeError, ValueError):
            continue
    kept = []
    for i, q in enumerate(questions):
        if verdict.get(i) == (q["a"], False):
            kept.append(q)
        else:
            print(f"Dropped after verification: {q['q']!r}")
    return kept, model


# ---------------------------------------------------------------------------
# Build the day's exercise
# ---------------------------------------------------------------------------

def build_exercise(memory: Dict[str, Any], date_str: str, count: int, client=None) -> Dict[str, Any]:
    seed = hashlib.sha256(("sakura-grammar-" + date_str).encode("utf-8")).hexdigest()
    rng = random.Random(seed)
    mix = topic_mix(memory, count)
    used = {key(q) for q in memory["usedQuestions"]}
    avoid = set()  # question + answer, to avoid picking the same template twice today

    notes, focus, generated_by = None, [], "templates"
    by_topic: Dict[str, List[Dict[str, Any]]] = {t: [] for t in TOPICS}

    if client is not None:
        try:
            out, writer = generate_questions(client, memory, mix, date_str)
            candidates = []
            seen_today = set()
            for raw in out.get("questions", []):
                q = clean_question(raw)
                if not q or key(q["q"]) in used or key(q["q"]) in seen_today:
                    continue
                seen_today.add(key(q["q"]))
                candidates.append(q)
            kept, checker = verify_questions(client, candidates, writer)
            for q in kept:
                by_topic[q["topic"]].append(q)
            notes = (str(out.get("learner_notes") or "")).strip() or None
            focus = [str(f).strip() for f in out.get("focus") or [] if str(f).strip()][:4]
            generated_by = writer
            print(f"Written by {writer}, checked by {checker}: kept {len(kept)} of {len(candidates)}.")
        except Exception as e:  # any API or parsing failure falls back to templates
            print(f"LLM generation failed, using templates: {e}")
            by_topic = {t: [] for t in TOPICS}

    questions = []
    topped_up = 0
    for t in TOPICS:
        picked = by_topic[t][:mix[t]]
        while len(picked) < mix[t]:
            q = template_question(t, rng, avoid | used)
            avoid.add(key(q["q"]) + "|" + key(q["o"][q["a"]]))
            picked.append(q)
            topped_up += 1
        questions.extend(picked)
    if generated_by != "templates" and topped_up:
        print(f"Topped up {topped_up} question(s) from templates.")

    questions = [shuffle_options(q, rng) for q in questions]
    rng.shuffle(questions)
    return {
        "id": f"grammar-{date_str}",
        "date": date_str,
        "title": f"Daily Grammar — {date_str}",
        "count": len(questions),
        "questions": questions,
        "focus": focus,
        "mix": mix,
        "generatedBy": generated_by,
        "_notes": notes,
    }


def remember_exercise(memory: Dict[str, Any], exercise: Dict[str, Any]) -> None:
    memory["usedQuestions"] = (memory["usedQuestions"] + [q["q"] for q in exercise["questions"]])[-MAX_USED_QUESTIONS:]
    if exercise.get("_notes"):
        memory["notes"] = exercise["_notes"]
    memory["focus"] = exercise.get("focus", [])
    memory["lastExercise"] = exercise["id"]


# ---------------------------------------------------------------------------
# Firestore
# ---------------------------------------------------------------------------

def firestore_client():
    project = os.environ.get("FIREBASE_PROJECT_ID")
    if not project:
        return None
    from google.cloud import firestore
    return firestore.Client(project=project)


def load_state(db):
    """Memory, the student's attempts (oldest first) and the exercises they refer to."""
    memory = normalise((db.collection("grammar_memory").document("student").get().to_dict()))

    admin_uids = set()
    for d in db.collection("progress").stream():
        if (d.to_dict() or {}).get("email") == ADMIN_EMAIL:
            admin_uids.add(d.id)

    attempts = []
    for d in db.collection("grammar_attempts").stream():
        a = d.to_dict() or {}
        if a.get("email") == ADMIN_EMAIL or a.get("userId") in admin_uids:
            continue  # the admin testing the app shouldn't shape her exercises
        attempts.append(a)
    epoch = datetime.min.replace(tzinfo=timezone.utc)
    attempts.sort(key=lambda a: a.get("answeredAt") or epoch)

    exercises = {}
    for ex_id in {a.get("exerciseId") for a in attempts if a.get("exerciseId")}:
        snap = db.collection("grammar_exercises").document(ex_id).get()
        if snap.exists:
            exercises[ex_id] = snap.to_dict()
    return memory, attempts, exercises


def main() -> None:
    parser = argparse.ArgumentParser(description="Personalised daily grammar exercise, written by an LLM.")
    parser.add_argument("--date", help="Exercise date (YYYY-MM-DD). Defaults to today in IST.")
    parser.add_argument("--count", type=int, default=20)
    parser.add_argument("--upload", action="store_true", help="Write the exercise and memory to Firestore.")
    parser.add_argument("--force", action="store_true", help="Replace an existing exercise for the date.")
    parser.add_argument("--no-llm", action="store_true", help="Use templates only.")
    parser.add_argument("--output", help="Also write the exercise JSON to this file.")
    args = parser.parse_args()

    date_str = args.date or (datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)).strftime("%Y-%m-%d")
    exercise_id = f"grammar-{date_str}"

    db = firestore_client()
    if args.upload and db is None:
        raise SystemExit("FIREBASE_PROJECT_ID is required with --upload.")

    if db is not None:
        if args.upload and not args.force and db.collection("grammar_exercises").document(exercise_id).get().exists:
            # Never swap questions under her if she may already have started today's set.
            print(f"{exercise_id} already exists; use --force to replace it.")
            return
        memory, attempts, exercises = load_state(db)
    else:
        memory, attempts, exercises = blank_memory(), [], {}

    folded = update_memory_from_attempts(memory, attempts, exercises)
    print(f"Folded {folded} new attempt(s) into memory. Mix: {topic_mix(memory, args.count)}")

    client = None if args.no_llm else make_client()
    if client is None and not args.no_llm:
        print("OPENROUTER_API_KEY not set; using templates.")
    exercise = build_exercise(memory, date_str, args.count, client)
    remember_exercise(memory, exercise)

    public = {k: v for k, v in exercise.items() if not k.startswith("_")}
    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(public, f, ensure_ascii=False, indent=2)
        print(f"Wrote {args.output}")
    elif not args.upload:
        print(json.dumps(public, ensure_ascii=False, indent=2))

    if args.upload and db is not None:
        from google.cloud import firestore
        public["createdAt"] = firestore.SERVER_TIMESTAMP
        memory["updatedAt"] = firestore.SERVER_TIMESTAMP
        db.collection("grammar_exercises").document(exercise_id).set(public)
        db.collection("grammar_memory").document("student").set(memory)
        print(f"Uploaded {exercise_id} ({exercise['generatedBy']}) and updated memory.")


if __name__ == "__main__":
    main()
