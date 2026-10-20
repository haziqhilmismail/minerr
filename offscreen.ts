import { hasTerm, lookup, pitchPatterns } from './src/db.ts';
import { groupTokens, lookupCandidates } from './src/group.ts';
import { serve } from './src/rpc.ts';

const tokenizer = new Promise<kuromoji.Tokenizer>((resolve, reject) => {
  globalThis.kuromoji.builder({ dicPath: 'vendor/kuromoji/dict/' })
    .build((error, built) => (error ? reject(error) : resolve(built)));
});

serve(
  {
    parse: async ({ texts }) => {
      const parser = await tokenizer;
      return texts.map(text => groupTokens(parser.tokenize(text)));
    },
    lookup: ({ lemma }) => lookup(lemma),
    pitch: ({ words }) => pitchPatterns(words),
    lookupText: async ({ text }) => {
      const parser = await tokenizer;
      for (const { lemma, length } of lookupCandidates(text, start => groupTokens(parser.tokenize(start)))) {
        if (await hasTerm(lemma)) return { lemma, length, entries: await lookup(lemma) };
      }
      return null;
    },
  },
  target => target === 'offscreen',
);
