import { addNote, DEFAULT_DECK, fieldValues, version } from './src/anki.js';
import { call, serve } from './src/rpc.js';
import { isEnabled, setEnabled } from './src/switch.js';
import { getStatuses, setStatus, setStatuses } from './src/status.js';

let creating = null;

// The offscreen document has the extension origin's IndexedDB and XMLHttpRequest, which kuromoji's loader needs.
async function ensureOffscreen() {
  const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (existing.length) return;
  creating ??= chrome.offscreen
    .createDocument({
      url: 'offscreen.html',
      reasons: ['LOCAL_STORAGE'],
      justification: 'Runs the kuromoji parser and reads the IndexedDB dictionaries.',
    })
    .finally(() => { creating = null; });
  await creating;
}

async function toOffscreen(message) {
  await ensureOffscreen();
  return call({ ...message, target: 'offscreen' });
}

// Chrome allows two captureVisibleTab calls per second; space them so quick repeated adds do not fail.
const CAPTURE_GAP_MS = 600;
let nextCaptureAt = 0;

async function capture(windowId) {
  const wait = Math.max(0, nextCaptureAt - Date.now());
  nextCaptureAt = Date.now() + wait + CAPTURE_GAP_MS;
  await new Promise(resolve => setTimeout(resolve, wait));
  return chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 80 });
}

async function addCard({ card }, sender) {
  const image = await capture(sender.tab.windowId);
  const { deck } = await chrome.storage.local.get({ deck: DEFAULT_DECK });
  const noteId = await addNote(deck, card, image);
  const statuses = await getStatuses([card.word]);
  if (statuses.get(card.word) === 'unknown') await setStatus(card.word, 'learning');
  return noteId;
}

async function importKnown({ query, field }) {
  const words = await fieldValues(query, field);
  await setStatuses(words, 'known');
  return words.length;
}

chrome.commands.onCommand.addListener(async command => {
  if (command === 'toggle-minerr') await setEnabled(!(await isEnabled()));
});

const WHISPER = 'http://127.0.0.1:8766';

// Returns the JSON reply, or null for 404 (no such job, no cached subtitles).
async function whisper(path, body) {
  let response;
  try {
    response = await fetch(WHISPER + path, body && { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new Error('Start the WhisperX server: uv run server/whisper_server.py');
  }
  if (response.status === 404) return null;
  const reply = await response.json();
  if (!response.ok) throw new Error(reply.error ?? `The WhisperX server answered ${response.status}.`);
  return reply;
}

const whisperHandlers = {
  whisperHealth: () => whisper('/health'),
  whisperStart: ({ url }) => whisper('/jobs', { url }),
  whisperJob: ({ id }) => whisper(`/jobs/${encodeURIComponent(id)}`),
  whisperCached: ({ videoId }) => whisper(`/subs/${encodeURIComponent(videoId)}`),
};

serve(
  { parse: toOffscreen, lookup: toOffscreen, addCard, importKnown, ankiVersion: version, ...whisperHandlers },
  message => message.target === undefined,
);
