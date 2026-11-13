# TOEFL iBT 2026 Practice

Open-source, self-hosted TOEFL iBT 2026-format mock tests with AI grading using Gemini.
Free TOEFL practice for people who cannot afford paid tests.

Eight TOEFL 2026 mock tests cover Reading, Listening, Writing and Speaking. Run it on your own computer. No account, no database, no dependencies.

## Features

- Full TOEFL practice test or one section at a time.
- Reading and Listening adapt: Module 1 sets how hard Module 2 is.
- Listening shows one question at a time with a countdown. Audio plays once.
- Writing and Speaking are graded by Gemini, with fixes and a model answer.
- Speaking records your voice in the browser.
- Estimated 1 to 6 bands and a rough 0 to 120 score.
- Attempts stay in a local file on your machine.

## Quick start

You need Node 20 or newer. Speaking works best with `ffmpeg` installed.

```
git clone https://github.com/suprxsidh/toefl-ibt-2026-practice.git
cd toefl-ibt-2026-practice
cp .env.example .env
```

Put your Gemini key in `.env` as `GEMINI_API_KEY`. Then build the audio and start the server:

```
node scripts/gen-audio.js test1
node server.js
```

Open http://localhost:3939. Repeat the audio step for each test you want to use. Set `PORT` to change the port.

## Add a test

1. Copy the format in `data/tests/SCHEMA.md` into `data/tests/testN.json`.
2. Run `node lib/validate.js testN` and fix every error.
3. Run `node scripts/gen-audio.js testN`.
4. Reload the home page. The test appears by itself.

Want the mocks to match the real test more closely? Read `CALIBRATING.md`.

## Disclaimer

- This project is not associated with, affiliated with or endorsed by ETS or the TOEFL program. TOEFL is a trademark of ETS.
- The mocks are not identical to the real exam. They are our best approximation. We built them from public ETS format information and one test taker's memory. Timings, difficulty and scores can differ.
- All test content is original. Scoring is an estimate, not an official score.
- Do not post real exam questions. Test takers agree not to share them.

## License

MIT. See `LICENSE`.
