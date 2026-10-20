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
