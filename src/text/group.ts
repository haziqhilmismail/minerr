import type { WordEntry } from './entry.ts';

const CONTENT_POS = new Set(['名詞', '動詞', '形容詞', '副詞', '連体詞', '感動詞', '接続詞']);
export const INFLECTING_POS = new Set(['動詞', '形容詞']);
const CONJUNCTIVE = new Set(['て', 'で', 'ば']);
const TE = /^[てで]$/;
export const JAPANESE = /[぀-ヿ一-鿿]/;
const KANJI = /[一-鿿々]/;
export const hasKanji = (text: string): boolean => KANJI.test(text);

// A piece of the parsed text. A content word also has its dictionary form, and a word with kanji has its reading in hiragana.
// entry is the dictionary entry of the word (src/text/entry.ts), when one entry fits.
export interface Segment {
  text: string;
  lemma?: string;
  reading?: string;
  entry?: WordEntry;
}

export const toHiragana = (text: string) => text.replace(/[ァ-ヶ]/g, kana => String.fromCharCode(kana.charCodeAt(0) - 0x60));

// The reading of a token, or null if kuromoji does not know it ('*' or none).
const readingOf = (token: kuromoji.Token) => (token.reading && token.reading !== '*' ? token.reading : null);

// する after a verb is the short causative passive: 読まされる is 読ま|さ|れる.
export const isShortCausative = (token: kuromoji.Token) => token.basic_form === 'する' && token.conjugated_form === '未然レル接続';

// True if token is part of the word before it, whose last token is previous.
function attachesToPrevious(token: kuromoji.Token, previous: kuromoji.Token): boolean {
  switch (token.pos) {
    case '助動詞': return true;
    // ある after て is a form of the verb (書いてある).
    case '動詞': return token.pos_detail_1 === '非自立' || token.pos_detail_1 === '接尾'
      || (token.basic_form === 'ある' && previous.pos === '助詞' && TE.test(previous.surface_form))
      || isShortCausative(token);
    case '形容詞': return token.pos_detail_1 === '非自立';
    // 降りそう, 高そう: looks like. The そう of hearsay (降るそうだ) is 名詞 特殊, a word of its own.
    case '名詞': return token.pos_detail_1 === '接尾' && token.basic_form === 'そう';
    case '助詞': return token.pos_detail_1 === '接続助詞' && CONJUNCTIVE.has(token.surface_form);
    default: return false;
  }
}

const isWord = (token: kuromoji.Token) => CONTENT_POS.has(token.pos) && JAPANESE.test(token.surface_form);

// The tokens of one word: its head, and for a verb or adjective, the auxiliaries after it (食べ|なかっ|た).
export type WordTokens = [kuromoji.Token, ...kuromoji.Token[]];

export function wordGroups(tokens: kuromoji.Token[]): WordTokens[] {
  const words: WordTokens[] = [];
  for (const token of tokens) {
    const word = words.at(-1);
    if (word && isWord(word[0]) && INFLECTING_POS.has(word[0].pos) && attachesToPrevious(token, word.at(-1) ?? word[0])) word.push(token);
    else words.push([token]);
  }
  return words;
}

// Turns kuromoji (ipadic) tokens into segments whose texts concatenate to the input.
// Content words carry a lemma; a verb or adjective absorbs its auxiliaries (食べなかった -> 食べる).
export function groupTokens(tokens: kuromoji.Token[]): Segment[] {
  return wordGroups(tokens).map(word => {
    const [head] = word;
    const text = word.map(token => token.surface_form).join('');
    if (!isWord(head)) return { text };
    const lemma = head.basic_form === '*' ? head.surface_form : head.basic_form;
    // The katakana reading, null when a token of the word has no reading.
    const readings = word.map(readingOf);
    const reading = readings.every(Boolean) ? readings.join('') : null;
    return reading && KANJI.test(text) ? { text, lemma, reading: toHiragana(reading) } : { text, lemma };
  });
}

// A segment, or the part of a segment that falls in one text node. part is set when a word crosses text nodes,
// for example 暖 and かくて in <ruby>暖<rt>あたた</rt></ruby>かくて: 'first' for its first part, 'rest' for the others.
// A split word has no reading, because the reading would show over one part only.
export type NodeSegment = Segment & { part?: 'first' | 'rest' };

// The segments of the joined text of a run of text nodes, cut at the node boundaries. lengths are the lengths of the nodes.
export function splitSegments(segments: Segment[], lengths: number[]): NodeSegment[][] {
  const nodes: NodeSegment[][] = lengths.map(() => []);
  let node = 0;
  let nodeStart = 0;
  let start = 0;
  for (const segment of segments) {
    const end = start + segment.text.length;
    const parts: { node: number; text: string }[] = [];
    for (let at = start; at < end;) {
      while (node < lengths.length - 1 && nodeStart + (lengths[node] ?? 0) <= at) nodeStart += lengths[node++] ?? 0;
      const stop = Math.min(end, nodeStart + (lengths[node] ?? 0));
      parts.push({ node, text: segment.text.slice(at - start, stop - start) });
      at = stop;
    }
    const split = segment.lemma !== undefined && parts.length > 1;
    parts.forEach((part, i) => nodes[part.node]?.push(split
      ? { text: part.text, lemma: segment.lemma ?? '', ...(segment.entry ? { entry: segment.entry } : {}), part: i === 0 ? 'first' : 'rest' }
      : { ...segment, text: part.text }));
    start = end;
  }
  return nodes;
}

// The longest selection that Alt+S looks up, in characters.
const MAX_LOOKUP = 20;

// The words to look up for a selected text, longest first: each start of the text as it is, and, when that start is one word,
// its dictionary form (食べなかった -> 食べる), and for a 五段 す verb also the suru verb (接す -> 接する). length is the number of characters of the text that the word covers.
export function lookupCandidates(text: string, parse: (text: string) => Segment[]): { lemma: string; length: number }[] {
  const candidates: { lemma: string; length: number }[] = [];
  for (let length = Math.min(text.length, MAX_LOOKUP); length > 0; length--) {
    const start = text.slice(0, length);
    candidates.push({ lemma: start, length });
    const [word, ...rest] = parse(start);
    if (word?.lemma && word.lemma !== start && !rest.length) {
      candidates.push({ lemma: word.lemma, length });
      // kuromoji reads some suru verbs as the old 五段 verb (接し -> 接す); the dictionary has 接する.
      if (word.lemma.endsWith('す')) candidates.push({ lemma: `${word.lemma}る`, length });
    }
  }
  return candidates;
}
