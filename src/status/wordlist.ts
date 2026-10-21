import type { Segment } from '../text/group.ts';
import { STATUS_NAMES, type StoredStatus } from './status.ts';

export type Filter = StoredStatus | 'all';
export type Sort = 'word' | 'status';

export interface Query {
  search: string;
  filter: Filter;
  sort: Sort;
}

const collator = new Intl.Collator('ja');
const rank = (status: StoredStatus) => STATUS_NAMES.indexOf(status);

// The lemmas that the word browser lists for the query, in its order.
export function listWords(words: ReadonlyMap<string, StoredStatus>, { search, filter, sort }: Query): string[] {
  const needle = search.trim();
  const found = [...words].filter(([lemma, status]) => (filter === 'all' || status === filter) && lemma.includes(needle));
  const byWord = (a: string, b: string) => collator.compare(a, b);
  found.sort(sort === 'word' ? ([a], [b]) => byWord(a, b) : ([a, x], [b, y]) => rank(x) - rank(y) || byWord(a, b));
  return found.map(([lemma]) => lemma);
}

// The words of a list with one word on each line, each one time.
export const wordsOfLines = (text: string): string[] => [...new Set(text.split('\n').map(line => line.trim()).filter(Boolean))];

// The status keys of the words of parsed text, each one time.
export const keysOf = (parsed: Segment[][]): string[] => [...new Set(parsed.flat().flatMap(({ lemma, entry }) => (lemma ? [entry?.key ?? lemma] : [])))];
