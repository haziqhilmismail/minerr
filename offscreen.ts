import { lookup } from './src/db.ts';
import { groupTokens } from './src/group.ts';
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
  },
  target => target === 'offscreen',
);
