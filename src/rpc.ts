import type { CardFields, MediaFile } from './anki.ts';
import type { SubtitleSegment } from './captions.ts';
import type { Segment } from './group.ts';
import type { CardLine } from './lineaudio.ts';
import { at } from './parse.ts';
import type { PageStats } from './stats.ts';
import type { Snapshot, Source } from './subtitles.ts';
import type { Entry, PitchPattern } from './meta.ts';
import type { Health, Job } from './whisper.ts';

// Every message type, with the fields that call() sends and the value that its handler replies with.
// The service worker handles parse to siteCaptions; it passes parse, lookup, pitch, and lookupText on to the offscreen document.
// The content scripts of a YouTube tab handle subsState, subsGenerate, and subsUse.
// The page with the video overlay (a content script, or the player page) handles videoLine and videoRecord.
// The content scripts of a page that is not YouTube handle videoAttach.
// The content scripts of every tab, and the reader page, handle pageStats and pageStatsShow (src/stats.ts).
interface Protocol {
  parse: { request: { texts: string[] }; reply: Segment[][] };
  lookup: { request: { lemma: string }; reply: Entry[] };
  pitch: { request: { words: { lemma: string; reading: string }[] }; reply: (PitchPattern | null)[] };
  // The longest dictionary word at the start of text, and the number of characters of text that it covers.
  lookupText: { request: { text: string }; reply: { lemma: string; length: number; entries: Entry[] } | null };
  addCard: { request: { card: CardFields }; reply: number };
  importKnown: { request: { query: string; field: string }; reply: number };
  ankiVersion: { request: {}; reply: number };
  ankiModels: { request: {}; reply: string[] };
  ankiModelFields: { request: { model: string }; reply: string[] };
  // Imports the Lapis note type into Anki and replies with the result for the options page.
  ankiInstallLapis: { request: {}; reply: string };
  whisperHealth: { request: {}; reply: Health };
  whisperStart: { request: { url: string }; reply: { id: string } };
  whisperJob: { request: { id: string }; reply: Job | null };
  whisperCached: { request: { videoId: string }; reply: SubtitleSegment[] | null };
  siteCaptions: { request: { url: string; lang: string }; reply: SubtitleSegment[] | null };
  subsState: { request: {}; reply: Snapshot };
  subsGenerate: { request: {}; reply: Snapshot };
  subsUse: { request: { source: Source }; reply: Snapshot };
  videoLine: { request: {}; reply: CardLine | null };
  videoRecord: { request: { start: number; end: number }; reply: MediaFile | null };
  videoAttach: { request: {}; reply: string };
  pageStats: { request: {}; reply: PageStats };
  pageStatsShow: { request: { index: number }; reply: void };
}

type MessageType = keyof Protocol;
export type Message<K extends MessageType> = { type: K } & Protocol[K]['request'];
export type Reply<K extends MessageType> = Protocol[K]['reply'];
type Handlers<K extends MessageType> = {
  [P in K]: (message: Message<P>, sender: chrome.runtime.MessageSender) => Reply<P> | Promise<Reply<P>>;
};

export const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const isHandled = <K extends MessageType>(handlers: Handlers<K>, type: unknown): type is K =>
  typeof type === 'string' && Object.hasOwn(handlers, type);

function dispatch<K extends MessageType>(handlers: Handlers<K>, type: K, message: unknown, sender: chrome.runtime.MessageSender) {
  // The sender is call() in another part of the extension, which types the message with the same Protocol.
  return handlers[type](message as Message<K>, sender);
}

// accepts gets the target of each message; the service worker passes messages on to the offscreen document with target 'offscreen'.
// Every reply is {value} or {error}, so an error thrown in a handler reaches the caller as an Error.
export function serve<K extends MessageType>(handlers: Handlers<K>, accepts: (target: unknown) => boolean): void {
  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    const type = at(message, 'type');
    if (!accepts(at(message, 'target')) || !isHandled(handlers, type)) return false;
    Promise.resolve()
      .then(() => dispatch(handlers, type, message, sender))
      .then(value => sendResponse({ value }), error => sendResponse({ error: messageOf(error) }));
    return true;
  });
}

// Without tabId the message goes to the extension pages and the service worker; with it, to the content scripts of that tab.
export async function call<K extends MessageType>(message: Message<K> & { target?: 'offscreen' }, tabId?: number): Promise<Reply<K>> {
  const reply: unknown = await (tabId === undefined ? chrome.runtime.sendMessage(message) : chrome.tabs.sendMessage(tabId, message));
  if (typeof reply !== 'object' || reply === null) throw new Error(`No handler answered "${message.type}"`);
  if ('error' in reply) throw new Error(String(reply.error));
  // The reply is from serve(), which runs the handler that Handlers types to return Reply<K>.
  return ('value' in reply ? reply.value : undefined) as Reply<K>;
}
