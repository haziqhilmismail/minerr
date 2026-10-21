import { at, isList, isString } from './parse.ts';

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

// YouTube's json3 format: events with a start and a duration in ms, and the text in segs.
// Automatic captions roll, so an event stays on the screen after the next one starts; a line ends where the next one starts.
function parseJson3(file: string): SubtitleSegment[] {
  const events = at(JSON.parse(file), 'events');
  const lines = (isList(events) ? events : []).flatMap(event => {
    const start = at(event, 'tStartMs');
    const duration = at(event, 'dDurationMs');
    const segs = at(event, 'segs');
    if (typeof start !== 'number' || !isList(segs)) return [];
    const text = segs.map(seg => at(seg, 'utf8')).filter(isString).join('').trim();
    return text ? [{ start: start / 1000, end: (start + (typeof duration === 'number' ? duration : 0)) / 1000, text }] : [];
  }).sort((a, b) => a.start - b.start);
  return lines.map((line, i) => ({ ...line, end: Math.min(line.end, lines[i + 1]?.start ?? Infinity) })).filter(line => line.end > line.start);
}

// A subtitle file in a format that the server sends: json3 from YouTube, or SRT or WebVTT.
export const parseCaptions = (ext: string, file: string): SubtitleSegment[] =>
  (ext === 'json3' ? parseJson3(file) : parseSubtitles(file));
