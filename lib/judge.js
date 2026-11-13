// Prompts for Gemini judging. Output is JSON only.
// Rubric text lives in data/rubrics/*.md (our own approximate guides plus rater rules that add no criteria).
const fs = require('fs'), path = require('path');
const RDIR = path.join(__dirname, '..', 'data', 'rubrics');
const rubric = name => fs.readFileSync(path.join(RDIR, name + '.md'), 'utf8').trim();

// ETS scores each task item 0-5. The app reports 1-6 bands: band = ETS score + 1 (house mapping, see lib/scoring.js).
const SCALE = `Score each response on a 0 to 5 item scale (halves allowed only when the response sits between two levels) in "ets_score". Then set "band" = ets_score + 1 (so ETS 5 is band 6, ETS 4 is band 5, ETS 3 is band 4, ETS 2 is band 3).`;

const SPEAK_RULES = `You are a strict, calibrated rater who scores TOEFL iBT 2026 style speaking tasks with the guide below. You are not a coach. Do not inflate.
${SCALE}
Judge from the ACTUAL AUDIO: pace, pauses, pronunciation, intonation. If the audio is silent, very short, noisy or clipped, say so in audio_quality_note, lower your confidence, and never invent words you cannot hear.
Write short plain sentences. No flattery. Quote exact words for every correction.
Return ONLY valid JSON.

=== RATER RULES (how to apply the scoring guides) ===
${rubric('calibration')}`;

// opts.strict adds data/rubrics/strict.md (harsher practice grading, 2026-11-11).
const STRICT = opts => opts && opts.strict ? `\n\n=== STRICT MODE RULES (apply on top of the rater rules) ===\n${rubric('strict')}` : '';

function interviewPrompt(items, opts = {}) {
  const tr = opts.transcripts; // optional { itemId: "text" }: judge text only, no audio
  return `${SPEAK_RULES}${STRICT(opts)}

=== SCORING GUIDE (our approximation, not the official ETS guide): TAKE AN INTERVIEW ===
${rubric('speaking-interview')}

Task: "Take an Interview". The candidate answered each question in at most 45 seconds with no preparation. ${tr ? 'The transcripts follow. You have NO audio. Set audio_quality to "transcript only", score delivery as null, and judge language use and topic development only.' : 'The audio clips follow in order. Clip N matches question N.'}
Questions:
${items.map((q, i) => `${i + 1}. [${q.id}] ${q.text}${tr ? `\n   Transcript: """${tr[q.id] || ''}"""` : ''}`).join('\n')}

Method for each answer: (1) count the words and the filler words; (2) list each deduction with a quote and the descriptor phrase it breaks; (3) pick the closest level from the guide; (4) write ets_score and band. Compute WPM from the transcript and clip length when you have the audio, else 0.
JSON shape:
{"audio_quality":"good|fair|poor|transcript only","audio_quality_note":"string",
"responses":[{"item":"<id>","transcript":"verbatim","word_count":0,"ets_score":0,"band":0,"deductions":[{"quote":"exact words","descriptor":"guide phrase broken","effect":"short"}],"delivery":{"score":0,"pace":"","pauses":"","pronunciation":"","intonation":""},"language_use":{"score":0,"grammar":"","vocabulary":""},"topic_development":{"score":0,"note":""},"wpm":0,"filler_words":[{"word":"um","count":0}],"corrections":[{"said":"exact quote","better":"corrected version","why":"short reason"}],"strengths":["quoted evidence"],"priority_fixes":["",""],"opinion":"2-3 plain sentences. Open with the score and the main reason it is not higher.","model_answer":"improved answer of about 100 words"}],
"overall_ets_score":0,"overall_band":0,"overall_opinion":"2-3 plain sentences"}
overall_band = mean of the item bands, rounded to the nearest 0.5. Scores for delivery, language_use and topic_development use 0 to 5.`;
}

function repeatPrompt(items, opts = {}) {
  const tr = opts.transcripts;
  return `${SPEAK_RULES}${STRICT(opts)}

=== SCORING GUIDE (our approximation, not the official ETS guide): LISTEN AND REPEAT ===
${rubric('speaking-repeat')}

Task: "Listen and Repeat". The candidate heard each sentence once and tried to repeat it exactly. ${tr ? 'Transcripts of what the candidate said follow. You have NO audio: judge words only and say pronunciation is not judged.' : 'Clip N matches target N.'} Compare what the candidate SAID to the target, word by word. Flag every omission, substitution and insertion. Classify each as a function word or a content word, then pick the ETS level from the guide. Only an exact, fully intelligible repetition gets 5.
Targets:
${items.map((q, i) => `${i + 1}. [${q.id}] ${q.text}${tr ? `\n   Said: """${tr[q.id] || ''}"""` : ''}`).join('\n')}

JSON shape:
{"audio_quality":"good|fair|poor|transcript only","audio_quality_note":"string",
"responses":[{"item":"<id>","target":"","transcript":"verbatim","accuracy_percent":0,"word_diff":[{"target_word":"","heard":"","type":"omission|substitution|insertion","kind":"function|content"}],"pronunciation_note":"","ets_score":0,"band":0}],
"strengths":["",""],"priority_fixes":["",""],"overall_ets_score":0,"overall_band":0,"overall_opinion":"2-3 plain sentences"}
List only the words that differ in word_diff. If a sentence is perfect, word_diff is []. overall_band = mean of item bands, rounded to the nearest 0.5.`;
}

const WRITE_RULES = `You are a strict, calibrated rater who scores TOEFL iBT 2026 style writing tasks with the guide below. You are not a coach. Do not inflate.
${SCALE}
Mark edits in corrected_text: wrap deleted text as [-old-] and added text as {+new+}. Keep the writer's meaning and voice. Short plain sentences. Return ONLY valid JSON.

=== RATER RULES (how to apply the scoring guides) ===
${rubric('calibration')}`;

function writingPrompt(task, def, text, opts = {}) {
  const wc = text.trim() ? text.trim().split(/\s+/).length : 0;
  let prompt = def.prompt;
  if (def.professor) prompt += `\n\nProfessor ${def.professor.name}: ${def.professor.text}\n` + (def.students || []).map(s => `${s.name}: ${s.text}`).join('\n');
  const guide = task === 'email' ? rubric('writing-email') : rubric('writing-discussion');
  return `${WRITE_RULES}${STRICT(opts)}

=== SCORING GUIDE (our approximation, not the official ETS guide): ${String(def.title || task).toUpperCase()} ===
${guide}

Task: ${def.title}.
Task notes from the test author: ${def.rubric || 'none'}
Prompt shown to the candidate:
"""
${prompt}
"""
Candidate response (${wc} words):
"""
${text}
"""
Method: (1) check every requested point in the prompt; (2) list each language, register and convention error with its exact quote; (3) pick the closest level from the guide; (4) write ets_score and band. Fill "scores" on 0 to 5: task_response = relevance and elaboration, organization = connected, logical order, language_use = accuracy, range and register.
JSON shape:
{"ets_score":0,"band":0,"scores":{"task_response":0,"organization":0,"language_use":0},"word_count":${wc},"points_covered":["each requested point: covered|missing"],"deductions":[{"quote":"exact words","descriptor":"guide phrase broken","effect":"short"}],"corrected_text":"text with [-deleted-] and {+added+} marks","issues":[{"type":"grammar|vocabulary|punctuation|register|clarity","quote":"exact quote","fix":"corrected version","why":"short reason"}],"organization_feedback":"2-4 plain sentences","strengths":["quoted evidence",""],"priority_fixes":["",""],"opinion":"2-3 plain sentences. Open with the score and the main reason it is not higher.","model_answer":"improved model response that would score ETS 5"}`;
}
module.exports = { interviewPrompt, repeatPrompt, writingPrompt, rubric };
