import type { CardFields } from './anki.ts';
import type { SubtitleSegment } from './captions.ts';
import type { Segment } from './group.ts';
import { at } from './parse.ts';
import type { Snapshot, Source } from './subtitles.ts';
import type { Health, Job } from './whisper.ts';
import type { Group } from './yomitan.ts';

// Every message type, with the fields that call() sends and the value that its handler replies with.
// The service worker handles parse to whisperCached; it passes parse and lookup on to the offscreen document.
// The content scripts of a YouTube tab handle subsState, subsGenerate, and subsUse.
interface Protocol {
  parse: { request: { texts: string[] }; reply: Segment[][] };
  lookup: { request: { lemma: string }; reply: Group[] };
  addCard: { request: { card: CardFields }; reply: number };
  importKnown: { request: { query: string; field: string }; reply: number };
  ankiVersion: { request: {}; reply: number };
  whisperHealth: { request: {}; reply: Health };
  whisperStart: { request: { url: string }; reply: { id: string } };
  whisperJob: { request: { id: string }; reply: Job | null };
  whisperCached: { request: { videoId: string }; reply: SubtitleSegment[] | null };
  subsState: { request: {}; reply: Snapshot };
  subsGenerate: { request: {}; reply: Snapshot };
  subsUse: { request: { source: Source }; reply: Snapshot };
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
