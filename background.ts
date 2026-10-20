import {
  addDraft, fieldValues, getDeck, getNoteType, installLapis, modelFieldNames, modelNames, type NoteDraft, noteDraft, usesWordAudio, version,
} from './src/anki.ts';
import { isPageCommand } from './src/chord.ts';
import { listDictionaries } from './src/db.ts';
import { cardMedia, widenSentence } from './src/lineaudio.ts';
import { call, type Message, type Reply, serve } from './src/rpc.ts';
import { getStatuses, moveStatusKeys, setStatus, setStatuses } from './src/status.ts';
import { minerrEnabled, wordJoins } from './src/settings.ts';
import { cachedSegments, getJob, health, siteCaptions, startJob } from './src/whisper.ts';
import { wordAudio } from './src/wordaudio.ts';

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

// A dictionary import moves the statuses to their keys (options.ts). The first offscreen call after a service worker start
// finishes a move that stopped. It starts there, not at the top of this file, so a worker that only runs a command does not open IndexedDB.
let moved: Promise<void> | undefined;

async function toOffscreen<K extends 'segments' | 'lookup' | 'pitch' | 'lookupText' | 'wordKeys'>(message: Message<K>): Promise<Reply<K>> {
  await ensureOffscreen();
  moved ??= listDictionaries()
    .then(dictionaries => moveStatusKeys(dictionaries, words => call({ type: 'wordKeys', words, target: 'offscreen' })))
    .catch(error => console.warn('minerr could not move the statuses to their keys', error));
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

// The note of a card with its media: the screenshot of the tab, the audio of the subtitle line, and the audio of the word.
async function cardDraft({ card }: Message<'cardDraft'>, sender: chrome.runtime.MessageSender): Promise<NoteDraft> {
  if (!sender.tab) throw new Error('Add cards from a tab.');
  const image = await capture(sender.tab.windowId);
  const noteType = await getNoteType();
  // After the screenshot, because the tab may play the line again to record it.
  const { line, audio } = await cardMedia(sender.tab.id);
  // One audio per card, so Anki plays one: the line audio of a video, else the audio of the word.
  const word = !audio && usesWordAudio(noteType) ? await wordAudio(card.word, card.reading) : null;
  const sentence = line?.combined ? widenSentence(line.text, card.sentence) : card.sentence;
  const { url = '', title = '' } = sender.tab;
  return noteDraft(noteType, { ...card, sentence, ...(audio ? { audio } : {}), ...(word ? { wordAudio: word } : {}) }, { url, title }, image);
}

// A draft is the note of the edit form; without one, the card goes to Anki at once.
async function addCard({ card, word, draft }: Message<'addCard'>, sender: chrome.runtime.MessageSender): Promise<number> {
  const noteId = await addDraft(await getDeck(), draft ?? await cardDraft({ type: 'cardDraft', card }, sender));
  if (((await getStatuses([word])).get(word.key) ?? 'unknown') === 'unknown') await setStatus(word, 'learning');
  return noteId;
}

async function importKnown({ query, field }: Message<'importKnown'>): Promise<number> {
  const words = await fieldValues(query, field);
  const keys = await toOffscreen({ type: 'wordKeys', words });
  await setStatuses(keys.map(key => ({ key })), 'known');
  return words.length;
}

// The browser shortcuts of manifest.json. Each one but toggle-minerr goes to the page of the active tab.
// The tests call it as globalThis.runCommand, because Playwright cannot press a browser shortcut.
async function runCommand(command: string, tab?: chrome.tabs.Tab): Promise<void> {
  if (command === 'toggle-minerr') return minerrEnabled.set(!(await minerrEnabled.get()));
  if (!isPageCommand(command)) throw new Error(`manifest.json has the command ${command}, but Minerr has no handler for it`);
  if (tab?.id === undefined) return;
  // No frame answers in a browser page, in a tab that was open before Minerr started, or when no frame of the tab has the focus.
  await call({ type: 'command', command }, tab.id).catch(error => console.warn(`minerr could not run ${command} in the tab`, error));
}
chrome.commands.onCommand.addListener(runCommand);
Object.assign(globalThis, { runCommand });

serve(
  {
    parse: async ({ texts }) => toOffscreen({ type: 'segments', texts, joins: await wordJoins.get() }),
    lookup: toOffscreen,
    pitch: toOffscreen,
    lookupText: toOffscreen,
    cardDraft,
    wordKeys: toOffscreen,
    addCard,
    importKnown,
    ankiInstallLapis: installLapis,
    ankiVersion: version,
    ankiModels: modelNames,
    ankiModelFields: ({ model }) => modelFieldNames(model),
    whisperHealth: health,
    whisperStart: ({ url }) => startJob(url),
    whisperJob: ({ id }) => getJob(id),
    whisperCached: ({ videoId }) => cachedSegments(videoId),
    siteCaptions: ({ url, lang }) => siteCaptions(url, lang),
  },
  target => target === undefined,
);
