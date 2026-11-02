import { type EntryIndex, type EntryRow, MAX_ENTRY_ROWS } from '../text/entry.ts';
import { type DictMeta, type Entry, morae, pitchPattern, type PitchPattern, withMeta } from './meta.ts';
import { at, isList, isStringList } from '../shared/guards.ts';
import { type DictTag, type DictTerm, groupTerms, readYomitan } from './yomitan.ts';
import type { Bytes } from './zip.ts';

// Stores: dicts {title, revision, count, tags, meta, entries, rank, disabled} (count is null while an import is unfinished;
// tags is true for an import that stored tags; meta counts the meta rows; entries counts the terms with a sequence; a missing
// rank reads as 0 and a missing disabled means on; these two are here, not in chrome.storage, because the offscreen document
// has only chrome.runtime), terms {dict, id,
// expression, reading, definitionTags, termTags, glossary, score, sequence, notes} keyed by [dict, id], tags {dict, name, category,
// notes} keyed by [dict, name], and meta (a TermMeta with its dict) keyed by [dict, id].
// The [dict, ...] keys let one key range delete a dictionary.
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('minerr', 4);
    request.onupgradeneeded = event => {
      const db = request.result;
      if (event.oldVersion < 1) {
        db.createObjectStore('dicts', { keyPath: 'title' });
        const terms = db.createObjectStore('terms', { keyPath: ['dict', 'id'] });
        terms.createIndex('expression', 'expression');
        terms.createIndex('reading', 'reading');
      }
      if (event.oldVersion < 2) db.createObjectStore('tags', { keyPath: ['dict', 'name'] });
      if (event.oldVersion < 3) db.createObjectStore('meta', { keyPath: ['dict', 'id'] }).createIndex('expression', 'expression');
      // A term imported before version 4 has no sequence, so the index skips it.
      if (event.oldVersion < 4) request.transaction?.objectStore('terms').createIndex('sequence', ['dict', 'sequence']);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

let connection: Promise<IDBDatabase> | undefined;
const db = () => (connection ??= open());

const result = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const finished = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = tx.onabort = () => reject(tx.error);
});

export interface Dictionary {
  title: string;
  count: number | null;
  tags?: boolean;
  meta?: number;
  // An import from before Minerr kept the sequences of JMdict redirects has no entries count.
  entries?: number;
  rank?: number;
  disabled?: boolean;
}

// Earlier versions of Minerr wrote some of the rows, so the rows are checked as they are read.
const hasString = (row: unknown, key: string) => typeof at(row, key) === 'string';
const hasStrings = (row: unknown, key: string) => at(row, key) === undefined || isStringList(at(row, key));

const isDictionary = (row: unknown): row is Dictionary => hasString(row, 'title')
  && (at(row, 'count') === null || typeof at(row, 'count') === 'number')
  && (at(row, 'tags') === undefined || typeof at(row, 'tags') === 'boolean')
  && (at(row, 'meta') === undefined || typeof at(row, 'meta') === 'number')
  && (at(row, 'entries') === undefined || typeof at(row, 'entries') === 'number')
  && (at(row, 'rank') === undefined || typeof at(row, 'rank') === 'number')
  && (at(row, 'disabled') === undefined || typeof at(row, 'disabled') === 'boolean');

const isDictTerm = (row: unknown): row is DictTerm => ['dict', 'expression', 'reading'].every(key => hasString(row, key))
  && typeof at(row, 'score') === 'number' && isStringList(at(row, 'glossary'))
  && hasStrings(row, 'definitionTags') && hasStrings(row, 'termTags') && hasStrings(row, 'notes');

const isEntryRow = (row: unknown): row is EntryRow => ['dict', 'expression', 'reading'].every(key => hasString(row, key))
  && typeof at(row, 'score') === 'number' && typeof at(row, 'sequence') === 'number';

const isDictTag = (row: unknown): row is DictTag => ['dict', 'name', 'category', 'notes'].every(key => hasString(row, key));

const isDictMeta = (row: unknown): row is DictMeta => hasString(row, 'dict') && hasString(row, 'expression')
  && ((at(row, 'mode') === 'freq' && typeof at(row, 'value') === 'number' && hasString(row, 'display') && typeof at(row, 'ranked') === 'boolean')
    || (at(row, 'mode') === 'pitch' && hasString(row, 'reading') && isList(at(row, 'positions'))));

// getAll gives title order and the sort is stable, so an install from before ranks keeps its order.
async function inRankOrder(dicts: IDBObjectStore): Promise<Dictionary[]> {
  const rows: unknown[] = await result(dicts.getAll());
  return rows.filter(isDictionary).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
}

export async function listDictionaries(): Promise<Dictionary[]> {
  return inRankOrder((await db()).transaction('dicts').objectStore('dicts'));
}

// One read-write transaction, and target gets the current position, so two quick moves cannot both start from the same order.
export async function moveDictionary(title: string, target: (from: number) => number): Promise<void> {
  const tx = (await db()).transaction('dicts', 'readwrite');
  const dicts = tx.objectStore('dicts');
  const rows = await inRankOrder(dicts);
  const from = rows.findIndex(row => row.title === title);
  const to = target(from);
  const row = rows[from];
  if (!row || to < 0 || to >= rows.length) return;
  rows.splice(from, 1);
  rows.splice(to, 0, row);
  rows.forEach((item, rank) => dicts.put({ ...item, rank }));
  await finished(tx);
}

export async function setDictionaryDisabled(title: string, disabled: boolean): Promise<void> {
  const tx = (await db()).transaction('dicts', 'readwrite');
  const dicts = tx.objectStore('dicts');
  const row: unknown = await result(dicts.get(title));
  if (isDictionary(row)) dicts.put({ ...row, disabled });
  await finished(tx);
}

// The list position of each dictionary that is on. A dictionary that is off has no position.
async function positionsOfOn(tx: IDBTransaction): Promise<Map<string, number>> {
  const dicts = await inRankOrder(tx.objectStore('dicts'));
  return new Map(dicts.filter(dict => !dict.disabled).map((dict, position) => [dict.title, position] as const));
}

// The rows of the dictionaries that are on, in list order. The sort is stable, so the order inside one dictionary stays.
const ofOn = <T extends { dict: string }>(rows: T[], on: Map<string, number>) => rows.filter(row => on.has(row.dict))
  .sort((a, b) => (on.get(a.dict) ?? 0) - (on.get(b.dict) ?? 0));

// The keys of an index read, [dict, id], so a hot path need not deserialize the rows to see which dictionary has a word.
const hasKeyOfOn = (keys: unknown, on: Map<string, number>) => isList(keys) && keys.some(key => on.has(String(at(key, 0))));

// An array sorts after every number and string, so [title, []] is above every [title, id] and [title, name] key.
const keysOf = (title: string) => IDBKeyRange.bound([title], [title, []]);

export async function deleteDictionary(title: string): Promise<void> {
  const tx = (await db()).transaction(['dicts', 'terms', 'tags', 'meta'], 'readwrite');
  tx.objectStore('dicts').delete(title);
  for (const store of ['terms', 'tags', 'meta']) tx.objectStore(store).delete(keysOf(title));
  await finished(tx);
}

async function putDictionary(meta: Dictionary & { revision: string }): Promise<void> {
  const tx = (await db()).transaction('dicts', 'readwrite');
  tx.objectStore('dicts').put(meta);
  await finished(tx);
}

export interface ImportProgress {
  bank: number;
  banks: number;
  count: number;
}

// Re-importing a title replaces it, so a crashed or repeated import converges to one clean copy.
export async function importDictionary(bytes: Bytes, onProgress: (progress: ImportProgress) => void): Promise<{ title: string; count: number; meta: number }> {
  const { title, revision, frequencyMode, tags, banks, metaBanks } = await readYomitan(bytes);
  const installed = await listDictionaries();
  const old = installed.find(dict => dict.title === title);
  const order = {
    rank: old ? old.rank ?? 0 : Math.max(0, ...installed.map(dict => dict.rank ?? 0)) + 1,
    disabled: old?.disabled ?? false,
  };
  await deleteDictionary(title);
  await putDictionary({ title, revision, count: null, ...order });
  const tagTx = (await db()).transaction('tags', 'readwrite');
  for (const tag of tags) tagTx.objectStore('tags').put({ ...tag, dict: title });
  await finished(tagTx);
  let count = 0;
  let entries = 0;
  const inlineNames = new Set<string>();
  for (const [index, load] of banks.entries()) {
    const terms = await load();
    const tx = (await db()).transaction(['terms', 'tags'], 'readwrite');
    const store = tx.objectStore('terms');
    for (const { inlineTags = [], ...term } of terms) {
      for (const tag of inlineTags) {
        if (inlineNames.has(tag.name)) continue;
        inlineNames.add(tag.name);
        tx.objectStore('tags').put({ ...tag, dict: title });
      }
      store.put({ ...term, dict: title, id: count++ });
      if (term.sequence !== undefined) entries++;
    }
    await finished(tx);
    onProgress({ bank: index + 1, banks: banks.length + metaBanks.length, count });
  }
  let meta = 0;
  for (const [index, load] of metaBanks.entries()) {
    const rows = await load();
    const tx = (await db()).transaction('meta', 'readwrite');
    const ranked = frequencyMode === 'rank-based';
    for (const row of rows) tx.objectStore('meta').put({ ...row, ...(row.mode === 'freq' ? { ranked } : {}), dict: title, id: meta++ });
    await finished(tx);
    onProgress({ bank: banks.length + index + 1, banks: banks.length + metaBanks.length, count });
  }
  await putDictionary({ title, revision, count, tags: true, meta, entries, ...order });
  return { title, count, meta };
}

async function metaOf(tx: IDBTransaction, expressions: string[], on: Map<string, number>): Promise<DictMeta[]> {
  const index = tx.objectStore('meta').index('expression');
  const rows: unknown[][] = await Promise.all(expressions.map(expression => result(index.getAll(expression))));
  return ofOn(rows.flat().filter(isDictMeta), on);
}

// True if a term dictionary has lemma as an expression or a reading. Cheaper than lookup, for the many tries of Alt+S.
export async function hasTerm(lemma: string): Promise<boolean> {
  const tx = (await db()).transaction(['dicts', 'terms']);
  const terms = tx.objectStore('terms');
  const on = await positionsOfOn(tx);
  const keys = await Promise.all([result(terms.index('expression').getAllKeys(lemma)), result(terms.index('reading').getAllKeys(lemma))]);
  return keys.some(found => hasKeyOfOn(found, on));
}

// The reads of one task share one transaction, because a transaction for each of the thousands of reads of a page is slow.
type Read = { start: (terms: IDBObjectStore) => IDBRequest; done: (value: unknown) => void; fail: (error: unknown) => void };
let reads: Read[] = [];

async function runReads(): Promise<void> {
  const batch = reads;
  reads = [];
  try {
    const terms = (await db()).transaction('terms').objectStore('terms');
    for (const { start, done, fail } of batch) result(start(terms)).then(done, fail);
  } catch (error) {
    for (const { fail } of batch) fail(error);
  }
}

const read = (start: Read['start']) => new Promise<unknown>((done, fail) => {
  if (!reads.length) setTimeout(runReads);
  reads.push({ start, done, fail });
});

async function entryRows(index: 'expression' | 'reading' | 'sequence', key: IDBValidKey, count?: number): Promise<EntryRow[]> {
  const rows = await read(terms => terms.index(index).getAll(key, count));
  return isList(rows) ? rows.filter(isEntryRow) : [];
}

// The terms with a sequence, for the spelling resolver of src/text/entry.ts.
export const entryIndex: EntryIndex = {
  byExpression: text => entryRows('expression', text),
  byReading: text => entryRows('reading', text),
  // One row more than an entry can have is enough to see that the sequence is not an entry.
  bySequence: (dict, sequence) => entryRows('sequence', [dict, sequence], MAX_ENTRY_ROWS + 1),
  headwords: async texts => {
    const on = await positionsOfOn((await db()).transaction('dicts'));
    const keys = await Promise.all(texts.map(text => read(terms => terms.index('expression').getAllKeys(text))));
    return new Set(texts.filter((_, i) => hasKeyOfOn(keys[i], on)));
  },
};

// Returns groupTerms groups for the best `limit` rows of each dictionary that is on, with their frequencies and pitch accents.
// A row is one sense, so the limit fits all senses of a common word. Per dictionary, so that a big dictionary hides no other one.
// Scores order the readings and rank orders the senses of a reading: a card takes the first reading, and a rank must not change it.
export async function lookup(lemma: string, limit = 40): Promise<Entry[]> {
  const tx = (await db()).transaction(['dicts', 'terms', 'tags', 'meta']);
  const terms = tx.objectStore('terms');
  const on = await positionsOfOn(tx);
  const byScore = (a: DictTerm, b: DictTerm) => b.score - a.score;
  const usable = (found: unknown[]) => {
    const rows = found.filter(isDictTerm);
    return [...on.keys()].flatMap(dict => rows.filter(row => row.dict === dict).sort(byScore).slice(0, limit)).sort(byScore);
  };
  let rows = usable(await result(terms.index('expression').getAll(lemma)));
  // A word that only a dictionary that is off has as an expression can still be a reading in one that is on.
  if (!rows.length) rows = usable(await result(terms.index('reading').getAll(lemma)));
  const dicts = [...new Set(rows.map(row => row.dict))];
  const tags: unknown[][] = await Promise.all(dicts.map(dict => result(tx.objectStore('tags').getAll(keysOf(dict)))));
  const groups = groupTerms(rows, tags.flat().filter(isDictTag)).map(group => ({ ...group, senses: ofOn(group.senses, on) }));
  return withMeta(groups, await metaOf(tx, [...new Set(groups.map(group => group.expression))], on));
}

// The pitch pattern of each word on a page, for the pitch colors. reading is the reading on the page, in hiragana.
// A word with more than one reading in the dictionary gets the pattern of the reading on the page, or else of its first reading.
export async function pitchPatterns(words: { lemma: string; reading: string }[]): Promise<(PitchPattern | null)[]> {
  const tx = (await db()).transaction(['dicts', 'meta']);
  const rows = await metaOf(tx, [...new Set(words.map(word => word.lemma))], await positionsOfOn(tx));
  return words.map(({ lemma, reading }) => {
    const pitches = rows.flatMap(row => (row.mode === 'pitch' && row.expression === lemma ? [row] : []));
    const pitch = pitches.find(row => row.reading === reading) ?? pitches[0];
    const position = pitch?.positions[0];
    return pitch && position !== undefined ? pitchPattern(position, morae(pitch.reading).length) : null;
  });
}
