// Test file checker. Rules: data/tests/SCHEMA.md.
// CLI: node lib/validate.js <testId>   (exit 1 on errors)
// A test with "mock": true gets count problems as warnings, not errors.
const fs = require('fs'), path = require('path');

const VOICES = ['Kore', 'Aoede', 'Leda', 'Puck', 'Fenrir', 'Charon', 'Orus', 'Zephyr'];
const TYPES = { reading: ['ctw', 'daily', 'academic'], listening: ['choose', 'conversation', 'announcement', 'talk'] };
// Required item counts per stage. Listening choose items count one each; other tasks count their questions.
const COUNTS = {
  reading: { stage1: { ctw: 20, daily: 5, academic: 5, total: 30 }, module: { ctw: 10, daily: 5, academic: 5, total: 20 } },
  listening: { stage1: { choose: 10, conversation: 6, announcement: 4, talk: 8, total: 28 }, module: { choose: 6, conversation: 4, announcement: 3, talk: 6, total: 19 } },
};
const CEFR = { stage1: 'A2-C1', lower: 'A1-B1', upper: 'B2-C2' };
// Spoken-word budget per listening stage (about 150 words per minute), so audio leaves time to answer.
const WORDS = { stage1: 1500, lower: 650, upper: 1050 };
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9' ]/g, ' ').replace(/\s+/g, ' ').trim();

function validate(t, { audioDir } = {}) {
  const errors = [], warnings = [], info = [], ids = new Set();
  const err = m => errors.push(m), warn = m => warnings.push(m), count = m => (t.mock ? warn : err)(m);
  const id = (x, where) => { if (!x || !/^[a-z0-9_]+$/i.test(x)) err(`${where}: bad id "${x}"`); else if (ids.has(x)) err(`${where}: duplicate id "${x}"`); else ids.add(x); };
  const audioUsed = new Set();
  const useAudio = (k, where) => { if (!k) return err(`${where}: missing "audio"`); audioUsed.add(k); if (!t.audio || !t.audio[k]) err(`${where}: audio key "${k}" not in audio map`); };
  const num = (v, where) => { if (typeof v !== 'number' || v <= 0) err(`timings.${where} must be a positive number of minutes`); };

  if (!t.id || !t.title) err('missing id or title');
  const T = t.timings || {};
  for (const s of ['reading', 'listening']) for (const k of ['router', 'lower', 'upper']) num((T[s] || {})[k], `${s}.${k}`);
  for (const k of ['build', 'email', 'discussion']) num((T.writing || {})[k], `writing.${k}`);
  num(T.speaking, 'speaking');

  const bias = { n: 0, longest: 0, shortest: 0 }; // answer-length cue across all MCQs
  for (const sec of ['reading', 'listening']) {
    const positions = [0, 0, 0, 0]; let mcq = 0;
    const S = t[sec] || {};
    const mods = [['stage1', S.stage1], ['lower', (S.stage2 || {}).lower], ['upper', (S.stage2 || {}).upper]];
    for (const [stage, mod] of mods) {
      const where = `${sec}.${stage === 'stage1' ? 'stage1' : 'stage2.' + stage}`;
      if (!mod || !Array.isArray(mod.tasks)) { err(`${where}: missing module with "tasks"`); continue; }
      id(mod.id, where);
      if (mod.cefr !== CEFR[stage]) warn(`${where}: cefr should be "${CEFR[stage]}"`);
      const got = {}; let words = 0;
      for (const [ti, task] of mod.tasks.entries()) {
        const w = `${where}.tasks[${ti}]`;
        if (!TYPES[sec].includes(task.type)) { err(`${w}: type "${task.type}" not allowed in ${sec}`); continue; }
        if (!task.title) err(`${w}: missing title`);
        if (task.type === 'ctw') {
          const blanks = [...String(task.text || '').matchAll(/\{([a-z]+)\}/gi)].map(m => m[1]);
          if (!task.text) err(`${w}: missing text`);
          if (blanks.length !== 10) count(`${w}: has ${blanks.length} blanks, needs 10`);
          for (const b of blanks) if (b.length < 2) err(`${w}: blank "{${b}}" is too short (2+ letters)`);
          const first = String(task.text || '').split(/(?<=[.!?])\s+/)[0];
          if (/\{/.test(first)) warn(`${w}: first sentence should have no blanks`);
          got.ctw = (got.ctw || 0) + blanks.length; continue;
        }
        if (sec === 'reading' && !task.text) err(`${w}: missing text`);
        if (['conversation', 'announcement', 'talk'].includes(task.type)) useAudio(task.audio, w);
        if (!Array.isArray(task.items) || !task.items.length) { err(`${w}: missing items`); continue; }
        let run = 0, prev = -1;
        for (const it of task.items) {
          const wi = `${w} item ${it.id}`; id(it.id, wi);
          if (task.type === 'choose') useAudio(it.audio, wi);
          if (!it.q) err(`${wi}: missing q`);
          if (it.timeLimitS !== undefined && (!Number.isInteger(it.timeLimitS) || it.timeLimitS <= 0)) err(`${wi}: timeLimitS must be a positive integer (seconds)`);
          if (!Array.isArray(it.options) || it.options.length !== 4) err(`${wi}: needs exactly 4 options`);
          if (!Number.isInteger(it.answer) || it.answer < 0 || it.answer > 3) { err(`${wi}: answer must be 0, 1, 2 or 3`); continue; }
          positions[it.answer]++; mcq++;
          if (Array.isArray(it.options) && it.options.length === 4) {
            const L = it.options.map(o => String(o).length), k = L[it.answer], others = L.filter((_, j) => j !== it.answer);
            bias.n++; if (others.every(x => x < k)) bias.longest++; if (others.every(x => x > k)) bias.shortest++;
          }
          run = it.answer === prev ? run + 1 : 1; prev = it.answer;
          if (run === 3) warn(`${wi}: 3 answers in a row at the same position`);
        }
        got[task.type] = (got[task.type] || 0) + task.items.length;
      }
      if (sec === 'listening') for (const task of mod.tasks) {
        const keys = task.type === 'choose' ? (task.items || []).map(i => i.audio) : [task.audio];
        for (const k of keys) if (t.audio && t.audio[k]) words += t.audio[k].lines.reduce((n, l) => n + String(l.t).split(/\s+/).length, 0);
      }
      if (sec === 'listening' && words > WORDS[stage]) warn(`${where}: ${words} spoken words, budget ${WORDS[stage]} (audio may eat the answer time)`);
      const want = COUNTS[sec][stage === 'stage1' ? 'stage1' : 'module'];
      const total = Object.values(got).reduce((a, b) => a + b, 0);
      for (const [k, n] of Object.entries(want)) { const g = k === 'total' ? total : got[k] || 0; if (g !== n) count(`${where}: ${k} items ${g}, needs ${n}`); }
    }
    if (mcq) positions.forEach((n, i) => { const p = n / mcq; if (p < 0.15 || p > 0.35) count(`${sec}: answer ${'ABCD'[i]} is ${Math.round(100 * p)}% of ${mcq} MCQs (keep each 15-35%)`); });
  }

  if (bias.n) {
    const lp = Math.round(100 * bias.longest / bias.n), sp = Math.round(100 * bias.shortest / bias.n);
    info.push(`answer length: key is the unique longest option in ${lp}% and the unique shortest in ${sp}% of ${bias.n} MCQs`);
    if (lp > 30) warn(`answer length bias: key is the unique longest option in ${lp}% of MCQs (keep at most 30%)`);
    if (sp < 15) warn(`answer length bias: key is the unique shortest option in only ${sp}% of MCQs (keep at least 15%)`);
  }

  const W = t.writing || {}, B = W.build || {};
  if ((B.items || []).length !== 10) count(`writing.build: ${(B.items || []).length} items, needs 10`);
  for (const it of B.items || []) {
    id(it.id, 'writing.build'); if (!it.context || !Array.isArray(it.chunks) || !it.answer) { err(`writing.build ${it.id}: needs context, chunks, answer`); continue; }
    const pool = it.chunks.map(norm), ans = norm(it.answer); let rest = ans, used = 0;
    // greedy check: the answer must be built from the chunks, with at most 1 unused chunk (the distractor)
    const unused = [...pool].sort((a, b) => b.split(' ').length - a.split(' ').length).filter(c => { const re = new RegExp(`(^| )${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`); if (re.test(rest)) { rest = rest.replace(re, ' ').trim(); used++; return false; } return true; });
    if (rest) err(`writing.build ${it.id}: answer words "${rest}" are not in chunks`);
    if (unused.length > 1) err(`writing.build ${it.id}: ${unused.length} unused chunks (max 1 distractor)`);
    if (norm(it.chunks.join(' ')) === ans) warn(`writing.build ${it.id}: chunks are listed in answer order`);
  }
  if (!W.email || !W.email.prompt || !W.email.rubric) err('writing.email: needs prompt and rubric');
  const D = W.discussion;
  if (!D || !D.prompt || !D.rubric || !D.professor || !Array.isArray(D.students) || D.students.length !== 2) err('writing.discussion: needs prompt, rubric, professor, 2 students');

  const SP = t.speaking || {};
  for (const [k, n] of [['repeat', 7], ['interview', 4]]) {
    const d = SP[k];
    if (!d || !Array.isArray(d.items)) { err(`speaking.${k}: missing`); continue; }
    if (d.items.length !== n) count(`speaking.${k}: ${d.items.length} items, needs ${n}`);
    if (typeof d.maxSeconds !== 'number') err(`speaking.${k}: missing maxSeconds`);
    for (const it of d.items) { id(it.id, `speaking.${k}`); useAudio(it.audio, `speaking.${k} ${it.id}`); if (!it.text) err(`speaking.${k} ${it.id}: missing text`); }
  }

  for (const [k, a] of Object.entries(t.audio || {})) {
    if (!/^[a-z0-9_]+$/i.test(k)) err(`audio.${k}: bad key`);
    if (!a || !Array.isArray(a.lines) || !a.lines.length) { err(`audio.${k}: needs lines`); continue; }
    for (const l of a.lines) { if (!l.t) err(`audio.${k}: line without t`); if (!VOICES.includes(l.v)) err(`audio.${k}: voice "${l.v}" not in ${VOICES.join(', ')}`); }
    if (!audioUsed.has(k)) warn(`audio.${k}: not used by any item`);
    if (audioDir && fs.existsSync(audioDir) && !fs.existsSync(path.join(audioDir, k + '.wav'))) warn(`audio.${k}: no wav yet (run gen-audio)`);
  }
  return { errors, warnings, info };
}

module.exports = { validate, COUNTS, CEFR, VOICES };

if (require.main === module) {
  const id = process.argv[2] || 'test1', root = path.join(__dirname, '..');
  const t = JSON.parse(fs.readFileSync(path.join(root, 'data/tests', id + '.json'), 'utf8'));
  const { errors, warnings, info } = validate(t, { audioDir: path.join(root, 'data/audio', id) });
  for (const m of info) console.log('info:', m);
  for (const w of warnings) console.log('warning:', w);
  for (const e of errors) console.log('ERROR:', e);
  console.log(`${id}: ${errors.length} errors, ${warnings.length} warnings${t.mock ? ' (mock test: count rules are warnings)' : ''}`);
  process.exit(errors.length ? 1 : 0);
}
