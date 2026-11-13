#!/usr/bin/env node
// Usage: node scripts/gen-audio.js <testId> [--force] [--keep-fallback] [--concurrency N]
// Builds data/audio/<testId>/<id>.wav from the "audio" map in data/tests/<testId>.json.
// Skips clips that exist and whose text is unchanged. Rebuilds clips that fell back to macOS `say`
// on an earlier run (unless --keep-fallback). Retries Gemini with backoff on 429 and 5xx.
// State per clip lives in data/audio/<testId>/_manifest.json ({ hash, src }).
const fs = require('fs'), path = require('path'), crypto = require('crypto'), { execFileSync } = require('child_process');
require('../lib/env').loadEnv();
const { tts } = require('../lib/gemini');
const args = process.argv.slice(2);
const testId = args.find(a => !a.startsWith('--') && !/^\d+$/.test(a)) || 'test1';
const force = args.includes('--force'), keepFallback = args.includes('--keep-fallback');
const ci = args.indexOf('--concurrency'), CONC = ci >= 0 ? Math.max(1, Number(args[ci + 1]) || 2) : 2;
const root = path.join(__dirname, '..');
const test = JSON.parse(fs.readFileSync(path.join(root, 'data/tests', testId + '.json'), 'utf8'));
const outDir = path.join(root, 'data/audio', testId);
fs.mkdirSync(outDir, { recursive: true });
const RATE = 24000, TRIES = 6;
const SAY_VOICE = { Kore: 'Samantha', Aoede: 'Karen', Leda: 'Moira', Puck: 'Daniel', Fenrir: 'Alex', Charon: 'Fred', Orus: 'Tom', Zephyr: 'Oliver' };
const MANIFEST = path.join(outDir, '_manifest.json');
const manifest = (() => { try { return JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); } catch { return {}; } })();
const saveManifest = () => { fs.writeFileSync(MANIFEST + '.tmp', JSON.stringify(manifest, null, 2)); fs.renameSync(MANIFEST + '.tmp', MANIFEST); };
const hashOf = def => crypto.createHash('sha1').update(JSON.stringify(def.lines)).digest('hex').slice(0, 12);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const stats = { gemini: 0, say: 0, skipped: 0, failed: 0 }, fellBack = [];

function wav(pcm) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
function sayFallback(text, voice, id) {
  const tmp = path.join(outDir, `_tmp_${id}.aiff`), tmpw = path.join(outDir, `_tmp_${id}.wav`);
  execFileSync('say', ['-v', SAY_VOICE[voice] || 'Samantha', '-o', tmp, text]);
  execFileSync('afconvert', ['-f', 'WAVE', '-d', `LEI16@${RATE}`, '-c', '1', tmp, tmpw]);
  const b = fs.readFileSync(tmpw); fs.unlinkSync(tmp); fs.unlinkSync(tmpw);
  const i = b.indexOf('data'); return b.slice(i + 8);
}
async function line(l, id, n) {
  for (let a = 1; a <= TRIES; a++) {
    try { return { pcm: await tts(l.t, l.v), src: 'gemini' }; }
    catch (e) {
      const msg = String(e.message || e), limited = e.status === 429 || /429|quota|rate/i.test(msg);
      const hint = msg.match(/retry in ([\d.]+)s/i);
      const wait = Math.min(90000, hint ? Number(hint[1]) * 1000 + 500 : (limited ? 4000 : 1500) * 2 ** (a - 1)) + Math.random() * 500;
      console.error(`  ${id} line ${n}: try ${a}/${TRIES} failed (${limited ? 'rate limit' : msg.slice(0, 80)}), waiting ${(wait / 1000).toFixed(1)}s`);
      if (a < TRIES) await sleep(wait);
    }
  }
  return { pcm: sayFallback(l.t, l.v, id), src: 'say' };
}
async function build(id, def) {
  const f = path.join(outDir, id + '.wav'), hash = hashOf(def), m = manifest[id];
  const exists = fs.existsSync(f) && fs.statSync(f).size > 1000;
  const stale = m && m.hash !== hash, wasSay = m && m.src !== 'gemini' && !keepFallback;
  if (!force && exists && !stale && !wasSay) {
    if (!m) { manifest[id] = { hash, src: 'unknown' }; saveManifest(); } // adopt clips made before the manifest existed
    stats.skipped++; return;
  }
  try {
    const gap = Buffer.alloc(Math.round(RATE * 0.45) * 2), parts = [], srcs = [];
    for (const [n, l] of def.lines.entries()) { const r = await line(l, id, n + 1); srcs.push(r.src); parts.push(r.pcm, gap); }
    const pcm = Buffer.concat(parts), says = srcs.filter(s => s === 'say').length;
    fs.writeFileSync(f + '.tmp', wav(pcm)); fs.renameSync(f + '.tmp', f);
    manifest[id] = { hash, src: says ? 'say' : 'gemini' }; saveManifest();
    if (says) { stats.say++; fellBack.push(id); console.warn(`WARNING ${id}: ${says} of ${srcs.length} lines used macOS say (low quality). Rerun later to retry Gemini.`); }
    else stats.gemini++;
    console.log(`ok ${id} ${(pcm.length / RATE / 2).toFixed(1)}s [${says ? 'say' : 'gemini'}]`);
  } catch (e) { stats.failed++; console.error(`FAILED ${id}: ${e.message}`); }
}
(async () => {
  const ids = Object.keys(test.audio || {}); let i = 0;
  await Promise.all(Array.from({ length: CONC }, async () => { while (i < ids.length) { const id = ids[i++]; await build(id, test.audio[id]); } }));
  console.log(`done ${testId}: ${ids.length} clips. Gemini ${stats.gemini} new, skipped ${stats.skipped} (already built), say fallback ${stats.say}, failed ${stats.failed}.`);
  if (fellBack.length) console.warn(`Fallback clips (bad quality, rebuilt on next run): ${fellBack.join(', ')}`);
  process.exit(stats.failed ? 1 : 0);
})();
