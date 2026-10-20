// One subtitle line and its time span in seconds, with the end exclusive.
export interface SubtitleSegment {
  start: number;
  end: number;
  text: string;
}

// lines are the text of the caption lines from top to bottom; empty lines drop out.
export const captionText = (lines: string[]): string => lines.map(line => line.trim()).filter(Boolean).join('\n');

// segments are sorted by start.
export const segmentAt = (segments: SubtitleSegment[], time: number): SubtitleSegment | null =>
  segments.find(s => s.start <= time && time < s.end) ?? null;
