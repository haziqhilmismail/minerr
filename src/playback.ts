// Pure rules for timed subtitle lines: which line is at a time, where a jump goes, and when a play mode pauses.
import type { SubtitleSegment } from './captions.ts';

// A seek lands on the start of a line, but the video can report a time a little before it.
const EPSILON = 0.05;

// The index of the last line that started at or before time, or -1 before the first line.
export function lastStarted(segments: SubtitleSegment[], time: number): number {
  let found = -1;
  segments.forEach((segment, i) => {
    if (segment.start <= time + EPSILON) found = i;
  });
  return found;
}

export const JUMPS = ['next', 'previous', 'replay'] as const;
export type Jump = (typeof JUMPS)[number];

// The start time of the line that a jump goes to, or null when there is no such line.
export function jumpTarget(segments: SubtitleSegment[], time: number, jump: Jump): number | null {
  const i = lastStarted(segments, time);
  const index = jump === 'next' ? i + 1 : jump === 'previous' ? i - 1 : i;
  return segments[index]?.start ?? null;
}

// Removes bracketed text such as （笑）, [音楽], and 【拍手】; a line with nothing else left drops out.
const BRACKETED = /（[^（）]*）|\([^()]*\)|\[[^[\]]*\]|［[^［］]*］|【[^【】]*】|〔[^〔〕]*〕/g;
export const cleanText = (text: string): string =>
  text.replace(BRACKETED, '').split('\n').map(line => line.trim()).filter(Boolean).join('\n');

export const cleanSegments = (segments: SubtitleSegment[]): SubtitleSegment[] =>
  segments.flatMap(segment => {
    const text = cleanText(segment.text);
    return text ? [{ ...segment, text }] : [];
  });

// How the video crosses a part with no line: at the normal speed, at a higher speed, or with a jump to the next line.
export const GAP_MODES = { off: 1, x2: 2, x4: 4, skip: 'jump' } as const;
export type GapMode = keyof typeof GAP_MODES;
export const isGapMode = (value: unknown): value is GapMode => typeof value === 'string' && Object.hasOwn(GAP_MODES, value);

// Only a gap of this length or more counts, and its last GAP_LEAD seconds play at the normal speed, so the next line starts clean.
const MIN_GAP = 1.5;
export const GAP_LEAD = 0.5;

// The start of the next line when time is in a long enough gap and before its lead, else null.
export function gapEnd(segments: SubtitleSegment[], time: number): number | null {
  if (segments.some(segment => segment.start <= time && time < segment.end)) return null;
  const before = segments.filter(segment => segment.end <= time).at(-1);
  const next = segments.find(segment => segment.start > time);
  if (!next || next.start - (before?.end ?? 0) < MIN_GAP || time >= next.start - GAP_LEAD) return null;
  return next.start;
}