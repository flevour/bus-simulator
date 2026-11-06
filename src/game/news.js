import { NOVITA } from '../data/novita.js';
import { posthog, isPostHogConfigured } from '../posthog.js';

// Novità (cosa è cambiato dall'ultima visita, ricordato in questo browser) e modulo per richieste e segnalazioni.
// Le richieste vanno al sondaggio PostHog di tipo API "Richieste dal gioco" (SURVEY_ID), se è attivo; altrimenti come
// evento player_request_submitted, così non se ne perde nessuna.
const READ_KEY = 'padova-bus-sim-novita';
const SURVEY_ID = '01a1b1eb-31a0-0000-e46d-8c44cf3585e7';
const KIND_LABEL = { idea: 'Idea', problema: 'Problema', altro: 'Altro' };
const $ = (id) => document.getElementById(id);
const latest = () => NOVITA.reduce((m, it) => Math.max(m, it.n), 0);

function readMark() {
  try { const v = localStorage.getItem(READ_KEY); return v == null ? null : Number(v); } catch (e) { return null; }
}
function writeMark(n) {
  try { localStorage.setItem(READ_KEY, String(n)); } catch (e) { /* ignorato */ }
}
const fmtDay = (d) => new Date(d + 'T12:00:00').toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const newId = () => (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

// savedAt: data dell'ultima corsa salvata (chi ne ha una è già passato di qui); context(): dove si trova chi scrive
export function initNews({ savedAt = null, context = () => ({}) } = {}) {
  let mark = readMark();
  if (mark == null) {
    // prima visita con le novità: chi aveva una corsa salvata vede quello che è arrivato dopo, gli altri niente
    const day = savedAt ? new Date(savedAt).toISOString().slice(0, 10) : null;
    mark = day ? Math.max(0, ...NOVITA.filter((it) => it.d <= day).map((it) => it.n)) : latest();
    writeMark(mark);
  }
  const unread = () => NOVITA.filter((it) => it.n > mark).length;
  const badge = () => {
    const n = unread();
    $('news-badge').hidden = !n;
    $('news-badge').textContent = n;
  };
  const openNews = (v) => {
    $('news').classList.toggle('hidden', !v);
    if (!v) { mark = latest(); writeMark(mark); badge(); return; }
    const n = unread();
    $('news-title').textContent = n ? 'Cosa c\'è di nuovo dall\'ultima visita' : 'Novità';
    const days = [];
    for (const it of NOVITA) {
      if (!days.length || days[days.length - 1].d !== it.d) days.push({ d: it.d, items: [] });
      days[days.length - 1].items.push(it);
    }
    $('news-list').innerHTML = days.map((g) => `<h3>${fmtDay(g.d)}</h3><ul>${g.items.map((it) => `<li class="${it.n > mark ? 'new' : ''}">${it.n > mark ? '<span class="tag">nuovo</span>' : ''}${esc(it.t)}</li>`).join('')}</ul>`).join('');
  };
  $('news-btn').addEventListener('click', () => openNews(true));
  $('news-ok').addEventListener('click', () => openNews(false));
  badge();
  if (unread()) openNews(true);

  // ---- richieste ----
  let survey = null, kind = 'idea', shown = false, sentAt = 0;
  const surveyProps = () => ({ $survey_id: survey.id, $survey_name: survey.name, $survey_iteration: survey.current_iteration ?? null });
  // il sondaggio si cerca all'avvio e di nuovo a ogni apertura del modulo finché non si trova: appena caricata la pagina
  // PostHog può non essere pronto, e la copia salvata nel browser può essere di prima che il sondaggio esistesse
  const loadSurvey = () => {
    if (survey || !isPostHogConfigured) return;
    try {
      posthog.getSurveys((list) => {
        if (survey) return;
        survey = (list || []).find((s) => s.id === SURVEY_ID && s.start_date && !s.end_date) || null;
        if (survey && shown && !$('ask').classList.contains('hidden')) posthog.capture('survey shown', surveyProps());
      }, true);
    } catch (e) { /* sondaggi non disponibili */ }
  };
  loadSurvey();
  const status = (msg, cls = '') => { $('ask-status').textContent = msg; $('ask-status').className = 'note ' + cls; };
  const openAsk = (v) => {
    $('ask').classList.toggle('hidden', !v);
    if (v) {
      status('');
      shown = true;
      if (survey) posthog.capture('survey shown', surveyProps());
      else loadSurvey();
      setTimeout(() => $('ask-text').focus(), 0);
    } else if (shown && survey && $('ask-text').value.trim()) posthog.capture('survey dismissed', surveyProps());
  };
  document.querySelectorAll('#ask-kind button').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('#ask-kind button').forEach((x) => x.classList.toggle('sel', x === b));
    kind = b.dataset.k;
  }));
  const send = () => {
    const text = $('ask-text').value.trim();
    if (text.length < 5) { status('Scrivi qualche parola in più.', 'bad'); return; }
    if (!isPostHogConfigured) { status('Invio non disponibile in questa versione del gioco.', 'bad'); return; }
    if (Date.now() - sentAt < 10000) { status('Aspetta qualche secondo prima di mandarne un\'altra.', 'bad'); return; }
    const ctx = { request_kind: kind, ...context() };
    if (survey) {
      // un invio = una risposta completa: PostHog le conta per $survey_submission_id
      const props = { ...surveyProps(), $survey_submission_id: newId(), $survey_completed: true, $survey_questions: survey.questions.map((q) => ({ id: q.id, question: q.question })), ...ctx };
      for (const q of survey.questions) {
        let val = null;
        if (q.type === 'open') val = text;
        else if (q.type === 'single_choice' && q.choices && q.choices.length) val = q.choices.find((c) => c.toLowerCase().startsWith(KIND_LABEL[kind].toLowerCase())) || q.choices[q.choices.length - 1];
        if (val != null) props[`$survey_response_${q.id}`] = val;
      }
      posthog.capture('survey sent', props);
    } else posthog.capture('player_request_submitted', { text, ...ctx });
    sentAt = Date.now();
    shown = false;
    $('ask-text').value = '';
    status('Grazie! Richiesta inviata.', 'good');
  };
  for (const id of ['ask-btn', 'pause-ask']) $(id).addEventListener('click', () => openAsk(true));
  $('ask-close').addEventListener('click', () => openAsk(false));
  $('ask-send').addEventListener('click', send);
  $('ask-text').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); });
  return {
    get open() { return !$('ask').classList.contains('hidden') || !$('news').classList.contains('hidden'); },
    close() { if (!$('ask').classList.contains('hidden')) openAsk(false); if (!$('news').classList.contains('hidden')) openNews(false); },
  };
}
