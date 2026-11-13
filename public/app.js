// TOEFL Prep frontend. Vanilla JS, no build step.
const $app = document.getElementById('app');
const h = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const api = async (path, opt = {}) => {
  const r = await fetch('/api' + path, opt.body !== undefined && typeof opt.body !== 'string' && !(opt.body instanceof Blob) ? { ...opt, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(opt.body) } : opt);
  const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.error || r.status), { data: j }); return j;
};
const post = (p, body) => api(p, { method: 'POST', body });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SEC = { reading: 'Reading', listening: 'Listening', writing: 'Writing', speaking: 'Speaking' };
const inflight = new Set();
let exam = null; // active exam context
let qtOn = false; // true while a per-question countdown owns the timer element

// ---------------- router ----------------
window.addEventListener('hashchange', route);
window.addEventListener('beforeunload', e => { if (exam) { e.preventDefault(); e.returnValue = ''; } });
async function route() {
  const [, page, arg] = location.hash.split('/');
  if (exam) return;
  if (page === 'results') return results(arg);
  return home();
}

// ---------------- home ----------------
async function home() {
  const [settings, tests, hist] = await Promise.all([api('/settings'), api('/tests'), api('/history')]);
  const days = settings.testDate ? Math.ceil((new Date(settings.testDate) - new Date()) / 864e5) : null;
  $app.innerHTML = `<div class="wrap">
  <h1>TOEFL iBT Practice</h1><p class="mut">New 2026 format. Timed, one try, then honest feedback.</p>
  <div class="card"><h2>Settings</h2><div class="row">
    <label>Test date <input type="date" id="sd" value="${h(settings.testDate)}"></label>
    <label>Target overall band <select id="st">${[3, 3.5, 4, 4.5, 5, 5.5, 6].map(b => `<option ${b == settings.targetBand ? 'selected' : ''}>${b}</option>`).join('')}</select></label>
    <button id="ss" class="sec">Save</button><span id="sm" class="mut small">${days != null ? (days >= 0 ? days + ' days to your test' : 'test date has passed') : 'No test date set'}</span></div></div>
  <div class="card prep row"><div class="grow"><b>Before you start: read this</b><div class="small mut">How each section works, the timers, and what you cannot undo.</div></div><a class="btn" id="prep" href="/prep.html">Read this first</a></div>
  <div class="card"><h2>Tests</h2>${tests.map(t => `<div class="row" style="margin:10px 0;padding-bottom:10px;border-bottom:1px solid var(--line)">
    <div class="grow"><b>${h(t.title)}</b><div class="small mut">Reading ${t.minutes.reading} min, Listening ${t.minutes.listening} min, Writing ${t.minutes.writing} min, Speaking ${t.minutes.speaking} min</div></div>
    <button data-full="${t.id}">Start full exam</button>
    ${Object.keys(SEC).map(s => `<button class="sec" data-prac="${t.id}:${s}">${SEC[s]}</button>`).join('')}</div>`).join('')}
    <p class="small mut">Full exam: sections run in order, with no pause. Use headphones and a quiet room.</p></div>
  <div class="card"><h2>History</h2>${hist.length ? `<table><tr><th>Date</th><th>Test</th><th>Mode</th><th>R</th><th>L</th><th>W</th><th>S</th><th>Overall</th><th></th></tr>${hist.map(a => `<tr><td>${new Date(a.createdAt).toLocaleString()}</td><td>${h(a.testId)}</td><td>${a.mode === 'exam' ? 'Full' : h(a.sections.join(', '))}</td>${['reading', 'listening', 'writing', 'speaking'].map(k => `<td>${a.bands[k] ?? '-'}</td>`).join('')}<td><b>${a.overall ?? '-'}</b></td><td><a href="#/results/${a.id}">Results</a></td></tr>`).join('')}</table>` : '<p class="mut">No attempts yet.</p>'}</div></div>`;
  document.getElementById('ss').onclick = async () => {
    await api('/settings', { method: 'PUT', body: { testDate: sd.value, targetBand: st.value } }); sm.textContent = 'Saved'; };
  document.querySelectorAll('[data-full]').forEach(b => b.onclick = () => runExam(b.dataset.full, Object.keys(SEC), 'exam'));
  document.querySelectorAll('[data-prac]').forEach(b => b.onclick = () => { const [t, s] = b.dataset.prac.split(':'); runExam(t, [s], 'practice'); });
}

// ---------------- exam engine ----------------
function shell(title, { timer = true, back = false } = {}) {
  $app.innerHTML = `<div class="exam"><div class="bar"><span class="t">TOEFL iBT</span><span>${h(title)}</span><span class="sp"></span>${timer ? '<span class="timer" id="tm">--:--</span>' : ''}<button id="fs" title="Toggle fullscreen">Fullscreen</button>${back ? '<button id="back">Back</button>' : ''}<button id="next">Next</button></div><div class="body" id="body"></div></div>`;
  document.getElementById('fs').onclick = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => {});
  return { body: document.getElementById('body'), next: document.getElementById('next'), back: document.getElementById('back') };
}
function waitNext(btn, label = 'Next') { btn.textContent = label; return new Promise(r => { btn.onclick = () => r(); }); }
function startTimer(mins, onExpire) {
  const end = Date.now() + mins * 60000, lowAt = mins >= 15 ? 300 : 60; let done = false;
  const tick = () => { const left = Math.max(0, Math.round((end - Date.now()) / 1000)); const el = document.getElementById('tm');
    if (el && !qtOn) { el.textContent = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`; el.classList.toggle('low', left <= lowAt); }
    if (left <= 0 && !done) { done = true; clearInterval(iv); onExpire(); } };
  const iv = setInterval(tick, 500); tick();
  return { stop: () => { done = true; clearInterval(iv); }, get expired() { return done; } };
}
const TM = () => exam.test.timings;
const sumMods = s => `Module 1: ${TM()[s].router} min. Module 2: ${TM()[s].lower === TM()[s].upper ? TM()[s].lower : TM()[s].lower + ' or ' + TM()[s].upper} min`;
async function runExam(testId, sections, mode) {
  const test = await api('/test/' + testId);
  const { id } = await post('/attempt', { testId, mode, sections });
  exam = { id, test, sections, answers: {}, uploads: [], order: {} };
  if (mode === 'exam') document.documentElement.requestFullscreen().catch(() => {});
  try {
    for (const s of sections) { await intro(s); await ({ reading: runReading, listening: runListening, speaking: runSpeaking, writing: runWriting }[s])(); }
    await post(`/attempt/${id}/finalize`, {});
  } catch (e) { console.error(e); alert('Exam error: ' + e.message + '. Your saved work stays on the server.'); }
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  const done = exam.id; exam = null; location.hash = '#/results/' + done; route();
}
async function intro(s) {
  const T = TM(), sp = exam.test.speaking;
  const time = { reading: sumMods('reading'), listening: sumMods('listening'), writing: `Build a Sentence ${T.writing.build} min, Email ${T.writing.email} min, Discussion ${T.writing.discussion} min`, speaking: `About ${T.speaking} minutes` }[s];
  const rules = { reading: 'Complete the Words, Read in Daily Life, Read an Academic Passage. Each module has its own clock. You can use Back inside a module. You cannot return to Module 1 once Module 2 begins. Your Module 1 score sets the difficulty of Module 2.',
    listening: 'Listen and Choose a Response, Conversations, Announcements, Academic Talks. Each audio plays once only. You cannot replay it. Questions appear one at a time, each with its own countdown. When it reaches zero, the next question starts with no answer. You cannot return to previous questions. Your Module 1 score sets the difficulty of Module 2.',
    speaking: `Listen and Repeat (${sp.repeat.items.length} sentences, ${sp.repeat.maxSeconds} s each), then Take an Interview (${sp.interview.items.length} questions, ${sp.interview.maxSeconds} s each). No preparation time. Speak clearly into the microphone.`,
    writing: 'Build a Sentence (10), Write an Email, Write for an Academic Discussion. Each task has its own clock. When a clock ends, the next task starts.' }[s];
  const { body, next } = shell(SEC[s] + ' section', { timer: false });
  body.innerHTML = `<div class="center"><h1>${SEC[s]} section</h1><p>Time: <b>${h(time)}</b>. The clock cannot be paused.</p><p>${h(rules)}</p>
    ${s === 'speaking' ? '<p class="warn">Next you will check your microphone.</p>' : ''}</div>`;
  await waitNext(next, 'Begin');
}
// One fixed shuffle per item per attempt, so Back shows the same order.
function orderFor(key, n) { return exam.order[key] || (exam.order[key] = shufIdx(n)); }
function mcqHtml(it, idx) {
  return `<div class="q"><p>${idx != null ? idx + '. ' : ''}${h(it.q)}</p>${orderFor(it.id, it.options.length).map(i => `<label class="opt"><input type="radio" name="${it.id}" value="${i}"><span>${h(it.options[i])}</span></label>`).join('')}</div>`;
}
function collect(root, answers) {
  root.querySelectorAll('input[type=radio]:checked').forEach(r => answers[r.name] = Number(r.value));
  root.querySelectorAll('input[data-blank]').forEach(i => answers[i.dataset.blank] = i.value.trim());
}
function restore(root, answers) {
  root.querySelectorAll('input[type=radio]').forEach(r => { if (answers[r.name] === Number(r.value)) r.checked = true; });
  root.querySelectorAll('input[data-blank]').forEach(i => { if (answers[i.dataset.blank] != null) i.value = answers[i.dataset.blank]; });
}
// Runs one timed module. Pages: array of render functions. Resolves when the last page is done or the clock ends.
function timedModule({ title, mins, pages, back, lastLabel, onLeave = () => {}, onShow = () => {} }) {
  const { body, next, back: bk } = shell(title, { back }), answers = exam.cur;
  return new Promise(resolve => {
    let i = 0, over = false;
    const leave = () => { onLeave(); collect(body, answers); };
    const finish = () => { if (over) return; over = true; tm.stop(); leave(); next.disabled = false; resolve(); };
    const tm = startTimer(mins, finish);
    const show = () => { body.innerHTML = pages[i].html(); restore(body, answers); body.scrollTop = 0;
      next.textContent = i === pages.length - 1 ? lastLabel : 'Next'; next.disabled = false; if (bk) bk.disabled = i === 0; onShow(pages[i], body, next); };
    next.onclick = () => { if (over || next.disabled) return; leave(); if (i === pages.length - 1) finish(); else { i++; show(); } };
    if (bk) bk.onclick = () => { if (over || i === 0) return; leave(); i--; show(); };
    show();
  });
}
async function adaptive(section, label, pagesFor, opts = {}) {
  exam.cur = {};
  await timedModule({ title: label + ': Module 1', mins: TM()[section].router, pages: pagesFor(exam.test[section].stage1), lastLabel: 'Finish Module 1', ...opts });
  const r = await post(`/attempt/${exam.id}/route`, { section, answers: exam.cur });
  const { body, next } = shell(label, { timer: false });
  body.innerHTML = `<div class="center"><h2>Module 1 is complete</h2><p>Module 2 has its own clock: <b>${TM()[section][r.route]} minutes</b>. You cannot return to Module 1.</p></div>`;
  await waitNext(next, 'Begin Module 2');
  await timedModule({ title: label + ': Module 2', mins: TM()[section][r.route], pages: pagesFor(r.module), lastLabel: 'Finish section', ...opts });
  await post(`/attempt/${exam.id}/objective`, { section, answers: exam.cur });
}

// ---- reading ----
function ctwHtml(task) {
  return `<div class="center"><h2>${h(task.title)}</h2><p class="mut small">${h(task.instructions || 'Type the missing letters to complete the text.')}</p><p class="passage">${task.segments.map(s => s.blank ? `<span class="blank">${h(s.prefix)}<input data-blank="${s.blank}" maxlength="${s.len}" size="${s.len}" autocomplete="off" spellcheck="false"></span>` : h(s.text)).join('')}</p></div>`;
}
const readingPages = mod => mod.tasks.map(task => ({ html: () => task.type === 'ctw' ? ctwHtml(task)
  : `<div class="split"><div><h3>${h(task.title)}</h3><div class="passage">${h(task.text)}</div></div><div>${task.items.map((it, k) => mcqHtml(it, k + 1)).join('')}</div></div>` }));
const runReading = () => adaptive('reading', 'Reading', readingPages, { back: true });

// ---- listening ----
function playOnce(src, holder, onEnd) {
  const a = new Audio(src); let started = false, ended = false;
  const end = () => { if (ended) return; ended = true; onEnd(); };
  holder.innerHTML = '<div class="small mut">Audio plays once. You cannot replay it.</div><div id="ast" class="warn small">Playing...</div><button id="aplay" class="sec" style="display:none">Play audio (one time only)</button>';
  const st = holder.querySelector('#ast'), pb = holder.querySelector('#aplay');
  a.onended = () => { st.textContent = 'Audio finished.'; st.className = 'good small'; end(); };
  a.onerror = () => { st.textContent = 'Audio failed to load.'; end(); };
  const go = () => { if (started) return; started = true; pb.style.display = 'none'; st.textContent = 'Playing...'; a.play().catch(() => { started = false; st.textContent = 'Click to start the audio.'; pb.style.display = ''; }); };
  pb.onclick = go; go();
  return () => { a.pause(); a.onended = a.onerror = null; };
}
// One question per page, in order, no Back. Audio plays once per task (on its first question only).
// Answer time per question: timeLimitS in the test JSON, else 20 s (choose, conversation) or 30 s (announcement, talk).
const LIMIT_S = { choose: 20, conversation: 20, announcement: 30, talk: 30 };
const listeningPages = mod => mod.tasks.flatMap(task => task.items.map((it, k) => {
  const first = task.type === 'choose' || k === 0, many = task.type !== 'choose' && task.items.length > 1;
  return { audio: first ? (task.type === 'choose' ? it.audio : task.audio) : null, limit: it.timeLimitS || LIMIT_S[task.type] || 20,
    html: () => `<div class="center"><h3>${h(task.title)}${many ? ` <span class="mut small">Question ${k + 1} of ${task.items.length}</span>` : ''}</h3><div id="ah"></div><div id="qs" style="margin-top:18px;display:none">${mcqHtml(it, null)}</div></div>` };
}));
function runListening() {
  let stopAudio = () => {}, qt = null;
  const clearQ = () => { if (qt) { clearInterval(qt); qt = null; } qtOn = false; }; // always clear on page change: no double advance
  return adaptive('listening', 'Listening', listeningPages, {
    onLeave: () => { stopAudio(); stopAudio = () => {}; clearQ(); },
    onShow: (pg, body, next) => {
      clearQ(); stopAudio = () => {};
      const reveal = () => { // question appears: clock starts now
        const q = body.querySelector('#qs'); if (q) q.style.display = ''; next.disabled = false;
        const end = Date.now() + pg.limit * 1000; qtOn = true;
        const tick = () => { const left = Math.max(0, Math.ceil((end - Date.now()) / 1000)), el = document.getElementById('tm');
          if (el) { el.textContent = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`; el.classList.toggle('low', left <= 5); }
          if (left <= 0) { clearQ(); body.querySelectorAll('input[type=radio]').forEach(r => r.checked = false); next.onclick(); } }; // time up: no answer recorded
        qt = setInterval(tick, 250); tick();
      };
      if (!pg.audio) return reveal();
      next.disabled = true; // questions stay hidden until the audio ends
      stopAudio = playOnce('/audio/' + exam.test.id + '/' + pg.audio + '.wav', body.querySelector('#ah'), reveal);
    },
  });
}

// ---- speaking ----
const SPEAK_BUFFER_S = 3; // seconds of pause after each speaking prompt, before the beep. Response clock starts after the beep.
const recMime = () => ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find(t => MediaRecorder.isTypeSupported(t)) || '';
function beep() { const c = new AudioContext(), o = c.createOscillator(), g = c.createGain(); o.frequency.value = 880; g.gain.value = .2; o.connect(g); g.connect(c.destination); o.start(); setTimeout(() => { o.stop(); c.close(); }, 300); return sleep(450); }
async function getStream() { return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false } }); }
function shufIdx(n) { const a = [...Array(n).keys()]; for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function startRec(stream) {
  const mr = new MediaRecorder(stream, recMime() ? { mimeType: recMime() } : {}), chunks = [];
  mr.ondataavailable = e => e.data.size && chunks.push(e.data);
  const done = new Promise(r => mr.onstop = () => r(new Blob(chunks, { type: mr.mimeType || 'audio/webm' })));
  mr.start(250); return { done, stop: () => { if (mr.state !== 'inactive') mr.stop(); return done; } };
}
function level(stream, el) {
  const c = new AudioContext(), an = c.createAnalyser(), d = new Uint8Array(an.fftSize); c.createMediaStreamSource(stream).connect(an); let on = true;
  (function f() { if (!on) return; an.getByteTimeDomainData(d); let m = 0; for (const v of d) m = Math.max(m, Math.abs(v - 128)); el.style.width = Math.min(100, m / 80 * 100) + '%'; requestAnimationFrame(f); })();
  return () => { on = false; c.close(); };
}
async function micCheck(body, next) {
  let stream, ok = false;
  while (!ok) {
    body.innerHTML = `<div class="center"><h1>Microphone check</h1><p>Allow microphone access. Then record 5 seconds and play it back. Speak at the volume you will use in the test.</p>
      <div class="meter"><i id="mt"></i></div><p id="ms" class="mut">Waiting for permission...</p><div class="row"><button id="mr">Record 5 s test clip</button><audio id="mp" controls style="display:none"></audio></div></div>`;
    next.disabled = true;
    try { stream = await getStream(); } catch (e) { document.getElementById('ms').innerHTML = `<span class="bad">Microphone blocked: ${h(e.message)}. Allow it in the browser and retry.</span>`; next.textContent = 'Retry'; next.disabled = false; await waitNext(next, 'Retry'); continue; }
    const stop = level(stream, document.getElementById('mt')); document.getElementById('ms').textContent = 'Microphone ready.';
    await new Promise(res => { document.getElementById('mr').onclick = async () => {
      const b = document.getElementById('mr'); b.disabled = true; const r = startRec(stream); let s = 5; b.textContent = 'Recording ' + s; const iv = setInterval(() => { s--; b.textContent = 'Recording ' + s; }, 1000);
      await sleep(5000); clearInterval(iv); const blob = await r.stop(); const p = document.getElementById('mp'); p.src = URL.createObjectURL(blob); p.style.display = ''; p.play(); b.textContent = 'Record again'; b.disabled = false;
      document.getElementById('ms').innerHTML = 'Did you hear yourself clearly? If yes, continue.'; next.disabled = false; next.textContent = 'Sounds good, continue'; res(); }; });
    await waitNext(next, 'Sounds good, continue'); stop(); ok = true;
  }
  return stream;
}
async function upload(item, blob) {
  const send = () => fetch(`/api/attempt/${exam.id}/recording?item=${item}`, { method: 'POST', headers: { 'Content-Type': blob.type || 'audio/webm' }, body: blob }).then(r => { if (!r.ok) throw new Error('upload ' + r.status); });
  try { await send(); } catch { exam.uploads.push({ item, blob, send }); }
}
async function runSpeaking() {
  const { body, next } = shell('Speaking'); const stream = await micCheck(body, next); next.disabled = false;
  let cur = null, expired = false;
  const tm = startTimer(TM().speaking, () => { expired = true; if (cur) cur.stop(); });
  for (const task of ['repeat', 'interview']) {
    if (expired) break;
    const def = exam.test.speaking[task];
    body.innerHTML = `<div class="center"><h1>${h(def.title)}</h1><p>${h(def.instructions)}</p>${def.context ? `<p class="passage" style="font-size:1rem">${h(def.context)}</p>` : ''}<p class="small mut">Response time: ${def.maxSeconds} seconds per item. No preparation time.</p></div>`; next.disabled = false; await waitNext(next, 'Start');
    for (const [i, it] of def.items.entries()) {
      if (expired) break;
      body.innerHTML = `<div class="center"><h3>${h(def.title)}: ${i + 1} of ${def.items.length}</h3>${def.context ? `<p class="small mut">${h(def.context)}</p>` : ''}<p id="st" class="warn">Listen...</p><div class="meter"><i id="mt"></i></div><p id="cd" class="mut"></p></div>`;
      next.disabled = true; next.textContent = 'Done';
      await new Promise(res => { const a = new Audio(`/audio/${exam.test.id}/${it.audio}.wav`); a.onended = res; a.onerror = res; a.play().catch(res); });
      for (let s = SPEAK_BUFFER_S; s > 0 && !expired; s--) { document.getElementById('st').textContent = `Get ready... recording starts in ${s}`; await sleep(1000); } // pause between prompt and beep, like the real test
      if (expired) break;
      await beep(); const stopLvl = level(stream, document.getElementById('mt'));
      document.getElementById('st').innerHTML = '<span class="rec"><span class="dot"></span> Recording. Speak now.</span>';
      const r = startRec(stream); cur = r; let left = it.seconds || def.maxSeconds; const cd = document.getElementById('cd'); cd.textContent = `Time left: ${left} s`;
      const iv = setInterval(() => { left--; cd.textContent = `Time left: ${left} s`; if (left <= 0) r.stop(); }, 1000);
      next.disabled = false; next.onclick = () => r.stop();
      const blob = await r.done; clearInterval(iv); stopLvl(); cur = null; next.disabled = true; // await r.done: never stop early
      document.getElementById('st').textContent = 'Saved.'; await upload(it.id, blob);
    }
  }
  tm.stop(); stream.getTracks().forEach(t => t.stop());
  body.innerHTML = '<div class="center"><h2>Saving your recordings...</h2></div>';
  for (let n = 0; n < 4 && exam.uploads.length; n++) { const q = exam.uploads.splice(0); for (const u of q) { try { await u.send(); } catch { exam.uploads.push(u); } } if (exam.uploads.length) await sleep(1500); }
  if (exam.uploads.length) alert(`${exam.uploads.length} recording(s) failed to upload. They stay in this tab until you reload.`);
  next.disabled = false; judgeSpeaking(exam.id);
}
function judgeSpeaking(id) { for (const t of ['repeat', 'interview']) judgeCall(id, 'speaking-' + t, `/attempt/${id}/judge-speaking`, { task: t }); }
function judgeCall(id, key, path, body) {
  const k = id + ':' + key; if (inflight.has(k)) return; inflight.add(k);
  return post(path, body).catch(e => ({ error: e.message })).finally(() => { inflight.delete(k); if (location.hash === '#/results/' + id && !exam) results(id, true); });
}

// ---- writing ----
// Each task has its own clock (ETS). Leftover time does not carry over.
async function runWriting() {
  const { body, next } = shell('Writing'); const W = exam.test.writing, T = TM().writing; const bAns = {}, texts = { email: '', discussion: '' };
  const timed = (mins, label, cap) => new Promise(res => { let done = false; const end = () => { if (done) return; done = true; tm.stop(); cap(); res(); };
    const tm = startTimer(mins, end); next.textContent = label; next.disabled = false; next.onclick = end; });
  body.innerHTML = `<div class="center"><h2>${h(W.build.title)}</h2><p class="mut small">${h(W.build.instructions)} Click a box to place it. Click a placed box to remove it.</p>${W.build.items.map((it, n) => `<div class="q" data-b="${it.id}"><p>${n + 1}. ${h(it.context)}</p><div class="slotrow">${it.before ? `<span>${h(it.before)}</span>` : ''}<div class="slot"></div>${it.after ? `<span>${h(it.after)}</span>` : ''}</div><div class="bank">${orderFor('b:' + it.id, it.chunks.length).map(i => `<span class="chip" data-i="${i}">${h(it.chunks[i])}</span>`).join('')}</div></div>`).join('')}</div>`;
  const sync = () => body.querySelectorAll('[data-b]').forEach(q => { bAns[q.dataset.b] = [...q.querySelectorAll('.slot .chip')].map(c => c.textContent).join(' '); });
  body.querySelectorAll('[data-b]').forEach(q => { const slot = q.querySelector('.slot'), bank = q.querySelector('.bank');
    bank.onclick = e => { const c = e.target.closest('.chip'); if (!c || c.classList.contains('used')) return; const cl = c.cloneNode(true); cl.classList.add('in'); cl.dataset.src = c.dataset.i; slot.appendChild(cl); c.classList.add('used'); };
    slot.onclick = e => { const c = e.target.closest('.chip'); if (!c) return; bank.querySelector(`[data-i="${c.dataset.src}"]`).classList.remove('used'); c.remove(); }; });
  await timed(T.build, 'Next', sync);
  post(`/attempt/${exam.id}/build`, { answers: bAns }).catch(e => console.error('build save', e)); // save early, re-sent at the end
  for (const [k, def] of [['email', W.email], ['discussion', W.discussion]]) {
    const ctx = def.professor ? `<p><b>${h(def.professor.name)}</b> (professor)</p><p>${h(def.professor.text)}</p>${def.students.map(s => `<p><b>${h(s.name)}</b></p><p>${h(s.text)}</p>`).join('')}` : '';
    const head = k === 'email' && (def.to || def.subject) ? `<div class="small mailhead">${def.to ? `<div><b>To:</b> ${h(def.to)}</div>` : ''}${def.subject ? `<div><b>Subject:</b> ${h(def.subject)}</div>` : ''}</div>` : '';
    const min = k === 'discussion' ? 100 : 0;
    body.innerHTML = `<div class="split"><div><h3>${h(def.title)}</h3><div class="passage" style="font-size:1rem">${h(def.prompt)}</div>${ctx}</div><div class="wcol">${head}<textarea class="w" id="wt" placeholder="Type your response here" spellcheck="false"></textarea><div class="small mut" id="wc">0 words</div></div></div>`;
    const ta = document.getElementById('wt'); ta.value = localStorage.getItem('draft:' + exam.id + k) || ''; ta.focus();
    const upd = () => { texts[k] = ta.value; const n = ta.value.trim().split(/\s+/).filter(Boolean).length, wc = document.getElementById('wc');
      wc.textContent = n + (n === 1 ? ' word' : ' words') + (min ? ` (aim for at least ${min})` : ''); wc.className = 'small ' + (min && n >= min ? 'good' : 'mut');
      try { localStorage.setItem('draft:' + exam.id + k, ta.value); } catch {} };
    ta.oninput = upd; upd();
    await timed(T[k], k === 'discussion' ? 'Finish section' : 'Next', upd);
  }
  body.innerHTML = '<div class="center"><h2>Saving...</h2></div>';
  await post(`/attempt/${exam.id}/build`, { answers: bAns });
  for (const k of ['email', 'discussion']) judgeCall(exam.id, 'writing-' + k, `/attempt/${exam.id}/judge-writing`, { task: k, text: texts[k] });
}

// ---------------- results ----------------
const cr = (j, k) => j && j[k];
function list(a) { return a && a.length ? `<ul class="tight">${a.map(x => `<li>${h(x)}</li>`).join('')}</ul>` : ''; }
function marked(t) { return h(t).replace(/\[-([\s\S]*?)-\]/g, '<del>$1</del>').replace(/\{\+([\s\S]*?)\+\}/g, '<ins>$1</ins>'); }
function pendingBox(a, key, label, res, retry) {
  const busy = inflight.has(a.id + ':' + key);
  if (res && res.judged) return null;
  return `<div class="card"><b>${h(label)}</b>: ${busy ? '<span class="warn">Gemini is judging. This takes 20 to 90 seconds.</span>' : `<span class="bad">${res && res.error ? 'Error: ' + h(res.error) : 'Not judged yet.'}</span> <button data-retry="${retry}">${res && res.error ? 'Retry' : 'Judge now'}</button>`}</div>`;
}
async function results(id, quiet) {
  let a; try { a = await api('/attempt/' + id); } catch { $app.innerHTML = '<div class="wrap"><p>Attempt not found. <a href="#/">Home</a></p></div>'; return; }
  const settings = await api('/settings');
  const R = a.results, B = a.bands; let html = `<div class="wrap"><div class="row noprint"><a href="#/">Home</a><span class="grow"></span><button class="sec" onclick="print()">Print</button></div>
  <h1>Results: ${h(a.testId)}</h1><p class="mut">${new Date(a.createdAt).toLocaleString()} (${a.mode === 'exam' ? 'full exam' : 'practice: ' + a.sections.join(', ')})</p>
  <div class="grid4">${Object.keys(SEC).map(k => `<div class="tile"><div class="mut small">${SEC[k]}</div><div class="band">${B[k] ?? '-'}</div></div>`).join('')}
  <div class="tile" style="border-color:var(--navy)"><div class="mut small">Overall</div><div class="band">${a.overall ?? '-'}</div>${a.approx120 != null ? `<div class="small mut">about ${a.approx120} / 120 (estimate)</div>` : ''}</div></div>
  ${a.overall != null && settings.targetBand ? `<p>Target ${settings.targetBand}: <b class="${a.overall >= settings.targetBand ? 'good' : 'bad'}">${a.overall >= settings.targetBand ? 'reached' : 'below target by ' + (settings.targetBand - a.overall).toFixed(1)}</b></p>` : (a.mode !== 'exam' ? '<p class="mut small">Practice attempt: no overall band (needs all 4 sections).</p>' : '')}`;
  for (const s of ['reading', 'listening']) if (R[s]) {
    const r = R[s]; html += `<div class="card"><h2>${SEC[s]}: ${r.right} of ${r.total} correct (${Math.round(100 * r.right / r.total)}%)</h2><p class="small mut">Band ${B[s]} from the raw-score table. Stage 2 module: ${h(r.route)}${r.routerPct != null ? ` (Module 1 score ${r.routerPct}%)` : ''}.</p><table><tr><th>Question</th><th>Your answer</th><th>Correct</th></tr>${Object.values(r.detail).map(d => { const f = v => d.options ? (v == null ? '(none)' : d.options[v]) : (v == null || v === '' ? '(blank)' : v); return `<tr><td>${h(d.q)}</td><td class="${d.ok ? 'good' : 'bad'}">${h(f(d.given))}</td><td>${d.ok ? '' : h(f(d.correct))}</td></tr>`; }).join('')}</table></div>`;
  }
  if (a.sections.includes('speaking')) {
    const S = R.speaking || {};
    for (const [t, label] of [['repeat', 'Listen and Repeat'], ['interview', 'Take an Interview']]) {
      const x = S[t], pb = pendingBox(a, 'speaking-' + t, 'Speaking, ' + label, x, 'speaking-' + t);
      if (pb) { html += pb; continue; }
      const j = x.judged; html += `<div class="card"><h2>Speaking, ${label}: band ${j.overall_band}</h2><p class="small mut">Judged by ${h(x.model)}. Audio quality: ${h(j.audio_quality)}. ${h(j.audio_quality_note || '')}</p><p>${h(j.overall_opinion)}</p>`;
      if (t === 'repeat') {
        html += list(j.strengths) + '<b>Priority fixes</b>' + list(j.priority_fixes) + `<table><tr><th>Target and what you said</th><th>Accuracy</th><th>Band</th></tr>${j.responses.map(r => `<tr><td><div>${h(r.target)}</div><div class="${r.accuracy_percent >= 95 ? 'good' : 'bad'}">${h(r.transcript)}</div>${(r.word_diff || []).map(d => `<div class="small">${h(d.type)}: target "${h(d.target_word)}", heard "${h(d.heard || '')}"</div>`).join('')}<div class="small mut">${h(r.pronunciation_note)}</div></td><td>${r.accuracy_percent}%</td><td>${r.band}</td></tr>`).join('')}</table>`;
      } else for (const r of j.responses) {
        html += `<hr><h3>${h(r.item)}: band ${r.band} <span class="pill">${r.wpm} wpm</span> ${(r.filler_words || []).map(f => `<span class="pill">${h(f.word)} x${f.count}</span>`).join(' ')}</h3>
        <p><b>Transcript.</b> ${h(r.transcript)}</p><p class="small">Delivery ${r.delivery.score}/5 (pace: ${h(r.delivery.pace)} Pauses: ${h(r.delivery.pauses)} Pronunciation: ${h(r.delivery.pronunciation)} Intonation: ${h(r.delivery.intonation)})<br>Language use ${r.language_use.score}/5 (${h(r.language_use.grammar)} ${h(r.language_use.vocabulary)})<br>Topic development ${r.topic_development.score}/5 (${h(r.topic_development.note)})</p>
        <b>Corrections</b><ul class="tight">${(r.corrections || []).map(c => `<li>You said: <del>${h(c.said)}</del> Better: <ins>${h(c.better)}</ins> <span class="mut small">${h(c.why)}</span></li>`).join('')}</ul>
        <b>Strengths</b>${list(r.strengths)}<b>Priority fixes</b>${list(r.priority_fixes)}<p><b>Opinion.</b> ${h(r.opinion)}</p><details><summary>Improved model answer</summary><p>${h(r.model_answer)}</p></details>`;
      }
      html += '</div>';
    }
  }
  if (a.sections.includes('writing')) {
    const W = R.writing || {};
    if (W.build) html += `<div class="card"><h2>Build a Sentence: ${W.build.right} of ${W.build.total} correct</h2><table>${Object.values(W.build.detail).map(d => `<tr><td>${h(d.q)}</td><td class="${d.ok ? 'good' : 'bad'}">${h(d.given || '(blank)')}</td><td>${d.ok ? '' : h(d.correct)}</td></tr>`).join('')}</table></div>`;
    for (const [k, label] of [['email', 'Write an Email'], ['discussion', 'Academic Discussion']]) {
      const x = W[k] || { text: '' }, pb = pendingBox(a, 'writing-' + k, 'Writing, ' + label, x, 'writing-' + k);
      if (pb) { html += pb; continue; }
      const j = x.judged; html += `<div class="card"><h2>${label}: band ${j.band}</h2><p class="small mut">Judged by ${h(x.model)}. Task response ${j.scores.task_response}/5, organization ${j.scores.organization}/5, language use ${j.scores.language_use}/5. ${j.word_count} words.</p>
      <p><b>Opinion.</b> ${h(j.opinion)}</p><b>Your text with edits</b><div class="passage" style="font-size:1rem">${marked(j.corrected_text)}</div>
      <b>Issues</b><ul class="tight">${(j.issues || []).map(i => `<li><span class="pill">${h(i.type)}</span> <del>${h(i.quote)}</del> <ins>${h(i.fix)}</ins> <span class="mut small">${h(i.why)}</span></li>`).join('')}</ul>
      <p><b>Organization.</b> ${h(j.organization_feedback)}</p><b>Strengths</b>${list(j.strengths)}<b>Priority fixes</b>${list(j.priority_fixes)}<details><summary>Model answer</summary><div class="passage" style="font-size:1rem">${h(j.model_answer)}</div></details></div>`;
    }
  }
  html += '<p class="small mut">Band scales: 1.0 to 6.0. The 0 to 120 number is a rough estimate, not an ETS conversion.</p></div>';
  const y = window.scrollY; $app.innerHTML = html; if (quiet) window.scrollTo(0, y);
  document.querySelectorAll('[data-retry]').forEach(b => b.onclick = async () => {
    const key = b.dataset.retry, [kind, t] = key.split('-');
    if (kind === 'speaking') judgeCall(id, key, `/attempt/${id}/judge-speaking`, { task: t });
    else judgeCall(id, key, `/attempt/${id}/judge-writing`, { task: t, text: (R.writing[t] || {}).text || '' });
    results(id, true);
  });
  const waiting = [...inflight].some(k => k.startsWith(id + ':'));
  if (waiting) setTimeout(() => location.hash === '#/results/' + id && !exam && results(id, true), 5000);
}
route();
