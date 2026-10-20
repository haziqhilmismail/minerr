import { groupTerms, readYomitan } from './yomitan.js';

// Stores: dicts {title, revision, count, tags} (count is null while an import is unfinished; tags is true
// for an import that stored tags), terms {dict, id, expression, reading, definitionTags, termTags, glossary, score}
// keyed by [dict, id], and tags {dict, name, category, notes} keyed by [dict, name].
// The [dict, ...] keys let one key range delete a dictionary.
function open() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('minerr', 2);
    request.onupgradeneeded = event => {
      const db = request.result;
      if (event.oldVersion < 1) {
        db.createObjectStore('dicts', { keyPath: 'title' });
        const terms = db.createObjectStore('terms', { keyPath: ['dict', 'id'] });
        terms.createIndex('expression', 'expression');
        terms.createIndex('reading', 'reading');
      }
      if (event.oldVersion < 2) db.createObjectStore('tags', { keyPath: ['dict', 'name'] });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

let connection;
const db = () => (connection ??= open());

const result = request => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const finished = tx => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = tx.onabort = () => reject(tx.error);
});

export async function listDictionaries() {
  return result((await db()).transaction('dicts').objectStore('dicts').getAll());
}

// An array sorts after every number and string, so [title, []] is above every [title, id] and [title, name] key.
const keysOf = title => IDBKeyRange.bound([title], [title, []]);

export async function deleteDictionary(title) {
  const tx = (await db()).transaction(['dicts', 'terms', 'tags'], 'readwrite');
  tx.objectStore('dicts').delete(title);
  tx.objectStore('terms').delete(keysOf(title));
  tx.objectStore('tags').delete(keysOf(title));
  await finished(tx);
}

async function putDictionary(meta) {
  const tx = (await db()).transaction('dicts', 'readwrite');
  tx.objectStore('dicts').put(meta);
  await finished(tx);
}

// Re-importing a title replaces it, so a crashed or repeated import converges to one clean copy.
export async function importDictionary(bytes, onProgress) {
  const { title, revision, tags, banks } = await readYomitan(bytes);
  await deleteDictionary(title);
  await putDictionary({ title, revision, count: null });
  const tagTx = (await db()).transaction('tags', 'readwrite');
  for (const tag of tags) tagTx.objectStore('tags').put({ ...tag, dict: title });
  await finished(tagTx);
  let count = 0;
  for (const [index, load] of banks.entries()) {
    const terms = await load();
    const tx = (await db()).transaction('terms', 'readwrite');
    const store = tx.objectStore('terms');
    for (const term of terms) store.put({ ...term, dict: title, id: count++ });
    await finished(tx);
    onProgress({ bank: index + 1, banks: banks.length, count });
  }
  await putDictionary({ title, revision, count, tags: true });
  return { title, count };
}

// Returns groupTerms groups for the best `limit` rows. A row is one sense, so the limit fits all senses of a common word.
export async function lookup(lemma, limit = 40) {
  const tx = (await db()).transaction(['terms', 'tags']);
  const terms = tx.objectStore('terms');
  let rows = await result(terms.index('expression').getAll(lemma));
  if (!rows.length) rows = await result(terms.index('reading').getAll(lemma));
  rows = rows.sort((a, b) => b.score - a.score).slice(0, limit);
  const dicts = [...new Set(rows.map(row => row.dict))];
  const tags = await Promise.all(dicts.map(dict => result(tx.objectStore('tags').getAll(keysOf(dict)))));
  return groupTerms(rows, tags.flat());
}
