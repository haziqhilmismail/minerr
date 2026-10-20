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

// The first row with the highest score.
const best = (rows: EntryRow[]) => rows.reduce<EntryRow | undefined>((top, row) => (top && top.score >= row.score ? top : row), undefined);

// The entry of one spelling. With a reading, only the rows of that reading fit, unless no row has it.
async function resolve(index: EntryIndex, lemma: string, reading: string | null): Promise<Omit<WordEntry, 'oldKey'> | null> {
  const kana = KANA.test(lemma);
  const found = (await Promise.all([
    index.byExpression(lemma),
    ...(kana ? [index.byReading(toHiragana(lemma)), index.byReading(toKatakana(lemma))] : []),
  ])).flat();
  const fits = found.filter(row => toHiragana(row.reading) === reading);
  const rows = fits.length ? fits : found;
  // With more than one dictionary, the first title decides.
  const dict = rows.map(row => row.dict).sort()[0];
  const sequences = new Set(rows.flatMap(row => (row.dict === dict ? [row.sequence] : [])));
  const [sequence, ...others] = sequences;
  if (dict === undefined || sequence === undefined || others.length) return null;
  const entry = await index.bySequence(dict, sequence);
  const head = best(entry);
  if (!head) return null;
  const spelled = head.expression === lemma ? found.filter(row => row.expression === lemma) : await index.byExpression(head.expression);
  const main = best(spelled.filter(row => row.dict === dict));
  return {
    key: main?.sequence === sequence ? head.expression : `${head.expression}【${head.reading}】`,
    headword: head.expression,
    reading: entry.find(row => row.expression === head.expression && toHiragana(row.reading) === reading)?.reading ?? head.reading,
  };
}

// Caches each lookup, for the life of one set of dictionaries.
export function dictionaryWords(index: EntryIndex): Words {
  const entries = new Map<string, Promise<WordEntry | null>>();
  const known = new Map<string, boolean>();
  async function find(lemma: string, reading: string | null): Promise<WordEntry | null> {
    const entry = await resolve(index, lemma, reading);
    if (!entry || entry.key === lemma) return entry;
    // The old key of a spelling with more than one entry (上手) is the status of all of them; it stays.
    const alone = reading === null ? entry : await entryOf(lemma, null);
    return alone?.key === entry.key ? { ...entry, oldKey: lemma } : entry;
  }
  function entryOf(lemma: string, reading: string | null): Promise<WordEntry | null> {
    const id = `${lemma}\n${reading ?? ''}`;
    let entry = entries.get(id);
    if (!entry) {
      entry = find(lemma, reading);
      entries.set(id, entry);
      entry.catch(() => entries.delete(id));
    }
    return entry;
  }
  return {
    entry: entryOf,
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
