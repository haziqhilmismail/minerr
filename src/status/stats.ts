// The comprehension score of the tab and its i+1 sentences, for the toolbar popup.
// With timed subtitles (src/video/video.ts), the score covers every line of the track. With only the mirrored captions of the site,
// it covers the lines that the overlay showed. Elsewhere, it covers the page text.
import type { SubtitleSegment } from '../video/captions.ts';
import { iPlusOneRanges, statusOf } from '../page-text/iplusone.ts';
import { call, serve } from '../shared/rpc.ts';
import { comprehension, type Comprehension, iPlusOneTexts, type Word } from './score.ts';
import type { Piece } from '../text/sentence.ts';
import { getStatuses, type WordId } from './status.ts';
import { segmentWord, wordOf } from '../text/word-spans.ts';

// sentences are the i+1 sentences, each one time, in text order. pageStatsShow scrolls to a page sentence;
// a subtitle line is not on the page now. lines is the number of subtitle lines in the score:
// every line of the track ('track'), or the lines that the overlay showed ('shown').
export type PageStats = { score: Comprehension | null; sentences: string[] } & ({ source: 'page' } | { source: 'track' | 'shown'; lines: number });

// A part of a subtitle line: a word, or plain text with word null.
interface Token {
  text: string;
  word: WordId | null;
}

const FOCUS = 'minerr-focus';
const FOCUS_MS = 2000;
document.head.append(Object.assign(document.createElement('style'), {
  textContent: `::highlight(${FOCUS}) { background-color: rgba(250, 204, 21, 0.75); color: #000; }`,
}));

const tidy = (text: string) => text.replace(/\s+/g, ' ').trim();

// The ranges of the sentences in the last page reply, in the order of its list.
let shownRanges: Range[] = [];

function pageStats(): PageStats {
  const words: Word[] = [...document.querySelectorAll<HTMLElement>('.ml-word')]
    .map(span => ({ key: wordOf(span).key, status: statusOf(span) ?? 'unknown' }));
  const sentences = new Map<string, Range>();
  for (const range of iPlusOneRanges()) {
    const text = tidy(range.toString());
    if (!sentences.has(text)) sentences.set(text, range);
  }
  shownRanges = [...sentences.values()];
  return { source: 'page', score: comprehension(words), sentences: [...sentences.keys()] };
}

// The subtitle lines of the current video that the overlay showed, by their text.
const shownLines = new Map<string, Token[]>();
let lineVideo = '';

function recordLine(): void {
  const line = document.querySelector('.minerr-subs-line');
  const video = new URLSearchParams(location.search).get('v') ?? location.pathname;
  if (video !== lineVideo) {
    lineVideo = video;
    shownLines.clear();
  }
  // page.ts replaces the text of the line with word spans after the parse; record the line once it has them.
  const text = line?.textContent ?? '';
  if (!line || !text || shownLines.has(text) || !line.querySelector('.ml-word')) return;
  shownLines.set(text, [...line.childNodes].map(node => ({
    text: node.textContent ?? '',
    word: node instanceof HTMLElement && node.classList.contains('ml-word') ? wordOf(node) : null,
  })));
}

// The timed lines of the video, and the parse of the last track, by the text of its lines.
let track: SubtitleSegment[] | null = null;
let parsedTrack: { key: string; lines: Promise<Token[][]> } | null = null;

export function setTrack(segments: SubtitleSegment[]): void {
  track = segments.length ? segments : null;
}

function trackLines(segments: SubtitleSegment[]): Promise<Token[][]> {
  const texts = segments.map(segment => segment.text);
  const key = texts.join('\n');
  if (parsedTrack?.key === key) return parsedTrack.lines;
  const parsed = call({ type: 'parse', texts }).then(
    reply => reply.map(line => line.map(segment => ({ text: segment.text, word: segment.lemma ? segmentWord(segment) : null }))),
    error => {
      if (parsedTrack?.lines === parsed) parsedTrack = null;
      throw error;
    });
  parsedTrack = { key, lines: parsed };
  return parsed;
}

async function lineStats(tokens: Token[][]): Promise<Pick<PageStats, 'score' | 'sentences'>> {
  const statuses = await getStatuses(tokens.flat().flatMap(token => (token.word ? [token.word] : [])));
  const statusOfWord = ({ key }: WordId) => statuses.get(key) ?? 'unknown';
  const pieces = tokens.map(line => line.map(({ text, word }): Piece => ({ text, status: word ? statusOfWord(word) : null })));
  const words = tokens.flat().flatMap(({ word }) => (word ? [{ key: word.key, status: statusOfWord(word) }] : []));
  return { score: comprehension(words), sentences: [...new Set(pieces.flatMap(iPlusOneTexts))] };
}

let focusTimer: ReturnType<typeof setTimeout> | undefined;

function show({ index }: { index: number }): void {
  const range = shownRanges[index];
  if (!range?.startContainer.isConnected) throw new Error('The page changed. Open this menu again.');
  range.startContainer.parentElement?.scrollIntoView({ block: 'center' });
  CSS.highlights.set(FOCUS, new Highlight(range));
  clearTimeout(focusTimer);
  focusTimer = setTimeout(() => CSS.highlights.delete(FOCUS), FOCUS_MS);
}

async function stats(): Promise<PageStats> {
  shownRanges = [];
  if (track) {
    const parsed = await trackLines(track);
    return { source: 'track', lines: parsed.length, ...await lineStats(parsed) };
  }
  // ponytail: any page with the overlay layer counts as a video page, also a YouTube page without a video; a page score there needs a URL rule.
  if (!document.querySelector('.minerr-subs')) return pageStats();
  recordLine();
  return { source: 'shown', lines: shownLines.size, ...await lineStats([...shownLines.values()]) };
}

serve({ pageStats: stats, pageStatsShow: show }, () => true);
for (const type of ['timeupdate', 'seeked']) document.addEventListener(type, recordLine, true);
