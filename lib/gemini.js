// Server-side Gemini REST helpers. The API key is read only from process.env.
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
const JUDGE_MODELS = ['gemini-3.1-pro-preview', 'gemini-3.5-flash'];
const TTS_MODEL = 'gemini-3.8-flash-tts';
const TTS_FALLBACK = 'gemini-2.5-flash-preview-tts';

async function call(model, body, timeoutMs = 180000) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY missing in .env');
  const res = await fetch(`${BASE}${model}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 500) }; }
  if (!res.ok) {
    const e = new Error(`Gemini ${model} HTTP ${res.status}: ${(json.error && json.error.message) || 'error'}`);
    e.status = res.status; throw e;
  }
  return json;
}

// parts: array of Gemini parts. Returns { json, raw, model }.
async function judge(parts, opts = {}) {
  let lastErr;
  for (const model of opts.models || JUDGE_MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const raw = await call(model, {
          contents: [{ role: 'user', parts }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
        });
        const cand = raw.candidates && raw.candidates[0];
        const txt = cand && cand.content && cand.content.parts && cand.content.parts.map(p => p.text || '').join('');
        if (!txt) throw new Error('Empty Gemini response');
        let json;
        try { json = JSON.parse(txt); } catch { json = JSON.parse(txt.replace(/^```json\s*|```\s*$/g, '')); }
        return { json, raw, model };
      } catch (e) {
        lastErr = e;
        if (e.status && e.status < 500 && e.status !== 429) break; // bad request: try next model
      }
    }
  }
  throw lastErr;
}

// Returns 24 kHz 16-bit mono PCM buffer.
async function tts(text, voice) {
  let lastErr;
  for (const model of [TTS_MODEL, TTS_FALLBACK]) {
    try {
      const raw = await call(model, {
        contents: [{ parts: [{ text }] }],
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
      }, 120000);
      const d = raw.candidates[0].content.parts[0].inlineData;
      let buf = Buffer.from(d.data, 'base64');
      if (buf.slice(0, 4).toString() === 'RIFF') buf = buf.slice(44); // headers from the API can carry wrong sizes
      return buf;
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

module.exports = { judge, tts };
