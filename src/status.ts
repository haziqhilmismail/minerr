import { at, isList } from './parse.ts';
import { call } from './rpc.ts';

// The one definition of word statuses. Storage holds one key per word (its status key, src/entry.ts); a missing key means unknown.
// color is the status color on every surface; underline is the thickness of the colored underline on page words (null: none).
export const STATUSES = {
  unknown: { hotkey: '1', label: 'Unknown', className: 'ml-unknown', color: '#e5383b', underline: 'max(2px, 0.12em)' },
  learning: { hotkey: '2', label: 'Learning', className: 'ml-learning', color: '#f59f00', underline: 'max(2px, 0.12em)' },
  known: { hotkey: '3', label: 'Known', className: 'ml-known', color: '#2f9e44', underline: 'max(1px, 0.05em)' },
  ignored: { hotkey: '4', label: 'Ignored', className: 'ml-ignored', color: '#8a8f98', underline: null },
} satisfies Record<string, { hotkey: string; label: string; className: string; color: string; underline: string | null }>;

export type Status = keyof typeof STATUSES;

export const isStatus = (value: unknown): value is Status => typeof value === 'string' && Object.hasOwn(STATUSES, value);

// The statuses in the order of their hotkeys.
export const STATUS_NAMES: Status[] = Object.keys(STATUSES).filter(isStatus);

// currentColor keeps the hover highlight visible on light text over video and on dark text over a light page.
export const WORD_CSS = [
  '.ml-word { border-radius: 2px; text-underline-offset: 0.2em; text-decoration-skip-ink: none; }',
  '.ml-word:hover, .ml-word[data-ml-active] { background-color: color-mix(in srgb, currentColor 16%, transparent); }',
  ...Object.values(STATUSES).filter(s => s.underline)
    .map(s => `.${s.className} { text-decoration: underline ${s.underline} ${s.color}; }`),
  ':root[data-minerr-off] .ml-word { text-decoration: none; background-color: transparent; }',
].join('\n');

const PREFIX = 'w:';
const wordKey = (key: string) => PREFIX + key;
const keyOfStorage = (key: string) => (key.startsWith(PREFIX) ? key.slice(PREFIX.length) : null);
const storedStatus = (value: unknown): Status => (isStatus(value) ? value : 'unknown');

// A word by its status key (src/entry.ts). oldKey is the key of the word before spellings shared a status: storage still
// can have it, so it gives the status when the key has none, and a new status removes it.
export interface WordId {
  key: string;
  oldKey?: string | undefined;
}

export const setStatus = (word: WordId, status: Status): Promise<void> => setStatuses([word], status);

// Calls listener with a Map of status key -> new status for every key whose status changed in any tab.
export function onStatusChange(listener: (changed: Map<string, Status>) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const changed = new Map<string, Status>();
    for (const [key, { newValue }] of Object.entries(changes)) {
      const word = keyOfStorage(key);
      if (word !== null) changed.set(word, storedStatus(newValue));
    }
    if (changed.size) listener(changed);
  });
}

export async function setStatuses(words: WordId[], status: Status): Promise<void> {
  const keys = new Set(words.map(word => word.key));
  const old = [...new Set(words.flatMap(({ oldKey }) => (oldKey && !keys.has(oldKey) ? [oldKey] : [])))];
  if (status === 'unknown') return chrome.storage.local.remove([...keys, ...old].map(wordKey));
  await chrome.storage.local.set(Object.fromEntries([...keys].map(key => [wordKey(key), status])));
  if (old.length) await chrome.storage.local.remove(old.map(wordKey));
}

// The stored statuses of the keys and old keys of words. Read them with statusIn.
export async function getStatuses(words: WordId[]): Promise<Map<string, Status>> {
  const keys = [...new Set(words.flatMap(({ key, oldKey }) => (oldKey ? [key, oldKey] : [key])))];
  const stored = await chrome.storage.local.get(keys.map(wordKey));
  return new Map(keys.flatMap(key => {
    const value = stored[wordKey(key)];
    return isStatus(value) ? [[key, value]] : [];
  }));
}

export const statusIn = (statuses: Map<string, Status>, { key, oldKey }: WordId): Status =>
  statuses.get(key) ?? (oldKey ? statuses.get(oldKey) : undefined) ?? 'unknown';

// A status that storage holds: an unknown word has no key.
export type StoredStatus = Exclude<Status, 'unknown'>;
export const isStoredStatus = (value: unknown): value is StoredStatus => isStatus(value) && value !== 'unknown';

export async function getAllStatuses(): Promise<Record<string, StoredStatus>> {
  const stored = await chrome.storage.local.get(null);
  return Object.fromEntries(Object.entries(stored).flatMap(([key, value]) => {
    const word = keyOfStorage(key);
    return word !== null && isStoredStatus(value) ? [[word, value]] : [];
  }));
}

const FORMAT = 'minerr-statuses';

// The backup file of the word statuses. exported is an ISO date.
export interface StatusFile {
  format: typeof FORMAT;
  version: 1;
  exported: string;
  words: Record<string, StoredStatus>;
}

export const statusFile = (words: Record<string, StoredStatus>, now: Date): StatusFile =>
  ({ format: FORMAT, version: 1, exported: now.toISOString(), words });

// The words of the text of a status file. Throws an Error that names the problem.
export function parseStatusFile(text: string): Record<string, StoredStatus> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('The file is not JSON.');
  }
  if (at(value, 'format') !== FORMAT) throw new Error(`The file is not a Minerr status file. Its format must be "${FORMAT}".`);
  const version = at(value, 'version');
  if (version !== 1) throw new Error(`The file has version ${JSON.stringify(version)}. Minerr reads version 1.`);
  if (typeof at(value, 'exported') !== 'string') throw new Error('The file has no export date.');
  const words = at(value, 'words');
  if (typeof words !== 'object' || words === null || isList(words)) throw new Error('The file has no words object.');
  return Object.fromEntries(Object.entries(words).map(([lemma, status]) => {
    if (!lemma) throw new Error('The file has a word with no text.');
    if (!isStoredStatus(status)) throw new Error(`The word "${lemma}" has the status ${JSON.stringify(status)}. Use learning, known, or ignored.`);
    return [lemma, status];
  }));
}

export interface ImportCounts {
  added: number;
  changed: number;
  unchanged: number;
}

// The imported status wins. changes holds only the words whose status is new.
export function mergeStatuses(current: Record<string, StoredStatus>, imported: Record<string, StoredStatus>) {
  const counts: ImportCounts = { added: 0, changed: 0, unchanged: 0 };
  const changes: Record<string, StoredStatus> = {};
  for (const [lemma, status] of Object.entries(imported)) {
    const old = Object.hasOwn(current, lemma) ? current[lemma] : undefined;
    if (old === status) {
      counts.unchanged++;
      continue;
    }
    counts[old === undefined ? 'added' : 'changed']++;
    changes[lemma] = status;
  }
  return { changes, counts };
}

// The words get the status keys of their dictionary entries first, so ねこ from an old file is stored as 猫.
export async function importStatuses(imported: Record<string, StoredStatus>): Promise<ImportCounts> {
  const entries = Object.entries(imported);
  const keys = await call({ type: 'wordKeys', words: entries.map(([word]) => word) });
  const canonical = Object.fromEntries(entries.map(([word, status], i) => [keys[i] ?? word, status]));
  const { changes, counts } = mergeStatuses(await getAllStatuses(), canonical);
  await chrome.storage.local.set(Object.fromEntries(Object.entries(changes).map(([key, status]) => [wordKey(key), status])));
  return counts;
}
