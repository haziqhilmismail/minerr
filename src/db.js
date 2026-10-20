import { readYomitan } from './yomitan.js';

// Stores: dicts {title, revision, count} (count is null while an import is unfinished),
// terms {dict, id, expression, reading, glossary, score} keyed by [dict, id] so one range deletes a dictionary.
function open() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('minerr', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('dicts', { keyPath: 'title' });
      const terms = request.result.createObjectStore('terms', { keyPath: ['dict', 'id'] });
      terms.createIndex('expression', 'expression');
      terms.createIndex('reading', 'reading');
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

export async function deleteDictionary(title) {
  const tx = (await db()).transaction(['dicts', 'terms'], 'readwrite');
  tx.objectStore('dicts').delete(title);
  tx.objectStore('terms').delete(IDBKeyRange.bound([title], [title, Infinity]));
  await finished(tx);
}

async function putDictionary(meta) {
  const tx = (await db()).transaction('dicts', 'readwrite');
  tx.objectStore('dicts').put(meta);
  await finished(tx);
}

// Re-importing a title replaces it, so a crashed or repeated import converges to one clean copy.
export async function importDictionary(bytes, onProgress) {
  const { title, revision, banks } = await readYomitan(bytes);
  await deleteDictionary(title);
  await putDictionary({ title, revision, count: null });
  let count = 0;
  for (const [index, load] of banks.entries()) {
    const terms = await load();
    const tx = (await db()).transaction('terms', 'readwrite');
    const store = tx.objectStore('terms');
    for (const term of terms) store.put({ ...term, dict: title, id: count++ });
    await finished(tx);
    onProgress({ bank: index + 1, banks: banks.length, count });
  }
  await putDictionary({ title, revision, count });
  return { title, count };
}

export async function lookup(lemma, limit = 5) {
  const terms = (await db()).transaction('terms').objectStore('terms');
  let rows = await result(terms.index('expression').getAll(lemma));
  if (!rows.length) rows = await result(terms.index('reading').getAll(lemma));
  return rows
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ dict, expression, reading, glossary }) => ({ dict, expression, reading, glossary }));
}
