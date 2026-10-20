// Pure parts of the reader page: text files to chapters, page turns, and the saved reading position.

export interface TextChapter {
  title: string;
  paragraphs: string[];
}

// A text part of about this many characters keeps the parse of the shown part quick.
const PART_CHARS = 10_000;

export const textParagraphs = (text: string): string[] => text.replace(/^﻿/, '').split(/\r\n?|\n/).filter(line => line.trim());

// Splits the paragraphs into parts at paragraph ends. One part takes the title of the file.
export function textChapters(title: string, paragraphs: string[], partChars = PART_CHARS): TextChapter[] {
  const parts: string[][] = [];
  let size = Infinity;
  for (const paragraph of paragraphs) {
    if (size >= partChars) {
      parts.push([]);
      size = 0;
    }
    parts.at(-1)?.push(paragraph);
    size += paragraph.length;
  }
  return parts.length === 1 ? [{ title, paragraphs: parts[0] ?? [] }] : parts.map((part, i) => ({ title: `Part ${i + 1}`, paragraphs: part }));
}

export type PageMove = 'next' | 'previous';

// The keys that turn the page. Vertical text reads from right to left, so the left arrow goes forward.
export function pageMove(key: string, shift: boolean, vertical: boolean): PageMove | null {
  switch (key) {
    case 'PageDown': return 'next';
    case 'PageUp': return 'previous';
    case ' ': return shift ? 'previous' : 'next';
    case 'ArrowDown': return 'next';
    case 'ArrowUp': return 'previous';
    case 'ArrowLeft': return vertical ? 'next' : 'previous';
    case 'ArrowRight': return vertical ? 'previous' : 'next';
    default: return null;
  }
}

// The scroll position along the reading direction: offset from the start, the size of the view, and the size of the text.
export interface Viewport {
  offset: number;
  size: number;
  total: number;
}

export type Turn = { kind: 'scroll'; to: number } | { kind: 'chapter'; step: 1 | -1 };

// A page is 90% of the view, so the last line of a page is the first line of the next page.
export function turn(move: PageMove, { offset, size, total }: Viewport): Turn {
  const page = Math.max(1, Math.round(size * 0.9));
  const end = Math.max(0, total - size);
  if (move === 'next') return offset >= end - 1 ? { kind: 'chapter', step: 1 } : { kind: 'scroll', to: Math.min(end, offset + page) };
  return offset <= 1 ? { kind: 'chapter', step: -1 } : { kind: 'scroll', to: Math.max(0, offset - page) };
}

// The place in a file: the chapter, and the fraction of the chapter before the view (0 to 1).
export interface Position {
  chapter: number;
  progress: number;
}

export const isPosition = (value: unknown): value is Position => typeof value === 'object' && value !== null
  && 'chapter' in value && Number.isInteger(value.chapter) && Number(value.chapter) >= 0
  && 'progress' in value && typeof value.progress === 'number' && value.progress >= 0 && value.progress <= 1;

// The same file has the same name and size, also when it comes from a different folder.
export const positionKey = (name: string, size: number) => `reader:${size}:${name}`;

// A zip member path from the path of the file that links to it and the link (an href, relative to that file).
export function zipPath(from: string, href: string): string {
  const url = new URL(href, `zip:/${from}`);
  return decodeURIComponent(url.pathname.slice(1));
}
