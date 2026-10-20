import { lookup } from './src/db.js';
import { groupTokens } from './src/group.js';
import { serve } from './src/rpc.js';

const tokenizer = new Promise((resolve, reject) => {
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
  message => message.target === 'offscreen',
);
