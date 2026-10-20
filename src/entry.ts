// The dictionary entry of each word, so that all the spellings of one word share one status, and the join of
// compound nouns. A JMdict entry (one term bank sequence) is one word: 猫, ねこ, and ネコ are one entry.
import { groupTokens, type Segment, toHiragana } from './group.ts';
import type { WordId } from './status.ts';

// One row of a sequenced term dictionary such as JMdict. sequence is the entry: one word with all its spellings and meanings.
export interface EntryRow {
  dict: string;
  expression: string;
  reading: string;
  score: number;
  sequence: number;
}

// The rows that the resolver reads, in dictionary order.
export interface EntryIndex {
  byExpression(text: string): Promise<EntryRow[]>;
  byReading(text: string): Promise<EntryRow[]>;
  bySequence(dict: string, sequence: number): Promise<EntryRow[]>;
  // The texts that are an expression of a term.
  headwords(texts: string[]): Promise<Set<string>>;
}

// The dictionary entry of a word. key is its status key: the headword of the entry, with the reading of the entry when
// a more common entry has the same headword (上手【うわて】). headword and reading are for the popup header.
// oldKey is the lemma, which was the status key before spellings shared a status, when it belongs to this entry only.
export interface WordEntry extends WordId {
  headword: string;
  reading: string;
}

export interface Words {
  entry(lemma: string, reading: string | null): Promise<WordEntry | null>;
  headwords(texts: string[]): Promise<Set<string>>;
}

const KANA = /^[ぁ-ゖァ-ヺー]+$/;
const toKatakana = (text: string) => text.replace(/[ぁ-ゖ]/g, kana => String.fromCharCode(kana.charCodeAt(0) + 0x60));

// JMdict has at most 90 rows in one entry. More rows are a dictionary that gives one sequence to many words.
export const MAX_ENTRY_ROWS = 200;

// The first row with the highest score.
const best = (rows: EntryRow[]) => rows.reduce<EntryRow | undefined>((top, row) => (top && top.score >= row.score ? top : row), undefined);

// The one entry of rows: the sequence of the first dictionary title, if the rows of that dictionary have one sequence.
function entryOf(rows: EntryRow[]): { dict: string; sequence: number } | null {
  const dict = rows.map(row => row.dict).sort()[0];
  const [sequence, ...others] = new Set(rows.flatMap(row => (row.dict === dict ? [row.sequence] : [])));
  return dict === undefined || sequence === undefined || others.length ? null : { dict, sequence };
}

// The entry of one spelling. With a reading, only the rows of that reading fit, unless no row has it.
// The entry is alone when the spelling without its reading has this entry only; then the lemma was its status key.
async function resolve(index: EntryIndex, lemma: string, reading: string | null): Promise<(Omit<WordEntry, 'oldKey'> & { alone: boolean }) | null> {
  const kana = KANA.test(lemma);
  const found = (await Promise.all([
    index.byExpression(lemma),
    ...(kana ? [index.byReading(toHiragana(lemma)), index.byReading(toKatakana(lemma))] : []),
  ])).flat();
  const fits = found.filter(row => toHiragana(row.reading) === reading);
  const one = entryOf(fits.length ? fits : found);
  if (!one) return null;
  const { dict, sequence } = one;
  const entry = await index.bySequence(dict, sequence);
  const head = best(entry);
  if (!head || entry.length > MAX_ENTRY_ROWS) return null;
  const spelled = await index.byExpression(head.expression);
  const main = best(spelled.filter(row => row.dict === dict));
  const alone = entryOf(found);
  return {
    key: main?.sequence === sequence ? head.expression : `${head.expression}【${head.reading}】`,
    headword: head.expression,
    reading: entry.find(row => row.expression === head.expression && toHiragana(row.reading) === reading)?.reading ?? head.reading,
    alone: alone?.dict === dict && alone.sequence === sequence,
  };
}

// Keeps the promise of each call by its arguments, and forgets a promise that fails.
function remember<Args extends unknown[], T>(load: (...args: Args) => Promise<T>): (...args: Args) => Promise<T> {
  const kept = new Map<string, Promise<T>>();
  return (...args) => {
    const id = JSON.stringify(args);
    let value = kept.get(id);
    if (!value) {
      value = load(...args);
      kept.set(id, value);
      value.catch(() => kept.delete(id));
    }
    return value;
  };
}

// Caches each read and each entry, for the life of one set of dictionaries.
// ponytail: the caches grow with each new word of the session; bound them if the offscreen document gets too big.
export function dictionaryWords(source: EntryIndex): Words {
  const index: EntryIndex = {
    byExpression: remember(source.byExpression),
    byReading: remember(source.byReading),
    bySequence: remember(source.bySequence),
    headwords: source.headwords,
  };
  const known = new Map<string, boolean>();
  return {
    entry: remember(async (lemma: string, reading: string | null): Promise<WordEntry | null> => {
      const found = await resolve(index, lemma, reading);
      if (!found) return null;
      const { alone, ...entry } = found;
      // The old key of a spelling with more than one entry (上手) is the status of all of them; it stays.
      return alone && entry.key !== lemma ? { ...entry, oldKey: lemma } : entry;
    }),
    headwords: async texts => {
      const missing = [...new Set(texts.filter(text => !known.has(text)))];
      const found = missing.length ? await index.headwords(missing) : new Set<string>();
      for (const text of missing) known.set(text, found.has(text));
      return new Set(texts.filter(text => known.get(text)));
    },
  };
}

// The reading of the dictionary form of a segment, in hiragana: 食べなかった read たべなかった -> たべる.
// The kana after the common start of the text and the lemma are the same in the reading. Null when kuromoji has no reading.
export function lemmaReading({ text, lemma, reading }: Segment): string | null {
  if (!lemma) return null;
  if (KANA.test(lemma)) return toHiragana(lemma);
  if (!reading) return null;
  let same = 0;
  while (same < text.length && text[same] === lemma[same]) same++;
  const tail = text.length - same;
  return tail <= reading.length ? reading.slice(0, reading.length - tail) + toHiragana(lemma.slice(same)) : null;
}

const joins = (token: kuromoji.Token) => token.pos === '名詞' || token.pos === '接頭詞';
// The most tokens in one compound.
const MAX_JOIN = 6;

// The noun tokens from start on, at most MAX_JOIN.
function runAt(tokens: kuromoji.Token[], start: number): kuromoji.Token[] {
  const run: kuromoji.Token[] = [];
  for (const token of tokens.slice(start, start + MAX_JOIN)) {
    if (!joins(token)) break;
    run.push(token);
  }
  return run;
}

// The texts of the first 2, 3, ... tokens of a run.
const compounds = (run: kuromoji.Token[]) => run.map((_, k) => run.slice(0, k + 1).map(token => token.surface_form).join('')).slice(1);

function merge(first: kuromoji.Token, parts: kuromoji.Token[]): kuromoji.Token {
  const surface = parts.map(part => part.surface_form).join('');
  const readings = parts.map(part => part.reading);
  return {
    ...first, pos: '名詞', pos_detail_1: '一般', surface_form: surface, basic_form: surface,
    reading: readings.every(reading => reading && reading !== '*') ? readings.join('') : '*',
  };
}

// Joins runs of noun tokens by the longest headword at each start: 食肉|目|ネコ|科|ネコ|属 -> 食肉目|ネコ科|ネコ属.
export function joinCompounds(tokens: kuromoji.Token[], headwords: Set<string>): kuromoji.Token[] {
  const joined: kuromoji.Token[] = [];
  for (let i = 0; i < tokens.length;) {
    let size = 1;
    compounds(runAt(tokens, i)).forEach((text, k) => { if (headwords.has(text)) size = k + 2; });
    const parts = tokens.slice(i, i + size);
    const [first] = parts;
    if (!first) break;
    joined.push(size > 1 ? merge(first, parts) : first);
    i += size;
  }
  return joined;
}

// The segments of tokens, with compound nouns joined and the dictionary entry of each word.
export async function entrySegments(tokens: kuromoji.Token[], words: Words): Promise<Segment[]> {
  const texts = tokens.flatMap((_, i) => compounds(runAt(tokens, i)));
  const segments = groupTokens(joinCompounds(tokens, await words.headwords(texts)));
  return Promise.all(segments.map(async segment => {
    const entry = segment.lemma ? await words.entry(segment.lemma, lemmaReading(segment)) : null;
    return entry ? { ...segment, entry } : segment;
  }));
}
