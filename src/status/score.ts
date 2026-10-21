import { iPlusOneSentences, type Piece, type Point } from '../text/sentence.ts';
import type { Status } from './status.ts';

// Migaku's labels for the comprehension score, with the lowest score of each (from the Migaku 1.31 extension).
// color is a token of src/shared/design-tokens.ts.
export const RATINGS = [
  { label: 'Exceptional', min: 99, color: 'var(--ok)' },
  { label: 'Excellent', min: 95, color: 'var(--ok)' },
  { label: 'Great', min: 90, color: 'var(--ok)' },
  { label: 'Good', min: 80, color: 'var(--warn)' },
  { label: 'Approachable', min: 70, color: 'var(--warn)' },
  { label: 'Challenging', min: 60, color: 'var(--error)' },
  { label: 'Ambitious', min: 0, color: 'var(--error)' },
] as const;

export type Rating = (typeof RATINGS)[number];

export const ratingOf = (percent: number): Rating => RATINGS.find(rating => percent >= rating.min) ?? RATINGS[6];

// One word on the page or in a subtitle line, by its status key, with its status.
export interface Word {
  key: string;
  status: Status;
}

export interface Comprehension {
  // The percent of the words that are known or ignored, rounded down, so 99 or more means almost every word.
  percent: number;
  rating: Rating;
  words: number;
  // The number of different words (status keys) with each status.
  unique: Record<Status, number>;
}

// A learning word is not understood yet; an ignored word (for example a name) does not stop the reader.
export function comprehension(words: Word[]): Comprehension | null {
  if (!words.length) return null;
  const understood = words.filter(word => word.status === 'known' || word.status === 'ignored').length;
  const percent = Math.floor((understood / words.length) * 100);
  const unique: Record<Status, number> = { unknown: 0, learning: 0, known: 0, ignored: 0 };
  for (const status of new Map(words.map(word => [word.key, word.status])).values()) unique[status]++;
  return { percent, rating: ratingOf(percent), words: words.length, unique };
}

export function iPlusOneTexts(pieces: Piece[]): string[] {
  const starts: number[] = [];
  let length = 0;
  for (const piece of pieces) {
    starts.push(length);
    length += piece.text.length;
  }
  const text = pieces.map(piece => piece.text).join('');
  const offsetOf = ({ piece, offset }: Point) => (starts[piece] ?? length) + offset;
  return iPlusOneSentences(pieces).map(({ start, end }) => text.slice(offsetOf(start), offsetOf(end)));
}
