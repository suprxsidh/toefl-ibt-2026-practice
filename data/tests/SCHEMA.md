# Test file schema

File: `data/tests/<id>.json`, original content. `node lib/validate.js <id>` must show 0 errors. Then `node scripts/gen-audio.js <id>`.

## Top level

```json
{ "id": "test2", "title": "Practice Test 2",
  "timings": { "reading": {"router": 20, "lower": 9, "upper": 9},
               "listening": {"router": 18, "lower": 7, "upper": 11},
               "writing": {"build": 6, "email": 7, "discussion": 10}, "speaking": 8 },
  "audio": { "l_c1": { "lines": [ {"v": "Kore", "t": "Spoken text."} ] } },
  "reading":   { "stage1": MODULE, "stage2": { "lower": MODULE, "upper": MODULE } },
  "listening": { "stage1": MODULE, "stage2": { "lower": MODULE, "upper": MODULE } },
  "writing": {}, "speaking": {} }
```

Timings in minutes; copy them. `MODULE` = `{"id": "r1", "cefr": "A2-C1", "tasks": [TASK]}`. Never add `"mock"`.

## Counts and levels (exact)

| Module | Items | cefr |
|---|---|---|
| Reading stage1 | 2 ctw x 10 blanks, daily 5, academic 5 = 30 | `A2-C1` |
| Reading lower / upper | 1 ctw x 10, daily 5, academic 5 = 20 | `A1-B1` / `B2-C2` |
| Listening stage1 | choose 10, conversation 6, announcement 4, talk 8 = 28 | `A2-C1` |
| Listening lower / upper | choose 6, conversation 4, announcement 3, talk 6 = 19 | `A1-B1` / `B2-C2` |

Daily items may use 2 texts (2 + 3). One academic passage per module. Max spoken words per listening module: stage1 1500, lower 650, upper 1050. Text length: 15-50 words (A1) to 200 (C2).

## Tasks (TASK)

```json
{"type": "ctw", "title": "Complete the Words", "text": "Bees live in colonies. They {share} food {with} others. Last sentence."}
{"type": "daily", "title": "Read in Daily Life", "text": "NOTICE: ...", "items": [ITEM]}
{"type": "choose", "title": "Listen and Choose a Response", "items": [ITEM]}
{"type": "conversation", "title": "Listen to a Conversation", "audio": "l_conv1", "items": [ITEM]}
```

`academic` ("Read an Academic Passage") is shaped like `daily`. `announcement` ("Listen to an Announcement") and `talk` ("Listen to an Academic Talk") are shaped like `conversation`. `ITEM` = `{"id": "r1_d1_1", "q": "Question?", "options": ["A", "B", "C", "D"], "answer": 2}`. `answer`: 0-based index. Optional `"timeLimitS"` (positive integer, seconds) sets the answer countdown of a Listening question. Default when absent: 20 s for `choose` and `conversation` items, 30 s for `announcement` and `talk` items. Reading items ignore it. Each `choose` item also has `"audio": "l_c1"`.

`{word}` is a blank. The app shows the first floor(n/2) letters. Blanks need 2+ letters. First and last sentences have no blanks; blank about every second word between them.

Answer key: per section, A, B, C and D each get 15-35% of answers. Never the same position 3 times in a row in one task.

Listening shows one question per page, in order, with no Back. The clock starts when the question appears (after the audio ends). At 0 the app moves on with no answer recorded.

## Writing

```json
"writing": {
 "build": {"title": "Build a Sentence",
   "items": [{"id": "w_b1", "context": "What did you do after class?", "before": "I", "after": "after that.",
              "chunks": ["the", "went", "library", "to", "go"], "answer": "went to the library"}]},
 "email": {"title": "Write an Email", "to": "Dr. Lee", "subject": "Missed lab", "prompt": "Situation, then 3 bullets.", "rubric": "Judge notes."},
 "discussion": {"title": "Write for an Academic Discussion", "prompt": "... at least 100 words.", "rubric": "...",
   "professor": {"name": "Dr. X", "text": "..."}, "students": [{"name", "text"} x 2]} }
```

Exactly 10 build items. `answer` is the chunk part only, without `before`/`after` (both optional). At most 1 distractor chunk. Optional `alts`: other correct orders.

## Speaking

```json
"speaking": {
 "repeat": {"title": "Listen and Repeat", "instructions": "...", "context": "Scenario...", "maxSeconds": 14,
   "items": [{"id": "sp_r1", "audio": "sp_r1", "text": "Exact words spoken."}]},
 "interview": {SAME SHAPE, "title": "Take an Interview", "maxSeconds": 45} }
```

Exactly 7 repeat items and 4 interview questions. One scenario per task.

## Audio map

- Every `audio` value is a key in `audio`; every key is used. Ids and keys: letters, digits, `_`; unique.
- Voices: Kore, Aoede, Leda, Puck, Fenrir, Charon, Orus, Zephyr. One line per turn.
- `t`: exact spoken text, no speaker labels.
