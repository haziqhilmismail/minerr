// The comprehension score of the tab, for the toolbar popup.
// With timed subtitles (src/video/video.ts), the score covers every line of the track. With only the mirrored captions of the site,
// it covers the lines that the overlay showed. Elsewhere, it covers the page text.
import type { SubtitleSegment } from '../video/captions.ts';
import { call, serve } from '../shared/rpc.ts';
import { comprehension, type Comprehension, type Word } from './score.ts';
import { getStatuses, statusOf, type WordId } from './status.ts';
import { segmentWord, wordOf } from '../text/word-spans.ts';

// lines is the number of subtitle lines in the score: every line of the track ('track'), or the lines that the overlay showed ('shown').
export type PageStats = { score: Comprehension | null } & ({ source: 'page' } | { source: 'track' | 'shown'; lines: number });

function pageStats(): PageStats {
  const words: Word[] = [...document.querySelectorAll<HTMLElement>('.ml-word')]
    .map(span => ({ key: wordOf(span).key, status: statusOf(span) ?? 'unknown' }));
  return { source: 'page', score: comprehension(words) };
}

// The words of each subtitle line of the current video that the overlay showed, by the text of the line.
const shownLines = new Map<string, WordId[]>();
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
  shownLines.set(text, [...line.querySelectorAll<HTMLElement>(':scope > .ml-word')].map(wordOf));
}

// The timed lines of the video, and the parse of the last track, by the text of its lines.
let track: SubtitleSegment[] | null = null;
let parsedTrack: { key: string; lines: Promise<WordId[][]> } | null = null;

export function setTrack(segments: SubtitleSegment[]): void {
  track = segments.length ? segments : null;
}

function trackLines(segments: SubtitleSegment[]): Promise<WordId[][]> {
  const texts = segments.map(segment => segment.text);
  const key = texts.join('\n');
  if (parsedTrack?.key === key) return parsedTrack.lines;
  const parsed = call({ type: 'parse', texts }).then(
    reply => reply.map(line => line.flatMap(segment => (segment.lemma ? [segmentWord(segment)] : []))),
    error => {
      if (parsedTrack?.lines === parsed) parsedTrack = null;
      throw error;
    });
  parsedTrack = { key, lines: parsed };
  return parsed;
}

async function lineScore(lines: WordId[][]): Promise<Comprehension | null> {
  const ids = lines.flat();
  const statuses = await getStatuses(ids);
  return comprehension(ids.map(({ key }) => ({ key, status: statuses.get(key) ?? 'unknown' })));
}

async function stats(): Promise<PageStats> {
  if (track) {
    const parsed = await trackLines(track);
    return { source: 'track', lines: parsed.length, score: await lineScore(parsed) };
  }
  // ponytail: any page with the overlay layer counts as a video page, also a YouTube page without a video; a page score there needs a URL rule.
  if (!document.querySelector('.minerr-subs')) return pageStats();
  recordLine();
  return { source: 'shown', lines: shownLines.size, score: await lineScore([...shownLines.values()]) };
}

serve({ pageStats: stats }, () => true);
for (const type of ['timeupdate', 'seeked']) document.addEventListener(type, recordLine, true);
