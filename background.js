import { addNote, DEFAULT_DECK, fieldValues, version } from './src/anki.js';
import { call, serve } from './src/rpc.js';
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

serve(
  { parse: toOffscreen, lookup: toOffscreen, addCard, importKnown, ankiVersion: version },
  message => message.target === undefined,
);
