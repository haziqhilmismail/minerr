// The Lapis note type (https://github.com/donkuri/lapis, GPL-3.0). Minerr fills the Lapis note type of the user and never
// changes it; the Install Lapis button downloads the package from the Lapis project. These are the pure parts of its fields.
import { toHiragana } from './group.ts';
import { type Entry, type Frequency, morae, type Pitch, pitchPattern } from './meta.ts';

export const LAPIS_MODEL = 'Lapis';
export const LAPIS_PACKAGE_URL = 'https://github.com/donkuri/lapis/releases/download/1.7.0/Lapis.apkg';
// The Expression of the one sample note in Lapis.apkg (build/example_card.csv of the Lapis project).
export const LAPIS_SAMPLE_EXPRESSION = '十中八九';

export const LAPIS_FIELDS = [
  'Expression', 'ExpressionFurigana', 'ExpressionReading', 'ExpressionAudio', 'SelectionText', 'MainDefinition', 'DefinitionPicture',
  'Sentence', 'SentenceFurigana', 'SentenceAudio', 'Picture', 'Glossary', 'Hint', 'IsWordAndSentenceCard', 'IsClickCard',
  'IsSentenceCard', 'IsAudioCard', 'PitchPosition', 'PitchCategories', 'Frequency', 'FreqSort', 'MiscInfo',
] as const;
export type LapisField = (typeof LAPIS_FIELDS)[number];

const KANJI_RUN = /[一-鿿々〆ヶ]+|[^一-鿿々〆ヶ]+/g;
const KANJI = /^[一-鿿々〆ヶ]/;
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The Anki furigana of Yomitan {furigana-plain}: a reading over each kanji run, a space before each run after the first.
// 食べる + たべる is 食[た]べる. If the kana of the word do not match the reading, the reading goes over the whole word.
export function furiganaPlain(expression: string, reading: string): string {
  if (!reading || toHiragana(reading) === toHiragana(expression)) return expression;
  const runs = expression.match(KANJI_RUN) ?? [];
  const pattern = runs.map(run => (KANJI.test(run) ? '(.+?)' : `(${escapeRegExp(toHiragana(run))})`)).join('');
  const match = new RegExp(`^${pattern}$`, 'u').exec(toHiragana(reading));
  if (!match) return `${expression}[${reading}]`;
  return runs.reduce((text, run, i) => (KANJI.test(run) ? `${text}${text ? ' ' : ''}${run}[${match[i + 1]}]` : text + run), '');
}

// Yomitan {frequency-harmonic-rank}: the first rank of each ranked dictionary, the number at the start of its display
// value if it has one, and the floor of their harmonic mean. Null when no dictionary gives a rank.
export function harmonicRank(frequencies: Frequency[]): number | null {
  const seen = new Set<string>();
  const ranks = frequencies.flatMap(({ dict, value, display, ranked }) => {
    if (!ranked || seen.has(dict)) return [];
    seen.add(dict);
    const shown = Number.parseInt(/^\d+/.exec(display)?.[0] ?? '', 10);
    const rank = shown > 0 ? shown : value;
    return rank > 0 ? [rank] : [];
  });
  return ranks.length ? Math.floor(ranks.length / ranks.reduce((sum, rank) => sum + 1 / rank, 0)) : null;
}

const uniquePositions = (pitches: Pitch[]) => [...new Set(pitches.flatMap(pitch => pitch.positions))];

// Yomitan {pitch-accent-positions} as text: [2], or a list for more than one. Lapis reads the numbers.
export function pitchPositions(pitches: Pitch[]): string {
  const positions = uniquePositions(pitches).map(position => `[${position}]`);
  return positions.length > 1 ? `<ol>${positions.map(position => `<li>${position}</li>`).join('')}</ol>` : (positions[0] ?? '');
}

// Yomitan isNonNounVerbOrAdjective. ponytail: the word classes come from the part-of-speech tags (v5r is v5), because Minerr
// does not keep the rules column of the term bank; Yomitan reads the rules.
function isVerbOrAdjective(entry: Entry): boolean {
  const classes = new Set([...entry.termTags, ...entry.senses.flatMap(sense => sense.tags)].map(tag => tag.name.replace(/^(v5|vs).*/, '$1')));
  const verb = ['v1', 'v5', 'vk', 'vz', 'adj-i', 'vs'].some(name => classes.has(name));
  return verb && !(classes.has('vs') && classes.has('n'));
}

// Yomitan {pitch-accent-categories}: heiban, atamadaka, nakadaka, odaka, or kifuku (a verb or adjective with a drop), joined with commas.
export function pitchCategories(entry: Entry): string {
  const kifuku = isVerbOrAdjective(entry);
  const count = morae(entry.reading).length;
  return [...new Set(uniquePositions(entry.pitches).map(position => (kifuku && position > 0 ? 'kifuku' : pitchPattern(position, count))))].join(',');
}
