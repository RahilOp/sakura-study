#!/usr/bin/env python3
"""Generate a daily ICSE-style English grammar MCQ exercise.

Designed to be run once per day (e.g., via GitHub Actions at 5 AM IST) and push the
resulting exercise into Firestore so the static Sakura Study app can fetch it.

The generator uses deterministic templates and a daily seed so that re-running it on
the same day produces the same questions. Running it on a new date produces a new set.
"""
import argparse
import hashlib
import json
import os
import random
import sys
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any

# ---------------------------------------------------------------------------
# Question templates: each returns a dict {q, o, a, topic}
# ---------------------------------------------------------------------------


def q_preposition(rng: random.Random) -> Dict[str, Any]:
    templates = [
        ("She is afraid ___ dogs.", "of"),
        ("He insisted ___ going alone.", "on"),
        ("The book belongs ___ me.", "to"),
        ("They arrived ___ the station early.", "at"),
        ("She is good ___ painting.", "at"),
        ("We waited ___ him for an hour.", "for", {"on"}),
        ("He is interested ___ music.", "in"),
        ("He is proud ___ his son.", "of"),
        ("I prefer tea ___ coffee.", "to"),
        ("He was accused ___ theft.", "of"),
        ("She is married ___ a doctor.", "to"),
        ("They live ___ a small village.", "in"),
        ("The picture hangs ___ the wall.", "on", {"from"}),
        ("He apologised ___ being late.", "for"),
        ("She depends ___ her parents.", "on"),
        ("We are looking forward ___ the party.", "to"),
        ("He succeeded ___ solving the problem.", "in"),
        ("He was absent ___ school yesterday.", "from"),
        ("She is fond ___ classical dance.", "of"),
        ("The train leaves ___ 6 p.m.", "at", {"by"}),
    ]
    template = rng.choice(templates)
    sentence, answer = template[0], template[1]
    also_right = template[2] if len(template) > 2 else set()
    distractors = ["for", "with", "from", "about", "on", "at", "in", "to", "of", "by"]
    wrong = [d for d in distractors if d != answer and d not in also_right]
    rng.shuffle(wrong)
    options = [answer] + wrong[:3]
    rng.shuffle(options)
    return {
      "q": sentence,
      "o": options,
      "a": options.index(answer),
      "topic": "Prepositions",
    }


def q_tense(rng: random.Random) -> Dict[str, Any]:
    templates = [
        ("By next week, she ___ her project.", "will have completed"),
        ("I ___ this book before.", "have read"),
        ("When I reached the station, the train ___.", "had left"),
        ("She ___ to the market every Sunday.", "goes"),
        ("The baby ___ all morning.", "has been crying"),
        ("If it rains, we ___ at home.", "will stay"),
        ("The sun ___ in the east.", "rises"),
        ("They ___ football when it started raining.", "were playing"),
        ("He ___ in this office since 2019.", "has been working"),
        ("By the time you arrive, we ___ dinner.", "will have finished"),
        ("She ___ the letter just now.", "wrote"),
        ("Tomorrow I ___ my homework before dinner.", "will finish"),
        ("The guests ___ already when we came.", "had left"),
        ("Water ___ at 100 degrees Celsius.", "boils"),
        ("Look! The children ___ in the park.", "are playing"),
    ]
    sentence, answer = rng.choice(templates)
    # Build plausible but incorrect tense forms
    distractors = {
        "will have completed": ["will complete", "would complete", "has completed"],
        "have read": ["read", "has read", "am reading"],
        "goes": ["is going", "went", "has gone"],
        "has been crying": ["cried", "cries", "is crying"],
        "will stay": ["would stay", "stayed", "had stayed"],
        "rises": ["rose", "is rising", "has risen"],
        "were playing": ["played", "are playing", "had played"],
        "has been working": ["is working", "worked", "had worked"],
        "will have finished": ["will finish", "have finished", "finished"],
        "wrote": ["has written", "writes", "had written"],
        "will finish": ["finished", "would finish", "have finished"],
        "had left": ["has left", "have left", "leaves"],
        "boils": ["is boiling", "boiled", "has boiled"],
        "are playing": ["play", "were playing", "played"],
    }[answer]
    wrong = [d for d in distractors if d != answer]
    rng.shuffle(wrong)
    options = [answer] + wrong[:3]
    rng.shuffle(options)
    return {"q": sentence, "o": options, "a": options.index(answer), "topic": "Tenses"}


def q_direct_indirect(rng: random.Random) -> Dict[str, Any]:
    templates = [
        ('He said, "I am busy." (Indirect: He said that he ___ busy.)', "was"),
        ('She said, "I will come." (Indirect: She said that she ___ come.)', "would"),
        ('They said, "We have finished." (Indirect: They said that they ___ finished.)', "had"),
        ('Ravi said, "I can swim." (Indirect: Ravi said that he ___ swim.)', "could"),
        ('Mother said, "The sun rises in the east." (Indirect: Mother said that the sun ___ in the east.)', "rises"),
        ('He said, "I am writing a letter." (Indirect: He said that he ___ a letter.)', "was writing"),
        ('She said, "I bought a book." (Indirect: She said that she ___ a book.)', "had bought"),
        ('The teacher said, "Honesty is the best policy." (Indirect: The teacher said that honesty ___ the best policy.)', "is"),
        ('He said to me, "I shall help you." (Indirect: He told me that he ___ help me.)', "would"),
        ('She said, "I do not like coffee." (Indirect: She said that she ___ not like coffee.)', "did"),
    ]
    sentence, answer = rng.choice(templates)
    base = sentence.split("___")[0].strip().rsplit(" ", 1)[0]
    # Distractors are topic-typical modals/auxiliaries
    distractors = {
        "was": ["is", "were", "had been"],
        "would": ["will", "should", "might"],
        "had": ["have", "has", "were"],
        "could": ["can", "would", "might"],
        "rises": ["rose", "was rising", "is rising"],
        "was writing": ["wrote", "had written", "is writing"],
        "had bought": ["bought", "has bought", "was buying"],
        "is": ["was", "has been", "were"],
        "did": ["does", "do", "had"],
    }[answer]
    wrong = [d for d in distractors if d != answer]
    rng.shuffle(wrong)
    options = [answer] + wrong[:3]
    rng.shuffle(options)
    return {
        "q": sentence,
        "o": options,
        "a": options.index(answer),
        "topic": "Direct-Indirect Speech",
    }


def q_active_passive(rng: random.Random) -> Dict[str, Any]:
    templates = [
        ("Someone stole my bicycle. (Passive: My bicycle ___ stolen.)", "was"),
        ("They are building a house. (Passive: A house ___ built by them.)", "is being"),
        ("She has finished the work. (Passive: The work ___ finished by her.)", "has been"),
        ("The teacher will correct the papers. (Passive: The papers ___ corrected by the teacher.)", "will be"),
        ("He wrote a letter. (Passive: A letter ___ by him.)", "was written"),
        ("The children are flying kites. (Passive: Kites ___ by the children.)", "are being flown"),
        ("Someone has opened the gate. (Passive: The gate ___ opened.)", "has been"),
        ("They will have completed the project. (Passive: The project ___ completed by them.)", "will have been"),
        ("She was cooking dinner. (Passive: Dinner ___ by her.)", "was being cooked"),
        ("The manager had given the instructions. (Passive: The instructions ___ given by the manager.)", "had been"),
    ]
    sentence, answer = rng.choice(templates)
    distractors = {
        "was": ["is", "were", "has been"],
        "is being": ["was being", "is", "was"],
        "has been": ["had been", "was", "is being"],
        "will be": ["would be", "will have been", "is"],
        "was written": ["is written", "has been written", "had been written"],
        "are being flown": ["were being flown", "are flown", "have been flown"],
        "will have been": ["would have been", "will be", "has been"],
        "was being cooked": ["is being cooked", "was cooked", "had been cooked"],
        "had been": ["has been", "was", "were"],
    }[answer]
    wrong = [d for d in distractors if d != answer]
    rng.shuffle(wrong)
    options = [answer] + wrong[:3]
    rng.shuffle(options)
    return {
        "q": sentence,
        "o": options,
        "a": options.index(answer),
        "topic": "Active-Passive Voice",
    }


def q_phrasal_verb(rng: random.Random) -> Dict[str, Any]:
    templates = [
        ("Please ___ your shoes before entering. (remove)", "take off"),
        ("The meeting was ___ because of rain. (cancelled)", "called off"),
        ("She ___ an old friend at the mall. (met by chance)", "ran into"),
        ("I cannot ___ this noise any longer. (tolerate)", "put up with"),
        ("We should ___ the lights before leaving. (extinguish)", "turn off"),
        ("He ___ his jacket and sat down. (removed)", "took off"),
        ("The child ___ his mother. (resembled)", "took after"),
        ("Please ___ the form carefully. (complete)", "fill in"),
        ("The police are ___ the robbery. (investigating)", "looking into"),
        ("She ___ her ideas clearly. (explained)", "put across"),
    ]
    sentence, answer = rng.choice(templates)
    distractors = {
        "take off": ["put off", "take on", "get off"],
        "called off": ["put off", "took off", "gave off"],
        "ran into": ["ran over", "looked into", "got over"],
        "put up with": ["keep up with", "catch up with", "give up"],
        "turn off": ["switch on", "turn up", "turn down"],
        "took off": ["put on", "took on", "gave away"],
        "took after": ["took off", "looked after", "cared for"],
        "fill in": ["put in", "fill up", "write down"],
        "looking into": ["looking after", "looking for", "searching out"],
        "put across": ["put off", "put on", "gave away"],
    }[answer]
    wrong = [d for d in distractors if d != answer]
    rng.shuffle(wrong)
    options = [answer] + wrong[:3]
    rng.shuffle(options)
    return {"q": sentence, "o": options, "a": options.index(answer), "topic": "Phrasal Verbs"}


def q_error_correction(rng: random.Random) -> Dict[str, Any]:
    templates = [
        ("Identify the correct sentence.", "She does not like apples.", [
            "She do not like apples.",
            "She does not likes apples.",
            "She don't likes apples.",
        ]),
        ("Identify the correct sentence.", "Neither of the boys was present.", [
            "Neither of the boys were present.",
            "Neither of the boy was present.",
            "Neither boys were present.",
        ]),
        ("Identify the correct sentence.", "One of my friends is a doctor.", [
            "One of my friend is a doctor.",
            "One of my friends are a doctor.",
            "One of my friend are a doctor.",
        ]),
        ("Identify the correct sentence.", "The furniture was polished.", [
            "The furniture were polished.",
            "The furnitures was polished.",
            "The furnitures were polished.",
        ]),
        ("Identify the correct sentence.", "He and I are going out.", [
            "Him and me are going out.",
            "He and me are going out.",
            "Him and I are going out.",
        ]),
    ]
    stem, answer, wrongs = rng.choice(templates)
    options = [answer] + wrongs
    rng.shuffle(options)
    return {"q": stem, "o": options, "a": options.index(answer), "topic": "Error Correction"}


GENERATORS = [q_preposition, q_tense, q_direct_indirect, q_active_passive, q_phrasal_verb, q_error_correction]


def generate_exercise(date_str: str, count: int = 20) -> Dict[str, Any]:
    """Generate a deterministic daily exercise for `date_str` (YYYY-MM-DD)."""
    seed = hashlib.sha256(("sakura-grammar-" + date_str).encode("utf-8")).hexdigest()
    rng = random.Random(seed)
    questions: List[Dict[str, Any]] = []
    topic_quota = {
        "Prepositions": 3,
        "Tenses": 4,
        "Direct-Indirect Speech": 4,
        "Active-Passive Voice": 4,
        "Phrasal Verbs": 3,
        "Error Correction": 2,
    }
    gen_by_topic = {
        "Prepositions": q_preposition,
        "Tenses": q_tense,
        "Direct-Indirect Speech": q_direct_indirect,
        "Active-Passive Voice": q_active_passive,
        "Phrasal Verbs": q_phrasal_verb,
        "Error Correction": q_error_correction,
    }
    # Fill according to rough ICSE balance, never repeating a question within a day
    seen = set()
    for topic, quota in topic_quota.items():
        added = 0
        while added < quota:
            q = gen_by_topic[topic](rng)
            key = (q["q"], q["o"][q["a"]])
            if key in seen:
                continue
            seen.add(key)
            questions.append(q)
            added += 1
    rng.shuffle(questions)
    return {
        "id": f"grammar-{date_str}",
        "date": date_str,
        "title": f"Daily Grammar — {date_str}",
        "count": count,
        "questions": questions[:count],
    }


# ---------------------------------------------------------------------------
# Firestore integration (optional when run in CI)
# ---------------------------------------------------------------------------

def upload_to_firestore(exercise: Dict[str, Any]) -> None:
    try:
        from google.cloud import firestore
    except ImportError:
        print("google-cloud-firestore not installed; skipping upload.")
        sys.exit(0)

    project = os.environ.get("FIREBASE_PROJECT_ID")
    if not project:
        raise RuntimeError("FIREBASE_PROJECT_ID env var is required to upload.")

    db = firestore.Client(project=project)
    db.collection("grammar_exercises").document(exercise["id"]).set(exercise)
    print(f"Uploaded {exercise['id']} to Firestore.")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", help="Date for the exercise (YYYY-MM-DD). Defaults to today UTC/IST.")
    parser.add_argument("--count", type=int, default=20, help="Number of questions.")
    parser.add_argument("--upload", action="store_true", help="Upload to Firestore.")
    parser.add_argument("--output", help="Write JSON to this file.")
    args = parser.parse_args()

    date_str = args.date or (datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)).strftime("%Y-%m-%d")

    exercise = generate_exercise(date_str, args.count)

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(exercise, f, ensure_ascii=False, indent=2)
        print(f"Wrote {args.output}")
    else:
        print(json.dumps(exercise, ensure_ascii=False, indent=2))

    if args.upload:
        upload_to_firestore(exercise)


if __name__ == "__main__":
    main()
