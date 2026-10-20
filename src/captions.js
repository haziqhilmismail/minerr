// lines are the text of the caption lines from top to bottom; empty lines drop out.
export const captionText = lines => lines.map(line => line.trim()).filter(Boolean).join('\n');

// segments are {start, end, text} in seconds, sorted by start.
export const segmentAt = (segments, time) => segments.find(s => s.start <= time && time < s.end) ?? null;
