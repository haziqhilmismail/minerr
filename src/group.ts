const CONTENT_POS = new Set(['名詞', '動詞', '形容詞', '副詞', '連体詞', '感動詞', '接続詞']);
const INFLECTING_POS = new Set(['動詞', '形容詞']);
const CONJUNCTIVE = new Set(['て', 'で', 'ば']);
const JAPANESE = /[぀-ヿ一-鿿]/;
const KANJI = /[一-鿿々]/;

// A piece of the parsed text. A content word also has its dictionary form, and a word with kanji has its reading in hiragana.
export interface Segment {
  text: string;
  lemma?: string;
  reading?: string;
}

export const toHiragana = (text: string) => text.replace(/[ァ-ヶ]/g, kana => String.fromCharCode(kana.charCodeAt(0) - 0x60));

// The reading of a token, or null if kuromoji does not know it ('*' or none).
const readingOf = (token: kuromoji.Token) => (token.reading && token.reading !== '*' ? token.reading : null);

function attachesToPrevious(token: kuromoji.Token): boolean {
  switch (token.pos) {
    case '助動詞': return true;
    case '動詞': return token.pos_detail_1 === '非自立' || token.pos_detail_1 === '接尾';
    case '形容詞': return token.pos_detail_1 === '非自立';
    case '助詞': return token.pos_detail_1 === '接続助詞' && CONJUNCTIVE.has(token.surface_form);
    default: return false;
  }
}

// Turns kuromoji (ipadic) tokens into segments whose texts concatenate to the input.
// Content words carry a lemma; a verb or adjective absorbs its auxiliaries (食べなかった -> 食べる).
export function groupTokens(tokens: kuromoji.Token[]): Segment[] {
  const segments: Segment[] = [];
  // The katakana reading of each segment, null when a token of it has no reading.
  const readings: (string | null)[] = [];
  let head: kuromoji.Token | null = null;
  for (const token of tokens) {
    const text = token.surface_form;
    const last = segments.at(-1);
    if (head && last && INFLECTING_POS.has(head.pos) && attachesToPrevious(token)) {
      last.text += text;
      const [reading, more] = [readings.at(-1), readingOf(token)];
      readings[readings.length - 1] = reading && more ? reading + more : null;
      continue;
    }
    if (CONTENT_POS.has(token.pos) && JAPANESE.test(text)) {
      head = token;
      segments.push({ text, lemma: token.basic_form === '*' ? text : token.basic_form });
    } else {
      head = null;
      segments.push({ text });
    }
    readings.push(readingOf(token));
  }
  return segments.map((segment, i) => {
    const reading = readings[i];
    return segment.lemma && reading && KANJI.test(segment.text) ? { ...segment, reading: toHiragana(reading) } : segment;
  });
}
