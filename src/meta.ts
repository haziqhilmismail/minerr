// Frequency and pitch accent data from the term_meta_bank files of Yomitan dictionaries.
import { at, isList } from './parse.ts';
import type { Group } from './yomitan.ts';

// Yomitan term_meta_bank row: [expression, mode, data]. Minerr reads the modes "freq" and "pitch".
export type MetaRow = [expression: string, mode: string, data: unknown];

export const isMetaRow = (row: unknown): row is MetaRow => isList(row) && typeof row[0] === 'string' && typeof row[1] === 'string';

// A freq row without a reading applies to every reading of the expression. positions are the downstep positions of a pitch row.
export type TermMeta =
  | { mode: 'freq'; expression: string; reading: string | null; value: number; display: string }
  | { mode: 'pitch'; expression: string; reading: string; positions: number[] };

// A frequency value: a number, a numeric string, or {value, displayValue}.
function frequencyValue(data: unknown): { value: number; display: string } | null {
  if (typeof data === 'number') return { value: data, display: String(data) };
  if (typeof data === 'string') {
    const value = Number.parseFloat(data);
    return Number.isNaN(value) ? null : { value, display: data };
  }
  const value = at(data, 'value');
  const display = at(data, 'displayValue');
  return typeof value === 'number' ? { value, display: typeof display === 'string' ? display : String(value) } : null;
}

export function toMeta([expression, mode, data]: MetaRow): TermMeta | null {
  if (mode === 'freq') {
    const reading = at(data, 'reading');
    const frequency = frequencyValue(typeof reading === 'string' ? at(data, 'frequency') : data);
    return frequency && { mode, expression, reading: typeof reading === 'string' ? reading : null, ...frequency };
  }
  if (mode === 'pitch') {
    const reading = at(data, 'reading');
    const pitches = at(data, 'pitches');
    if (typeof reading !== 'string' || !isList(pitches)) return null;
    const positions = pitches.map(pitch => at(pitch, 'position')).filter((position): position is number => typeof position === 'number');
    return positions.length ? { mode, expression, reading, positions } : null;
  }
  return null;
}

// The frequency of a word in one dictionary. ranked: the value is a rank (1 is the most common word), not a count.
export interface Frequency {
  dict: string;
  value: number;
  display: string;
  ranked: boolean;
}

export interface Pitch {
  dict: string;
  positions: number[];
}

// A dictionary group with the frequencies and pitch accents of its expression and reading.
export type Entry = Group & { frequencies: Frequency[]; pitches: Pitch[] };

export type DictMeta = TermMeta & { dict: string };

// rankedDicts: the dictionaries whose frequencyMode is rank-based, the Yomitan default.
export function withMeta(groups: Group[], rows: DictMeta[], rankedDicts: Set<string>): Entry[] {
  return groups.map(group => {
    const own = rows.filter(row => row.expression === group.expression);
    return {
      ...group,
      frequencies: own.flatMap(row => (row.mode === 'freq' && (row.reading === null || row.reading === group.reading)
        ? [{ dict: row.dict, value: row.value, display: row.display, ranked: rankedDicts.has(row.dict) }] : [])),
      pitches: own.flatMap(row => (row.mode === 'pitch' && row.reading === group.reading ? [{ dict: row.dict, positions: row.positions }] : [])),
    };
  });
}

// Stars from a frequency rank: 5 for the 1,500 most common words, then 5,000, 15,000, and 30,000. The rest get 1 star.
const STAR_RANKS = [1500, 5000, 15000, 30000];
export const stars = (rank: number): number => 5 - [...STAR_RANKS, Infinity].findIndex(limit => rank <= limit);

// The stars of the best rank of the ranked frequencies, or null if no dictionary gives a rank.
export function entryStars(frequencies: Frequency[]): number | null {
  const ranks = frequencies.filter(frequency => frequency.ranked && frequency.value > 0).map(frequency => frequency.value);
  return ranks.length ? stars(Math.min(...ranks)) : null;
}

// A small kana joins the kana before it: きょう is two morae, きょ and う.
export const morae = (kana: string): string[] => kana.match(/.[ゃゅょぁぃぅぇぉゎャュョァィゥェォヮ]*/gu) ?? [];

// The pitch patterns, with the colors of Migaku: mid tones, so the colored text shows on light and dark pages.
export const PITCH = {
  heiban: { label: 'Heiban', color: '#4a86e8' },
  atamadaka: { label: 'Atamadaka', color: '#e5484d' },
  nakadaka: { label: 'Nakadaka', color: '#f08c00' },
  odaka: { label: 'Odaka', color: '#30a46c' },
} satisfies Record<string, { label: string; color: string }>;
export type PitchPattern = keyof typeof PITCH;

// position is the mora after which the pitch drops; 0 is no drop.
export function pitchPattern(position: number, count: number): PitchPattern {
  if (position === 0) return 'heiban';
  if (position === 1) return 'atamadaka';
  return position >= count ? 'odaka' : 'nakadaka';
}

// High (true) or low for each mora. The first mora is low unless the drop is after it.
export const highs = (position: number, count: number): boolean[] =>
  Array.from({ length: count }, (_, i) => (position === 1 ? i === 0 : i > 0 && (position === 0 || i < position)));
