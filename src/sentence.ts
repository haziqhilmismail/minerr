import type { Status } from './status.ts';

// Sentence ends: 。！？ (full and half width) and line breaks. Closing quotes stay with their sentence.
const BOUNDARY = /(?<=[。｡！!？?\n][」』）)〉］\]]*)/;
const TAIL = /^[^。｡！!？?\n]*[。｡！!？?]*[」』）)〉］\]]*/;
// One whole sentence, with the same ends and closing quotes as BOUNDARY.
const SENTENCE = /[^。｡！!？?\n]*[。｡！!？?\n]*[」』）)〉］\]]*/g;
const MAX_SIDE = 150;

const tidy = (text: string) => text.replace(/\s+/g, ' ');

export interface Sentence {
  start: string;
  word: string;
  end: string;
}

// before/after are the block's text on each side of the word; returns the sentence that contains the word.
export function sentenceAround(before: string, word: string, after: string): Sentence {
  const start = tidy(before.split(BOUNDARY).at(-1) ?? '').slice(-MAX_SIDE).trimStart();
  const end = tidy(TAIL.exec(after)?.[0] ?? '').slice(0, MAX_SIDE).trimEnd();
  return { start, word, end };
}

// The start and end offsets in text of the sentence that holds the character at offset, without the white space at its edges.
export function sentenceBounds(text: string, offset: number): [number, number] {
  for (const match of text.matchAll(SENTENCE)) {
    const end = match.index + match[0].length;
    if (offset >= end && end < text.length) continue;
    const start = match.index + match[0].length - match[0].trimStart().length;
    return [start, Math.max(start, match.index + match[0].trimEnd().length)];
  }
  return [0, text.length];
}

// A run of the text of a block: a word with its status, or plain text with status null.
export interface Piece {
  text: string;
  status: Status | null;
}

// A place in a list of pieces: the index of a piece and a character offset in its text.
export interface Point {
  piece: number;
  offset: number;
}

// i+1: the sentence has exactly one unknown word, so it is a good sentence to mine.
// A single word (a link, a heading, a menu item) gives no context, so a sentence needs two words or more.
export const isIPlusOne = (statuses: Status[]): boolean =>
  statuses.length >= 2 && statuses.filter(status => status === 'unknown').length === 1;

// The i+1 sentences of a block, without the white space at their edges. A word belongs to the sentence where it starts.
export function iPlusOneSentences(pieces: Piece[]): { start: Point; end: Point }[] {
  const text = pieces.map(piece => piece.text).join('');
  const found: { start: Point; end: Point }[] = [];
  // Sentences come in text order, so two cursors that only move forward find the words and the points in one pass.
  let word = 0;
  let wordStart = 0;
  let piece = 0;
  let pieceStart = 0;
  // With isEnd, the point may be at the end of its piece; without it, the point is on a character of its piece.
  const pointAt = (offset: number, isEnd: boolean): Point => {
    for (let p = pieces[piece]; p; p = pieces[piece]) {
      const pieceEnd = pieceStart + p.text.length;
      if (isEnd ? pieceEnd >= offset : pieceEnd > offset) break;
      pieceStart = pieceEnd;
      piece++;
    }
    return { piece, offset: offset - pieceStart };
  };
  for (const match of text.matchAll(SENTENCE)) {
    const end = match.index + match[0].length;
    const statuses: Status[] = [];
    for (let p = pieces[word]; p && wordStart < end; p = pieces[word]) {
      if (p.status) statuses.push(p.status);
      wordStart += p.text.length;
      word++;
    }
    const sentence = match[0].trim();
    if (!sentence || !isIPlusOne(statuses)) continue;
    const from = end - match[0].trimStart().length;
    found.push({ start: pointAt(from, false), end: pointAt(from + sentence.length, true) });
  }
  return found;
}
