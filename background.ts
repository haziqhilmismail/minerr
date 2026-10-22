import {
  addDraft, browseWordNotes, countWordNotes, fieldValues, getDeck, getNoteType, installLapis, type MediaFile, modelFieldNames, modelNames, type NoteDraft, noteDraft, usesWordAudio, version,
} from './src/anki/anki.ts';
import { isPageCommand } from './src/popup/chord.ts';
import { listDictionaries } from './src/dictionary/db.ts';
import { cardLine, lineAudio, widenSentence } from './src/anki/lineaudio.ts';
import { call, type Message, type Reply, serve } from './src/shared/rpc.ts';
import { getStatuses, moveStatusKeys, setStatus, setStatuses } from './src/status/status.ts';
import { minerrEnabled, wordAudioEnabled, wordJoins } from './src/shared/settings.ts';
import { cachedSegments, getJob, health, siteCaptions, startJob } from './src/video/whisper.ts';
import { wordAudio } from './src/anki/wordaudio.ts';

let creating: Promise<void> | null = null;

// The offscreen document has the extension origin's IndexedDB and XMLHttpRequest, which kuromoji's loader needs.
async function ensureOffscreen(): Promise<void> {
  const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (existing.length) return;
  creating ??= chrome.offscreen
    .createDocument({
      url: 'pages/offscreen.html',
      reasons: ['LOCAL_STORAGE'],
      justification: 'Runs the kuromoji parser and reads the IndexedDB dictionaries.',
    })
    .finally(() => { creating = null; });
  await creating;
}

// A dictionary import moves the statuses to their keys (pages/options.ts). The first offscreen call after a service worker start
// finishes a move that stopped. It starts there, not at the top of this file, so a worker that only runs a command does not open IndexedDB.
let moved: Promise<void> | undefined;

async function toOffscreen<K extends 'segments' | 'lookup' | 'inflection' | 'pitch' | 'lookupText' | 'wordKeys'>(message: Message<K>): Promise<Reply<K>> {
  await ensureOffscreen();
  moved ??= listDictionaries()
    .then(dictionaries => moveStatusKeys(dictionaries, words => call({ type: 'wordKeys', words, target: 'offscreen' })))
    .catch(error => console.warn('minerr could not move the statuses to their keys', error));
  return call({ ...message, target: 'offscreen' });
}

// Chrome allows two captureVisibleTab calls per second; space them so quick repeated adds do not fail.
const CAPTURE_GAP_MS = 600;
let nextCaptureAt = 0;

async function capture(windowId: number): Promise<MediaFile> {
  const wait = Math.max(0, nextCaptureAt - Date.now());
  nextCaptureAt = Date.now() + wait + CAPTURE_GAP_MS;
  await new Promise(resolve => setTimeout(resolve, wait));
  const jpegDataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 80 });
  return { data: jpegDataUrl.split(',')[1] ?? '', filename: `minerr-${Date.now()}.jpg` };
}

const PANEL_URL = chrome.runtime.getURL('pages/sidepanel.html');

// The tab of a message with its id: the tab of a content script, or the tab that the subtitle side panel belongs to
// (pages/sidepanel.ts), named in its URL, because a message from a side panel has no sender.tab.
async function tabOf(sender: chrome.runtime.MessageSender): Promise<chrome.tabs.Tab & { id: number }> {
  const panelTab = sender.url?.startsWith(PANEL_URL) ? Number(new URL(sender.url).searchParams.get('tab') ?? NaN) : NaN;
  const tab = Number.isInteger(panelTab) ? await chrome.tabs.get(panelTab) : sender.tab;
  if (tab?.id === undefined) throw new Error('Add cards from a tab.');
  return { ...tab, id: tab.id };
}

// The note of a card with its media: the screenshot of the tab, the audio of the subtitle line, and the audio of the word.
// A protected video (DRM) gives neither the screenshot nor the line audio.
async function cardDraft({ card }: Message<'cardDraft'>, sender: chrome.runtime.MessageSender): Promise<NoteDraft> {
  const tab = await tabOf(sender);
  const line = await cardLine(tab.id);
  const guarded = line?.protected ?? false;
  const image = guarded ? null : await capture(tab.windowId);
  const noteType = await getNoteType();
  // After the screenshot, because the tab may play the line again to record it.
  const audio = line && !guarded ? await lineAudio(line, tab.id) : null;
  // One audio per card, so Anki plays one: the line audio of a video, else the audio of the word if the user did not turn it off.
  const word = !audio && usesWordAudio(noteType) && await wordAudioEnabled.get() ? await wordAudio(card.word, card.reading) : null;
  const sentence = line?.combined ? widenSentence(line.text, card.sentence) : card.sentence;
  const { url = '', title = '' } = tab;
  const media = { ...(image ? { image } : {}), ...(audio ? { audio } : {}), ...(word ? { wordAudio: word } : {}) };
  return noteDraft(noteType, { ...card, sentence, ...media }, { url, title });
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

// Opens the subtitle side panel next to the tab of the sender, or closes it. setOptions() and open() run in the task of the
// message of the G key: an await or a microtask before open() loses the user gesture, and open() then fails (Chrome 156).
function sidePanel({ open }: Message<'sidePanel'>, sender: chrome.runtime.MessageSender): Promise<void> {
  const tabId = sender.tab?.id;
  if (tabId === undefined) throw new Error('The subtitle sidebar opens from a tab with a video.');
  if (!open) return chrome.sidePanel.close({ tabId });
  chrome.sidePanel.setOptions({ tabId, path: `pages/sidepanel.html?tab=${tabId}` });
  return chrome.sidePanel.open({ tabId });
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
    inflection: toOffscreen,
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
    ankiCount: ({ words }) => countWordNotes(words),
    ankiBrowse: ({ words }) => browseWordNotes(words),
    whisperHealth: health,
    whisperStart: ({ url }) => startJob(url),
    whisperJob: ({ id }) => getJob(id),
    whisperCached: ({ videoId }) => cachedSegments(videoId),
    siteCaptions: ({ url, lang }) => siteCaptions(url, lang),
    sidePanel,
  },
  target => target === undefined,
);
