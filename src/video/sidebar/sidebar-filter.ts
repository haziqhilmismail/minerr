// The filters of the subtitle sidebar (src/video/sidebar/sidebar.ts), after the filters of Migaku's subtitle browser.
import { isIPlusOne } from '../../text/sentence.ts';
import type { Status } from '../../status/status.ts';

// A word of a line: its status key (src/text/word-spans.ts wordOf) and its status.
export interface LineWord {
  key: string;
  status: Status;
}

// What a filter reads of a line: its words, and whether the user bookmarked it.
export interface LineState {
  words: LineWord[];
  marked: boolean;
}

const unknowns = ({ words }: LineState) => words.filter(word => word.status === 'unknown');
const iPlusOne = ({ words }: LineState) => isIPlusOne(words.map(word => word.status));

// once: of the lines that the filter keeps with the same once key, only the first line shows.
interface Filter {
  label: string;
  keeps: (line: LineState) => boolean;
  once?: (line: LineState) => string;
}

export const LINE_FILTERS = {
  all: { label: 'All lines', keeps: () => true },
  unknown: { label: '1+ unknown words', keeps: line => unknowns(line).length >= 1 },
  unknown2: { label: '2+ unknown words', keeps: line => unknowns(line).length >= 2 },
  iPlusOne: { label: '1 unknown word', keeps: iPlusOne },
  // The first line of each unknown word: a word in many i+1 lines gives one line to mine.
  unique: { label: 'Unique 1 unknown word', keeps: iPlusOne, once: line => unknowns(line)[0]?.key ?? '' },
  learning: { label: 'Learning', keeps: ({ words }) => words.some(word => word.status === 'learning') },
  known: { label: 'All known', keeps: ({ words }) => words.length > 0 && words.every(word => word.status === 'known' || word.status === 'ignored') },
  bookmarks: { label: 'Bookmarks', keeps: ({ marked }) => marked },
} satisfies Record<string, Filter>;
export type LineFilter = keyof typeof LINE_FILTERS;

export const FILTER_NAMES = Object.keys(LINE_FILTERS).filter((name): name is LineFilter => Object.hasOwn(LINE_FILTERS, name));

// The words to choose from for the card of a line: the unknown words first, then the others, each word once.
export function choices<Word extends LineWord>(words: Word[]): Word[] {
  const sorted = [...words.filter(word => word.status === 'unknown'), ...words.filter(word => word.status !== 'unknown')];
  return sorted.filter((word, index) => sorted.findIndex(other => other.key === word.key) === index);
}

// The word that the card of a line gets without a choice: the one unknown word of the line, else null.
export function targetWord<Word extends LineWord>(words: Word[]): Word | null {
  const [only, ...more] = words.filter(word => word.status === 'unknown');
  return only && !more.length ? only : null;
}

// For each line, true when the filter shows it.
export function shownLines(lines: LineState[], filter: LineFilter): boolean[] {
  const { keeps, once }: Filter = LINE_FILTERS[filter];
  const seen = new Set<string>();
  return lines.map(line => {
    if (!keeps(line)) return false;
    if (!once) return true;
    const key = once(line);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
