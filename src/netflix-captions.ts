// The Netflix subtitle tracks of a title, from the manifest that src/netflix-main.ts kept, and the choice of the track to show.
// Netflix serves text subtitles as WebVTT (when the player asked for it), or as TTML (dfxp-ls-sdh, imsc1.1, simplesdh).
// Some Japanese titles have image subtitles only (nflx-cmisc), which Minerr cannot read.
import { cueText, parseSubtitles, type SubtitleSegment } from './captions.ts';
import { at, isList, isString } from './parse.ts';

// The text formats, best first: WebVTT needs no extra reader; the TTML formats go through parseTtml.
export const TEXT_PROFILES = ['webvtt-lssdh-ios8', 'dfxp-ls-sdh', 'imsc1.1', 'simplesdh'] as const;
export type Profile = (typeof TEXT_PROFILES)[number];

// A subtitle track of a title. kind: the regular subtitles, or the closed captions (SDH, with sound descriptions).
// forced: the few lines of a foreign language in the film, not the dialogue. urls: a file URL per text format; empty for image subtitles.
export interface TextTrack {
  id: string;
  language: string;
  kind: 'subtitles' | 'closedcaptions';
  forced: boolean;
  urls: Partial<Record<Profile, string>>;
}

// The subtitle list of a title. selected is the id of the track that the player shows, or null.
export interface Manifest {
  movieId: string;
  tracks: TextTrack[];
  selected: string | null;
}

// A reply of src/netflix-main.ts: the list of the title, or null when the player did not read it yet,
// and the titles whose list the page script has, for the status in that case.
export interface PageReply {
  manifest: Manifest | null;
  known: string[];
}

export type Choice = { kind: 'text'; profile: Profile; url: string } | { kind: 'image' } | { kind: 'none' };

const isProfile = (value: string): value is Profile => (TEXT_PROFILES as readonly string[]).includes(value);

// The URL of a format: urls: [{url}] (Netflix, 2025), or the older downloadUrls: {cdnId: url}. Only https, as a page can post anything.
function fileUrl(downloadable: unknown): string | null {
  const urls = at(downloadable, 'urls');
  const first = isList(urls) ? at(urls[0], 'url') : Object.values(Object(at(downloadable, 'downloadUrls')))[0];
  return isString(first) && first.startsWith('https://') ? first : null;
}

function toTrack(value: unknown): TextTrack[] {
  const [id, language, rawType] = ['new_track_id', 'language', 'rawTrackType'].map(key => at(value, key));
  if (!isString(id) || !isString(language) || at(value, 'isNoneTrack') === true) return [];
  const urls: Partial<Record<Profile, string>> = {};
  for (const [profile, downloadable] of Object.entries(Object(at(value, 'ttDownloadables')))) {
    if (!isProfile(profile)) continue;
    const url = fileUrl(downloadable);
    if (url) urls[profile] = url;
  }
  return [{ id, language, kind: rawType === 'closedcaptions' ? 'closedcaptions' : 'subtitles', forced: at(value, 'isForcedNarrative') === true, urls }];
}

// The reply of src/netflix-main.ts for movieId, or null for another message.
export function toReply(data: unknown, movieId: string): PageReply | null {
  if (at(data, 'minerr') !== 'manifest' || at(data, 'movieId') !== movieId) return null;
  const [tracks, selected, known] = ['tracks', 'selected', 'known'].map(key => at(data, key));
  return {
    manifest: isList(tracks) ? { movieId, tracks: tracks.flatMap(toTrack), selected: isString(selected) ? selected : null } : null,
    known: isList(known) ? known.filter(isString) : [],
  };
}

const inLanguage = (track: TextTrack, lang: string) => track.language === lang || track.language.startsWith(`${lang}-`);

// The track to show in lang: the track that the player shows if it is in lang, else the subtitles before the closed captions.
// Forced narrative tracks are not the dialogue. A text format of the track in TEXT_PROFILES order; a track with none is image subtitles.
export function choose({ tracks, selected }: Manifest, lang: string): Choice {
  const candidates = tracks.filter(track => inLanguage(track, lang) && !track.forced)
    .sort((a, b) => Number(b.id === selected) - Number(a.id === selected) || Number(a.kind === 'closedcaptions') - Number(b.kind === 'closedcaptions'));
  for (const track of candidates) {
    const profile = TEXT_PROFILES.find(found => track.urls[found]);
    const url = profile && track.urls[profile];
    if (profile && url) return { kind: 'text', profile, url };
  }
  return candidates.length ? { kind: 'image' } : { kind: 'none' };
}

// A TTML time: ticks (4583333t, with ttp:tickRate), a clock time (00:01:02.500, or :frames with ttp:frameRate), or an offset (2.5s, 300ms).
function ttmlSeconds(value: string, tickRate: number, frameRate: number): number | null {
  const ticks = /^(\d+)t$/.exec(value);
  if (ticks) return Number(ticks[1]) / tickRate;
  const offset = /^(\d+(?:\.\d+)?)(s|ms)$/.exec(value);
  if (offset) return Number(offset[1]) / (offset[2] === 'ms' ? 1000 : 1);
  const clock = /^(\d+):(\d{2}):(\d{2})(?:\.(\d+)|:(\d+))?$/.exec(value);
  if (!clock) return null;
  const [, hours = '0', minutes = '0', seconds = '0', fraction, frames] = clock;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds) + (fraction ? Number(`0.${fraction}`) : 0) + (frames ? Number(frames) / frameRate : 0);
}

const ttmlText = (body: string) => cueText([body.replace(/<br\s*\/?>/gi, '\n')])
  .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code: string) => String.fromCodePoint(Number(code.startsWith('x') ? `0${code}` : code)))
  .replace(/[‎‏]/g, '').trim();

// Reads a TTML file: each <p> with begin and end. Lines with the same times join, as Netflix splits a line into regions.
export function parseTtml(file: string): SubtitleSegment[] {
  const tickRate = Number(/\bttp:tickRate="(\d+)"/.exec(file)?.[1]) || 10_000_000;
  const frameRate = Number(/\bttp:frameRate="(\d+)"/.exec(file)?.[1]) || 30;
  const lines = [...file.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/g)].flatMap(([, attributes = '', body = '']) => {
    const time = (name: string) => ttmlSeconds(new RegExp(`\\b${name}="([^"]*)"`).exec(attributes)?.[1] ?? '', tickRate, frameRate);
    const start = time('begin');
    const end = time('end');
    const text = ttmlText(body);
    return start === null || end === null || end <= start || !text ? [] : [{ start, end, text }];
  }).sort((a, b) => a.start - b.start);
  return lines.reduce<SubtitleSegment[]>((joined, line) => {
    const last = joined.at(-1);
    if (last && last.start === line.start && last.end === line.end) last.text += `\n${line.text}`;
    else joined.push(line);
    return joined;
  }, []);
}

export const parseTrack = (profile: Profile, file: string): SubtitleSegment[] =>
  (profile === 'webvtt-lssdh-ios8' ? parseSubtitles(file) : parseTtml(file));

// The lines of a text track, or null when the file does not arrive or has no lines.
export async function fetchTrack(choice: Extract<Choice, { kind: 'text' }>): Promise<SubtitleSegment[] | null> {
  const response = await fetch(choice.url);
  if (!response.ok) return null;
  const lines = parseTrack(choice.profile, await response.text());
  return lines.length ? lines : null;
}
