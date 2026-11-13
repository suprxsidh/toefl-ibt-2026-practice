# Calibrating the mocks

Goal: make the mocks match the real TOEFL iBT 2026 more closely. Every number here comes from public ETS information or one test taker's memory. Treat all of it as a guess to check.

## What to edit

| What | Where |
|---|---|
| Section timings (minutes) | `timings` in `data/tests/*.json` |
| Answer time per Listening question (seconds) | `timeLimitS` on an item in `data/tests/*.json` |
| Default answer times | `LIMIT_S` in `public/app.js` |
| Section order | key order of `SEC` in `public/app.js` |
| Item counts | `COUNTS` in `lib/validate.js`, then the test files |
| Routing threshold (Module 1 to Module 2) | `UPPER_AT` in `server.js` |
| Score bands, 0 to 120 estimate | `lib/scoring.js` |
| Grading rules | `data/rubrics/*.md` |
| Text to speech voices | `v` fields in each test's `audio` map, model in `lib/gemini.js` |

Run `node lib/validate.js testN` after every change to a test file.

## Known real-test facts

| Fact | Confidence |
|---|---|
| Listening questions appear one at a time. | One test taker's memory |
| Each Listening question has an answer timer: 20 s for conversations, 30 s for academic talks. | One test taker's memory |
| Audio plays once. Questions stay hidden until it ends. | One test taker's memory |
| Reading and Listening have two modules. Module 1 sets the level of Module 2. | Public ETS information, verify |
| Listening has no Back button. Reading allows Back inside a module. | Public ETS information, verify |

The exact numbers may be off. Please verify them and open an issue if you see a difference.

## What the mocks guess

- Announcements use the 30 s timer. Short "choose a response" items use 20 s.
- Routing sends 60% or more on Module 1 to the upper Module 2.
- The score to band tables are our own. ETS does not publish its conversion tables.
- Writing and Speaking item scores run 0 to 5. Band is score plus 1.
- Test difficulty varies on purpose. test3 is harder than the rest.

## How to report a difference

Open an issue with the "Format difference" template. Copy this text if you prefer:

```
Section and task:
What the mock does:
What the real test does:
How sure are you? (took it myself / official ETS page / heard from someone):
Test date, if known:
Link to an official ETS page, if any:
```

## The rule

Describe format and timing only. Never post real questions, passages, audio or answers. Test takers agree not to share exam content, and we will delete any issue or pull request that does.

Good report: "Listening conversations show one question at a time. The timer looked like 20 seconds."

Bad report: A copy of a real question.

## Pull requests

1. Change one thing per pull request.
2. Say where the number came from.
3. Run `node lib/validate.js` on every test you touched.
