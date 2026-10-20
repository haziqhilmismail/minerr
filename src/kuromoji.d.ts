// The parts of kuromoji.js that Minerr uses. vendor/kuromoji/kuromoji.js defines the global kuromoji
// in the offscreen document; the unit tests import the npm package.
declare namespace kuromoji {
  // An ipadic token. A field that does not apply is '*'.
  interface Token {
    surface_form: string;
    pos: string;
    pos_detail_1: string;
    basic_form: string;
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
