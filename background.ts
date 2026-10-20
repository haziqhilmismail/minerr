import { addNote, fieldValues, getDeck, version } from './src/anki.ts';
import { call, type Message, type Reply, serve } from './src/rpc.ts';
import { getStatuses, setStatus, setStatuses } from './src/status.ts';
import { isEnabled, setEnabled } from './src/switch.ts';
import { cachedSegments, getJob, health, startJob } from './src/whisper.ts';

let creating: Promise<void> | null = null;

// The offscreen document has the extension origin's IndexedDB and XMLHttpRequest, which kuromoji's loader needs.
async function ensureOffscreen(): Promise<void> {
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

async function toOffscreen<K extends 'parse' | 'lookup'>(message: Message<K>): Promise<Reply<K>> {
  await ensureOffscreen();
  return call({ ...message, target: 'offscreen' });
}

// Chrome allows two captureVisibleTab calls per second; space them so quick repeated adds do not fail.
const CAPTURE_GAP_MS = 600;
let nextCaptureAt = 0;

async function capture(windowId: number): Promise<string> {
  const wait = Math.max(0, nextCaptureAt - Date.now());
  nextCaptureAt = Date.now() + wait + CAPTURE_GAP_MS;
  await new Promise(resolve => setTimeout(resolve, wait));
  return chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 80 });
}

async function addCard({ card }: Message<'addCard'>, sender: chrome.runtime.MessageSender): Promise<number> {
  if (!sender.tab) throw new Error('Add cards from a tab.');
  const image = await capture(sender.tab.windowId);
  const noteId = await addNote(await getDeck(), card, image);
  const statuses = await getStatuses([card.word]);
  if (statuses.get(card.word) === 'unknown') await setStatus(card.word, 'learning');
  return noteId;
}

async function importKnown({ query, field }: Message<'importKnown'>): Promise<number> {
  const words = await fieldValues(query, field);
  await setStatuses(words, 'known');
  return words.length;
}

chrome.commands.onCommand.addListener(async command => {
  if (command === 'toggle-minerr') await setEnabled(!(await isEnabled()));
});

serve(
  {
    parse: toOffscreen,
    lookup: toOffscreen,
    addCard,
    importKnown,
    ankiVersion: version,
    whisperHealth: health,
    whisperStart: ({ url }) => startJob(url),
    whisperJob: ({ id }) => getJob(id),
    whisperCached: ({ videoId }) => cachedSegments(videoId),
  },
  target => target === undefined,
);
