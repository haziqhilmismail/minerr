// The parts of kuromoji.js that Minerr uses. vendor/kuromoji/kuromoji.js defines the global kuromoji
// in the offscreen document; the unit tests import the npm package.
declare namespace kuromoji {
  // An ipadic token. A field that does not apply is '*'.
  interface Token {
    surface_form: string;
    pos: string;
    pos_detail_1: string;
    // The conjugation of a verb, adjective, or auxiliary: 五段・カ行イ音便 and 連用タ接続 in 書い.
    conjugated_type: string;
    conjugated_form: string;
    basic_form: string;
    // In katakana. A word that is not in the dictionary has none.
    reading?: string;
  }
  interface Tokenizer {
    tokenize(text: string): Token[];
  }
  interface Builder {
    build(callback: (error: Error | null, tokenizer: Tokenizer) => void): void;
  }
  function builder(options: { dicPath: string }): Builder;
}

declare module 'kuromoji' {
  export = kuromoji;
}
