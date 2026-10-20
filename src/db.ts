import { type EntryIndex, type EntryRow, MAX_ENTRY_ROWS } from './entry.ts';
import { type DictMeta, type Entry, morae, pitchPattern, type PitchPattern, withMeta } from './meta.ts';
import { at, isList, isStringList } from './parse.ts';
import { type DictTag, type DictTerm, groupTerms, readYomitan } from './yomitan.ts';
import type { Bytes } from './zip.ts';

// Stores: dicts {title, revision, count, tags, meta, entries} (count is null while an import is unfinished; tags is true
// for an import that stored tags; meta counts the meta rows; entries counts the terms with a sequence), terms {dict, id,
// expression, reading, definitionTags, termTags, glossary, score, sequence} keyed by [dict, id], tags {dict, name, category,
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
}

// Earlier versions of Minerr wrote some of the rows, so the rows are checked as they are read.
const hasString = (row: unknown, key: string) => typeof at(row, key) === 'string';
const hasTagNames = (row: unknown, key: string) => at(row, key) === undefined || isStringList(at(row, key));

const isDictionary = (row: unknown): row is Dictionary => hasString(row, 'title')
  && (at(row, 'count') === null || typeof at(row, 'count') === 'number')
  && (at(row, 'tags') === undefined || typeof at(row, 'tags') === 'boolean')
  && (at(row, 'meta') === undefined || typeof at(row, 'meta') === 'number')
  && (at(row, 'entries') === undefined || typeof at(row, 'entries') === 'number');

const isDictTerm = (row: unknown): row is DictTerm => ['dict', 'expression', 'reading'].every(key => hasString(row, key))
  && typeof at(row, 'score') === 'number' && isStringList(at(row, 'glossary'))
  && hasTagNames(row, 'definitionTags') && hasTagNames(row, 'termTags');

const isEntryRow = (row: unknown): row is EntryRow => ['dict', 'expression', 'reading'].every(key => hasString(row, key))
  && typeof at(row, 'score') === 'number' && typeof at(row, 'sequence') === 'number';

const isDictTag = (row: unknown): row is DictTag => ['dict', 'name', 'category', 'notes'].every(key => hasString(row, key));

const isDictMeta = (row: unknown): row is DictMeta => hasString(row, 'dict') && hasString(row, 'expression')
  && ((at(row, 'mode') === 'freq' && typeof at(row, 'value') === 'number' && hasString(row, 'display') && typeof at(row, 'ranked') === 'boolean')
    || (at(row, 'mode') === 'pitch' && hasString(row, 'reading') && isList(at(row, 'positions'))));

export async function listDictionaries(): Promise<Dictionary[]> {
  const rows: unknown[] = await result((await db()).transaction('dicts').objectStore('dicts').getAll());
  return rows.filter(isDictionary);
}

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
  await deleteDictionary(title);
  await putDictionary({ title, revision, count: null });
  const tagTx = (await db()).transaction('tags', 'readwrite');
  for (const tag of tags) tagTx.objectStore('tags').put({ ...tag, dict: title });
  await finished(tagTx);
  let count = 0;
  let entries = 0;
  for (const [index, load] of banks.entries()) {
    const terms = await load();
    const tx = (await db()).transaction('terms', 'readwrite');
    const store = tx.objectStore('terms');
    for (const term of terms) {
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
  await putDictionary({ title, revision, count, tags: true, meta, entries });
  return { title, count, meta };
}

async function metaOf(tx: IDBTransaction, expressions: string[]): Promise<DictMeta[]> {
  const index = tx.objectStore('meta').index('expression');
  const rows: unknown[][] = await Promise.all(expressions.map(expression => result(index.getAll(expression))));
  return rows.flat().filter(isDictMeta);
}

// True if a term dictionary has lemma as an expression or a reading. Cheaper than lookup, for the many tries of Alt+S.
export async function hasTerm(lemma: string): Promise<boolean> {
  const terms = (await db()).transaction('terms').objectStore('terms');
  const counts = await Promise.all([result(terms.index('expression').count(lemma)), result(terms.index('reading').count(lemma))]);
  return counts.some(count => count > 0);
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

// The terms with a sequence, for the spelling resolver of src/entry.ts.
export const entryIndex: EntryIndex = {
  byExpression: text => entryRows('expression', text),
  byReading: text => entryRows('reading', text),
  // One row more than an entry can have is enough to see that the sequence is not an entry.
  bySequence: (dict, sequence) => entryRows('sequence', [dict, sequence], MAX_ENTRY_ROWS + 1),
  headwords: async texts => {
    const counts = await Promise.all(texts.map(text => read(terms => terms.index('expression').count(text))));
    return new Set(texts.filter((_, i) => Number(counts[i]) > 0));
  },
};

// Returns groupTerms groups for the best `limit` rows, with their frequencies and pitch accents.
// A row is one sense, so the limit fits all senses of a common word.
export async function lookup(lemma: string, limit = 40): Promise<Entry[]> {
  const tx = (await db()).transaction(['terms', 'tags', 'meta']);
  const terms = tx.objectStore('terms');
  let found: unknown[] = await result(terms.index('expression').getAll(lemma));
  if (!found.length) found = await result(terms.index('reading').getAll(lemma));
  const rows = found.filter(isDictTerm).sort((a, b) => b.score - a.score).slice(0, limit);
  const dicts = [...new Set(rows.map(row => row.dict))];
  const tags: unknown[][] = await Promise.all(dicts.map(dict => result(tx.objectStore('tags').getAll(keysOf(dict)))));
  const groups = groupTerms(rows, tags.flat().filter(isDictTag));
  return withMeta(groups, await metaOf(tx, [...new Set(groups.map(group => group.expression))]));
}

// The pitch pattern of each word on a page, for the pitch colors. reading is the reading on the page, in hiragana.
// A word with more than one reading in the dictionary gets the pattern of the reading on the page, or else of its first reading.
export async function pitchPatterns(words: { lemma: string; reading: string }[]): Promise<(PitchPattern | null)[]> {
  const tx = (await db()).transaction('meta');
  const rows = await metaOf(tx, [...new Set(words.map(word => word.lemma))]);
  return words.map(({ lemma, reading }) => {
    const pitches = rows.flatMap(row => (row.mode === 'pitch' && row.expression === lemma ? [row] : []));
    const pitch = pitches.find(row => row.reading === reading) ?? pitches[0];
    const position = pitch?.positions[0];
    return pitch && position !== undefined ? pitchPattern(position, morae(pitch.reading).length) : null;
  });
}
