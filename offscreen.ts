import { entryIndex, hasTerm, listDictionaries, lookup, pitchPatterns } from './src/db.ts';
import { dictionaryWords, entrySegments, type Words } from './src/entry.ts';
import { groupTokens, lookupCandidates } from './src/group.ts';
import { serve } from './src/rpc.ts';

const tokenizer = new Promise<kuromoji.Tokenizer>((resolve, reject) => {
  globalThis.kuromoji.builder({ dicPath: 'vendor/kuromoji/dict/' })
    .build((error, built) => (error ? reject(error) : resolve(built)));
});

// The entry cache lives as long as the installed dictionaries stay the same.
let cache: { dictionaries: string; words: Words } | null = null;
async function dictionaryWordsNow(): Promise<Words> {
  const dictionaries = JSON.stringify(await listDictionaries());
  if (cache?.dictionaries !== dictionaries) cache = { dictionaries, words: dictionaryWords(entryIndex) };
  return cache.words;
}

serve(
  {
    parse: async ({ texts }) => {
      // Without the dictionary list, the reads fail too, and entrySegments falls back to the kuromoji grouping.
      const [parser, words] = await Promise.all([tokenizer, dictionaryWordsNow().catch(() => dictionaryWords(entryIndex))]);
      return Promise.all(texts.map(text => entrySegments(parser.tokenize(text), words)));
    },
    lookup: ({ lemma }) => lookup(lemma),
    pitch: ({ words }) => pitchPatterns(words),
    lookupText: async ({ text }) => {
      const [parser, words] = await Promise.all([tokenizer, dictionaryWordsNow()]);
      for (const { lemma, length } of lookupCandidates(text, start => groupTokens(parser.tokenize(start)))) {
        if (await hasTerm(lemma)) return { lemma, length, entries: await lookup(lemma), entry: await words.entry(lemma, null) };
      }
      return null;
    },
    wordKeys: async ({ words }) => {
      const dictionary = await dictionaryWordsNow();
      return Promise.all(words.map(async word => (await dictionary.entry(word, null))?.key ?? word));
    },
  },
  target => target === 'offscreen',
);
