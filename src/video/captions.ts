import { at, isList, isString } from '../shared/guards.ts';

// One subtitle line and its time span in seconds, with the end exclusive.
export interface SubtitleSegment {
  start: number;
  end: number;
  text: string;
}

// lines are the text of the caption lines from top to bottom; empty lines drop out. The lines join without a break:
// YouTube cuts its automatic captions into rows in mid-sentence, and a line break ends the sentence of a card.
export const captionText = (lines: string[]): string => lines.map(line => line.trim()).filter(Boolean).join('');

// segments are sorted by start.
export const segmentAt = (segments: SubtitleSegment[], time: number): SubtitleSegment | null =>
  segments.find(s => s.start <= time && time < s.end) ?? null;

// [hh:]mm:ss.mmm (WebVTT) or hh:mm:ss,mmm (SRT).
const STAMP = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{3})$/;
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', nbsp: ' ', lrm: '', rlm: '' };

function seconds(stamp: string): number | null {
  const match = STAMP.exec(stamp);
  if (!match) return null;
  const [, hours = '0', minutes = '0', secs = '0', millis = '0'] = match;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(secs) + Number(millis) / 1000;
}

// The text of a cue without furigana (<rt>), tags, and SRT position codes such as {\an8}.
export const cueText = (lines: string[]) => lines.join('\n')
  .replace(/<rt>[\s\S]*?<\/rt>/g, '').replace(/<[^>]*>/g, '').replace(/\{\\[^}]*\}/g, '')
  .replace(/&(amp|lt|gt|nbsp|lrm|rlm);/g, (_, name: string) => ENTITIES[name] ?? '').trim();

// Reads an SRT or a WebVTT file. Blocks without a cue timing (the WEBVTT header, NOTE, STYLE) and empty cues drop out.
export function parseSubtitles(file: string): SubtitleSegment[] {
  return file.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split(/\n\s*\n/).flatMap(block => {
    const lines = block.split('\n');
    const at = lines.findIndex(line => line.includes('-->'));
    // The end time may be followed by WebVTT cue settings such as "align:start position:10%".
    const [from = '', arrow, to = ''] = lines[at]?.trim().split(/\s+/) ?? [];
    const start = seconds(from);
    const end = seconds(to);
    const text = cueText(lines.slice(at + 1));
    return arrow === '-->' && start !== null && end !== null && end > start && text ? [{ start, end, text }] : [];
  }).sort((a, b) => a.start - b.start);
}

const pad = (value: number, width = 2) => String(value).padStart(width, '0');

function srtStamp(time: number): string {
  const ms = Math.round(time * 1000);
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
}

export const toSrt = (segments: SubtitleSegment[]): string =>
  segments.map(({ start, end, text }, i) => `${i + 1}\n${srtStamp(start)} --> ${srtStamp(end)}\n${text}\n`).join('\n');

// YouTube's json3 format: events with a start and a duration in ms, and the text in segs. A row is one event with segs.
// In automatic captions a seg is one word with its own time (tOffsetMs); the segs of an uploader track have no times.
// Times are in seconds. A seg is on the screen from its start until its row leaves the screen, and a seg without a time
// starts with its row. timed is true when a seg of the row has its own time.
interface Row { start: number; end: number; timed: boolean; segs: SubtitleSegment[] }

const num = (value: unknown): number | undefined => (typeof value === 'number' ? value : undefined);

// The rows in start order.
function captionRows(file: string): Row[] {
  const events = at(JSON.parse(file), 'events');
  return (isList(events) ? events : []).flatMap((event): Row[] => {
    const startMs = num(at(event, 'tStartMs'));
    const segs = at(event, 'segs');
    if (startMs === undefined || !isList(segs)) return [];
    const end = (startMs + (num(at(event, 'dDurationMs')) ?? 0)) / 1000;
    const offsets = segs.map(seg => num(at(seg, 'tOffsetMs')));
    return [{ start: startMs / 1000, end, timed: offsets.some(offset => offset !== undefined), segs: segs.map((seg, i) => {
      const text = at(seg, 'utf8');
      return { start: (startMs + (offsets[i] ?? 0)) / 1000, end, text: isString(text) ? text : '' };
    }) }];
  }).sort((a, b) => a.start - b.start);
}

// Each row is a line. Rows roll: a row stays on the screen after the next one starts, so a line ends where the next one starts.
const rowLines = (rows: Row[]): SubtitleSegment[] => rows.flatMap(({ start, end, segs }) => {
  const text = segs.map(seg => seg.text).join('').trim();
  return text ? [{ start, end, text }] : [];
});

// Splits after each sentence or clause mark. A point or comma before a digit is part of a number, as 1.2 or 1,000.
const AFTER_MARK = /(?<=[。！？!?、])|(?<=[.,])(?!\d)/;

// The words of one seg, which ends at until. A seg with several sentences splits after each mark, and each part
// starts in proportion to the characters before it.
function segWords(seg: SubtitleSegment, until: number): SubtitleSegment[] {
  const span = Math.max(0, until - seg.start);
  const words: SubtitleSegment[] = [];
  let before = 0;
  for (const text of seg.text.split(AFTER_MARK)) {
    if (text.trim()) words.push({ ...seg, start: seg.start + span * before / seg.text.length, text });
    before += text.length;
  }
  return words;
}

// The words of the rows. A seg ends where the next seg starts, at most where its row ends: the next row may start later.
function captionWords(rows: Row[]): SubtitleSegment[] {
  const segs = rows.flatMap(row => row.segs.filter(seg => seg.text.trim()));
  return segs.flatMap((seg, i) => segWords(seg, Math.min(segs[i + 1]?.start ?? seg.end, seg.end)));
}

const SENTENCE_END = /[。！？!?.]$/;
const CLAUSE_END = /[、,]$/;
// A sound tag such as [音楽], which is a line of its own.
const TAG = /^\[[^\]]*\]$/;
// A clause mark (、) ends a line of this many characters: a shorter line waits for the sentence mark.
const CLAUSE_CHARS = 25;
// A pause this long before the next word ends a line: the speaker stopped, also where the captions have no mark.
const PAUSE_SECONDS = 1.5;
// A line of this many characters ends: a speech without marks must still fit the overlay and a card.
const MAX_CHARS = 80;

// True when line (trimmed) ends after word.
function lineEnds(line: string, word: SubtitleSegment, next: SubtitleSegment | undefined): boolean {
  if (next === undefined) return true;
  const last = word.text.trim();
  return TAG.test(last) || TAG.test(next.text.trim())
    || SENTENCE_END.test(last)
    || (CLAUSE_END.test(last) && line.length >= CLAUSE_CHARS)
    || next.start - word.start >= PAUSE_SECONDS
    || line.length >= MAX_CHARS;
}

// Joins the words into sentence lines. A line stays on the screen with the row of its last word.
function sentenceLines(words: SubtitleSegment[]): SubtitleSegment[] {
  const lines: SubtitleSegment[] = [];
  let start = 0;
  let text = '';
  words.forEach((word, i) => {
    if (!text) start = word.start;
    text += word.text;
    const line = text.trim();
    if (lineEnds(line, word, words[i + 1])) {
      lines.push({ start, end: word.end, text: line });
      text = '';
    }
  });
  return lines;
}

// YouTube cuts the rows of its automatic captions in mid-sentence, so their words join into sentence lines. An uploader
// track has no word times, and its rows stay lines: the uploader cut them. The marks include . , ? ! for an English track.
function parseJson3(file: string): SubtitleSegment[] {
  const rows = captionRows(file);
  const timed = rows.some(row => row.timed);
  const lines = timed ? sentenceLines(captionWords(rows)) : rowLines(rows);
  return lines.map((line, i) => ({ ...line, end: Math.min(line.end, lines[i + 1]?.start ?? Infinity) })).filter(line => line.end > line.start);
}

// A subtitle file in a format that the server sends: json3 from YouTube, or SRT or WebVTT.
export const parseCaptions = (ext: string, file: string): SubtitleSegment[] =>
  (ext === 'json3' ? parseJson3(file) : parseSubtitles(file));
