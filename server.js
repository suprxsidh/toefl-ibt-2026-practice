// TOEFL iBT practice server. Plain Node http, zero deps. Port 3939.
const http = require('http'), fs = require('fs'), path = require('path'), { execFile } = require('child_process');
require('./lib/env').loadEnv();
const { judge } = require('./lib/gemini');
const S = require('./lib/scoring');
const P = require('./lib/judge');
const { validate } = require('./lib/validate');

const ROOT = __dirname, DATA = path.join(ROOT, 'data');
const PORT = process.env.PORT || 3939;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.wav': 'audio/wav', '.json': 'application/json', '.svg': 'image/svg+xml' };
for (const d of ['recordings', 'tests', 'audio']) fs.mkdirSync(path.join(DATA, d), { recursive: true });

// ---------- storage ----------
const jread = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const jwrite = (f, o) => { fs.writeFileSync(f + '.tmp', JSON.stringify(o, null, 2)); fs.renameSync(f + '.tmp', f); };
const SETTINGS = path.join(DATA, 'settings.json'), HISTORY = path.join(DATA, 'history.json');
const getHist = () => jread(HISTORY, { attempts: [] });
const saveAttempt = a => { const h = getHist(); const i = h.attempts.findIndex(x => x.id === a.id); if (i >= 0) h.attempts[i] = a; else h.attempts.push(a); jwrite(HISTORY, h); };
const getAttempt = id => getHist().attempts.find(a => a.id === id);

// ---------- tests ----------
// Schema: data/tests/SCHEMA.md. Stage 2 has `lower` and `upper` modules.
const ROUTES = ['lower', 'upper'], UPPER_AT = 0.6; // router score >= 60% gives the upper module
const testCache = {};
function loadTest(id) {
  if (!/^[a-z0-9_-]+$/i.test(id)) return null;
  const f = path.join(DATA, 'tests', id + '.json');
  if (!fs.existsSync(f)) return null;
  const mt = fs.statSync(f).mtimeMs;
  if (testCache[id] && testCache[id].mt === mt) return testCache[id];
  const src = fs.readFileSync(f, 'utf8'), test = JSON.parse(src), orig = JSON.parse(src);
  const v = validate(orig, { audioDir: path.join(DATA, 'audio', id) });
  for (const e of v.errors) console.error(`[${id}] schema error: ${e}`);
  const key = {};
  const prep = mod => {
    for (const [ti, task] of mod.tasks.entries()) {
      if (task.type === 'ctw') {
        // ETS rule: show the first floor(len/2) letters, the test taker types the rest.
        const segs = []; let last = 0, n = 0;
        for (const m of task.text.matchAll(/\{([a-z]+)\}/gi)) {
          segs.push({ text: task.text.slice(last, m.index) });
          const w = m[1], k = Math.floor(w.length / 2), bid = `${mod.id}_ctw${ti}_${n++}`;
          segs.push({ blank: bid, prefix: w.slice(0, k), len: w.length - k });
          key[bid] = w.slice(k).toLowerCase(); last = m.index + m[0].length;
        }
        segs.push({ text: task.text.slice(last) }); task.segments = segs;
        delete task.text;
      } else for (const it of task.items) { key[it.id] = it.answer; delete it.answer; }
    }
  };
  for (const sec of ['reading', 'listening']) { prep(test[sec].stage1); for (const r of ROUTES) if (test[sec].stage2[r]) prep(test[sec].stage2[r]); }
  const buildKey = {};
  for (const it of test.writing.build.items) { buildKey[it.id] = [it.answer, ...(it.alts || [])]; delete it.answer; delete it.alts; }
  const full = { email: orig.writing.email, discussion: orig.writing.discussion };
  delete test.audio;
  for (const t of ['email', 'discussion']) delete test.writing[t].rubric;
  for (const t of ['repeat', 'interview']) for (const it of test.speaking[t].items) delete it.text; // repeat targets are answer keys
  testCache[id] = { mt, test, key, buildKey, full, speakDef: orig.speaking, errors: v.errors };
  return testCache[id];
}
const minutes = T => ({
  reading: `${T.reading.router + Math.min(T.reading.lower, T.reading.upper)}${T.reading.lower !== T.reading.upper ? '-' + (T.reading.router + Math.max(T.reading.lower, T.reading.upper)) : ''}`,
  listening: `${T.listening.router + Math.min(T.listening.lower, T.listening.upper)}${T.listening.lower !== T.listening.upper ? '-' + (T.listening.router + Math.max(T.listening.lower, T.listening.upper)) : ''}`,
  writing: String(T.writing.build + T.writing.email + T.writing.discussion), speaking: String(T.speaking) });
const listTests = () => fs.readdirSync(path.join(DATA, 'tests')).filter(f => f.endsWith('.json')).sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).map(f => {
  try { const t = JSON.parse(fs.readFileSync(path.join(DATA, 'tests', f), 'utf8')); return { id: t.id, title: t.title, minutes: minutes(t.timings) }; }
  catch (e) { console.error('bad test file', f, e.message); return null; }
}).filter(Boolean);
const modItems = m => m.tasks.flatMap(t => t.type === 'ctw' ? t.segments.filter(s => s.blank).map(s => ({ id: s.blank, q: `Missing letters after "${s.prefix}"` })) : t.items);
const isRight = (k, a) => typeof k === 'string' ? a != null && String(a).trim().toLowerCase() === k : a === k;

function scoreModules(T, section, answers, route) {
  const sec = T.test[section];
  const mods = [sec.stage1, sec.stage2[route]].filter(Boolean);
  let right = 0, total = 0; const detail = {};
  for (const m of mods) for (const it of modItems(m)) {
    total++; const a = answers[it.id], k = T.key[it.id], ok = isRight(k, a);
    if (ok) right++; detail[it.id] = { given: a ?? null, correct: k, ok, q: it.q, options: it.options };
  }
  return { right, total, detail };
}
function routeFor(T, section, answers) {
  const items = modItems(T.test[section].stage1); let right = 0;
  for (const it of items) if (isRight(T.key[it.id], answers[it.id])) right++;
  const pct = Math.round(1000 * right / items.length) / 10;
  return { route: right / items.length >= UPPER_AT ? 'upper' : 'lower', right, total: items.length, pct };
}

// ---------- http helpers ----------
const send = (res, code, obj) => { const b = JSON.stringify(obj); res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(b); };
const readBody = (req, max = 25e6) => new Promise((ok, no) => {
  const c = []; let n = 0;
  req.on('data', d => { n += d.length; if (n > max) { no(new Error('too large')); req.destroy(); } else c.push(d); });
  req.on('end', () => ok(Buffer.concat(c))); req.on('error', no);
});
const readJson = async req => { const b = await readBody(req); return b.length ? JSON.parse(b) : {}; };
const rec = (a, ...ks) => { let o = a; for (const k of ks.slice(0, -1)) o = o[k] = o[k] || {}; return o; };

function toWav(src) {
  const out = src.replace(/\.[a-z0-9]+$/i, '') + '.judge.wav';
  return new Promise(ok => execFile('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-ar', '16000', '-ac', '1', out], err => ok(err ? null : out)));
}
async function audioPart(file) {
  const wav = await toWav(file);
  const f = wav || file;
  const ext = path.extname(f).slice(1);
  const mime = wav ? 'audio/wav' : ext === 'mp4' ? 'audio/mp4' : ext === 'ogg' ? 'audio/ogg' : 'audio/webm';
  return { inlineData: { mimeType: mime, data: fs.readFileSync(f).toString('base64') } };
}
function recFile(attemptId, item) {
  const dir = path.join(DATA, 'recordings', attemptId);
  if (!fs.existsSync(dir)) return null;
  const f = fs.readdirSync(dir).find(x => x.startsWith(item + '.') && !x.includes('.judge.'));
  return f ? path.join(dir, f) : null;
}

function recompute(a) {
  const r = a.results, b = a.bands = a.bands || {};
  const T = loadTest(a.testId), single = !!(T && T.test.singleModule2); // singleModule2 tests use one Module 2 for both routes, so no lower-route cap
  for (const s of ['reading', 'listening']) if (r[s]) b[s] = Math.min(S.pctToBand(100 * r[s].right / r[s].total), !single && ['lower', 'easy'].includes(r[s].route) ? 4.5 : 6); // lower route caps the band at 4.5
  // Writing and Speaking: pool raw points like ETS (each Build item 1 point, each judged item 0-5), then map to a band.
  const ets = x => x && typeof x.ets_score === 'number' ? x.ets_score : x && typeof x.band === 'number' ? x.band - 1 : null; // older results have band only
  if (r.speaking && (r.speaking.repeat || r.speaking.interview)) {
    const parts = [];
    for (const k of ['repeat', 'interview']) { const j = r.speaking[k] && r.speaking[k].judged; for (const it of (j && j.responses) || []) parts.push({ got: ets(it), max: 5 }); }
    const pb = S.pooledBand(parts); if (pb != null) b.speaking = pb;
  }
  if (r.writing) {
    const parts = [];
    if (r.writing.build) parts.push({ got: r.writing.build.right, max: r.writing.build.total });
    for (const k of ['email', 'discussion']) { const j = r.writing[k] && r.writing[k].judged; if (j) parts.push({ got: ets(j), max: 5 }); }
    const pb = S.pooledBand(parts); if (pb != null) b.writing = pb;
  }
  a.overall = S.overall(b); a.approx120 = a.overall != null ? S.approx120(a.overall) : null;
}

// ---------- routes ----------
async function api(req, res, url) {
  const p = url.pathname, m = req.method;
  let g;
  if (p === '/api/tests') return send(res, 200, listTests());
  if (p === '/api/settings') {
    if (m === 'PUT') { const s = await readJson(req); jwrite(SETTINGS, { testDate: s.testDate || '', targetBand: Number(s.targetBand) || 5 }); }
    return send(res, 200, jread(SETTINGS, { testDate: '', targetBand: 5 }));
  }
  if (p === '/api/history') return send(res, 200, getHist().attempts.map(a => ({ id: a.id, testId: a.testId, mode: a.mode, sections: a.sections, createdAt: a.createdAt, bands: a.bands, overall: a.overall, approx120: a.approx120 })).reverse());
  if ((g = p.match(/^\/api\/test\/([^/]+)$/)) && m === 'GET') {
    const T = loadTest(g[1]); if (!T) return send(res, 404, { error: 'no such test' });
    const t = JSON.parse(JSON.stringify(T.test)); // stage 2 is delivered only after routing
    delete t.reading.stage2; delete t.listening.stage2;
    return send(res, 200, t);
  }
  if (p === '/api/attempt' && m === 'POST') {
    const b = await readJson(req);
    if (!loadTest(b.testId || '')) return send(res, 404, { error: 'no such test' });
    const a = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), testId: b.testId, mode: b.mode || 'exam', sections: b.sections || ['reading', 'listening', 'writing', 'speaking'], createdAt: new Date().toISOString(), results: {}, bands: {}, overall: null, approx120: null };
    saveAttempt(a); return send(res, 200, { id: a.id });
  }
  if ((g = p.match(/^\/api\/attempt\/([a-z0-9]+)$/)) && m === 'GET') {
    const a = getAttempt(g[1]); return a ? send(res, 200, a) : send(res, 404, { error: 'not found' });
  }
  if ((g = p.match(/^\/api\/attempt\/([a-z0-9]+)\/([\w-]+)$/))) {
    let a = getAttempt(g[1]); if (!a) return send(res, 404, { error: 'attempt not found' });
    const T = loadTest(a.testId), act = g[2];
    if (act === 'route' && m === 'POST') { // router answers in, stage 2 module out. Routed once per section.
      const { section, answers } = await readJson(req); a = getAttempt(g[1]);
      if (!['reading', 'listening'].includes(section)) return send(res, 400, { error: 'bad section' });
      a.routes = a.routes || {};
      if (!a.routes[section]) { a.routes[section] = routeFor(T, section, answers || {}); a.routerAnswers = { ...(a.routerAnswers || {}), [section]: answers || {} }; saveAttempt(a); }
      const r = a.routes[section];
      return send(res, 200, { route: r.route, module: T.test[section].stage2[r.route] });
    }
    if (act === 'objective' && m === 'POST') {
      const { section, answers } = await readJson(req); a = getAttempt(g[1]);
      if (!['reading', 'listening'].includes(section)) return send(res, 400, { error: 'bad section' });
      const all = { ...((a.routerAnswers || {})[section] || {}), ...(answers || {}) };
      a.routes = a.routes || {};
      const rt = a.routes[section] || (a.routes[section] = routeFor(T, section, all));
      const sc = scoreModules(T, section, all, rt.route);
      a.results[section] = { ...sc, route: rt.route, routerPct: rt.pct, answers: all };
      recompute(a); saveAttempt(a); return send(res, 200, { right: sc.right, total: sc.total, band: a.bands[section], route: rt.route });
    }
    if (act === 'build' && m === 'POST') {
      const { answers } = await readJson(req); a = getAttempt(g[1]); let right = 0; const detail = {};
      for (const it of T.test.writing.build.items) {
        const given = (answers || {})[it.id] || '', ok = T.buildKey[it.id].some(x => S.norm(x) === S.norm(given));
        if (ok) right++; detail[it.id] = { given, correct: T.buildKey[it.id][0], ok, q: it.context };
      }
      rec(a, 'results', 'writing', 'x'); delete a.results.writing.x;
      a.results.writing.build = { right, total: T.test.writing.build.items.length, detail };
      recompute(a); saveAttempt(a); return send(res, 200, { right, total: a.results.writing.build.total });
    }
    if (act === 'recording' && m === 'POST') {
      const item = url.searchParams.get('item') || ''; if (!/^[a-z0-9_]+$/i.test(item)) return send(res, 400, { error: 'bad item' });
      const ct = req.headers['content-type'] || 'audio/webm';
      const ext = ct.includes('mp4') ? 'mp4' : ct.includes('ogg') ? 'ogg' : ct.includes('wav') ? 'wav' : 'webm';
      const dir = path.join(DATA, 'recordings', a.id); fs.mkdirSync(dir, { recursive: true });
      const body = await readBody(req); fs.writeFileSync(path.join(dir, `${item}.${ext}`), body);
      return send(res, 200, { saved: item, bytes: body.length });
    }
    if (act === 'judge-speaking' && m === 'POST') {
      const { task } = await readJson(req); a = getAttempt(g[1]); // 'repeat' | 'interview'
      const def = T.speakDef[task]; if (!def) return send(res, 400, { error: 'bad task' });
      const items = def.items.filter(it => recFile(a.id, it.id));
      if (!items.length) return send(res, 400, { error: 'No recordings saved for this task.' });
      const parts = [{ text: task === 'repeat' ? P.repeatPrompt(items) : P.interviewPrompt(items) }];
      for (const it of items) { parts.push({ text: `Clip for [${it.id}]:` }); parts.push(await audioPart(recFile(a.id, it.id))); }
      try {
        const r = await judge(parts);
        const b = getAttempt(a.id); // re-read: other judge calls may have saved while we waited
        rec(b, 'results', 'speaking', task, 'x'); delete b.results.speaking[task].x;
        b.results.speaking[task] = { judged: r.json, model: r.model, raw: r.raw, items: items.map(i => i.id), error: null };
        recompute(b); saveAttempt(b); return send(res, 200, { judged: r.json, model: r.model, bands: b.bands });
      } catch (e) {
        const b = getAttempt(a.id); b.results.speaking = b.results.speaking || {}; b.results.speaking[task] = { ...(b.results.speaking[task] || {}), error: e.message };
        saveAttempt(b); return send(res, 502, { error: e.message, retry: true });
      }
    }
    if (act === 'judge-writing' && m === 'POST') {
      const { task, text } = await readJson(req); a = getAttempt(g[1]); const def = T.full[task]; if (!def) return send(res, 400, { error: 'bad task' });
      a.results.writing = a.results.writing || {};
      a.results.writing[task] = { ...(a.results.writing[task] || {}), text }; saveAttempt(a); // never lose the text
      try {
        const r = await judge([{ text: P.writingPrompt(task, def, text || '') }]);
        const b = getAttempt(a.id);
        b.results.writing[task] = { text, judged: r.json, model: r.model, raw: r.raw, error: null };
        recompute(b); saveAttempt(b); return send(res, 200, { judged: r.json, model: r.model, bands: b.bands });
      } catch (e) { const b = getAttempt(a.id); b.results.writing[task].error = e.message; saveAttempt(b); return send(res, 502, { error: e.message, retry: true }); }
    }
    if (act === 'finalize' && m === 'POST') { recompute(a); a.finishedAt = new Date().toISOString(); saveAttempt(a); return send(res, 200, { bands: a.bands, overall: a.overall, approx120: a.approx120 }); }
  }
  return send(res, 404, { error: 'not found' });
}

function serveFile(res, f) {
  fs.readFile(f, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(buf);
  });
}
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (url.pathname.startsWith('/audio/')) {
      const f = path.normalize(path.join(DATA, url.pathname));
      if (!f.startsWith(path.join(DATA, 'audio'))) { res.writeHead(403); return res.end(); }
      return serveFile(res, f);
    }
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const f = path.normalize(path.join(ROOT, 'public', rel));
    if (!f.startsWith(path.join(ROOT, 'public'))) { res.writeHead(403); return res.end(); }
    return serveFile(res, f);
  } catch (e) { console.error('error', req.method, url.pathname, e.message); if (!res.headersSent) send(res, 500, { error: e.message }); }
}).listen(PORT, () => console.log(`TOEFL prep on http://localhost:${PORT}`));
