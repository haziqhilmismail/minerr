import { unzip } from './zip.js';

const BLOCK_TAGS = new Set(['div', 'p', 'li', 'ul', 'ol', 'table', 'tr', 'details', 'summary']);

function flattenContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(flattenContent).join('');
  if (!content || typeof content !== 'object') return '';
  if (content.tag === 'br') return '\n';
  if (content.tag === 'rt' || content.tag === 'rp') return '';
  const inner = flattenContent(content.content);
  if (content.tag === 'td' || content.tag === 'th') return `${inner} `;
  return BLOCK_TAGS.has(content.tag) ? `\n${inner}\n` : inner;
}

// One glossary item (string, {type:'text'}, {type:'structured-content'}, or an image) -> plain text lines.
export function flattenGlossaryItem(item) {
  const text = typeof item === 'string' ? item
    : item?.type === 'text' ? item.text
    : item?.type === 'structured-content' ? flattenContent(item.content)
    : '';
  return text.split('\n').map(line => line.trim()).filter(Boolean).join('\n');
}

const splitTags = names => (names ?? '').split(' ').filter(Boolean);

// Yomitan term_bank row: [expression, reading, definitionTags, rules, score, glossary[], sequence, termTags].
// An empty reading means the expression is its own reading.
export function toTerm([expression, reading, definitionTags, , score, glossary, , termTags]) {
  return {
    expression,
    reading: reading || expression,
    definitionTags: splitTags(definitionTags),
    termTags: splitTags(termTags),
    glossary: glossary.map(flattenGlossaryItem).filter(Boolean),
    score,
  };
}

// Yomitan tag_bank row: [name, category, order, notes, score].
export const toTag = ([name, category, , notes]) => ({ name, category, notes });

// rows: terms with their dict, in score order. tags: tag bank entries {dict, name, category, notes}.
// Returns one group per (expression, reading) with its senses; each dictionary's senses stay together.
// Tag names that are only digits are JMdict sense numbers, and the list numbers the senses already.
export function groupTerms(rows, tags) {
  const bank = new Map(tags.map(tag => [`${tag.dict}\n${tag.name}`, tag]));
  const resolve = (dict, names = []) => names.filter(name => !/^\d+$/.test(name)).map(name => {
    const { category = '', notes = '' } = bank.get(`${dict}\n${name}`) ?? {};
    return { name, category, notes };
  });
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.expression}\n${row.reading}`;
    if (!groups.has(key)) groups.set(key, { expression: row.expression, reading: row.reading, termTags: [], byDict: new Map() });
    const group = groups.get(key);
    for (const tag of resolve(row.dict, row.termTags)) {
      if (!group.termTags.some(t => t.name === tag.name)) group.termTags.push(tag);
    }
    const senseTags = resolve(row.dict, row.definitionTags);
    // A JMdict "forms" sense lists the other spellings; one line reads better than one line per spelling.
    const glossary = senseTags.some(t => t.name === 'forms')
      ? [row.glossary.flatMap(text => text.split('\n')).join('、')]
      : row.glossary;
    if (!group.byDict.has(row.dict)) group.byDict.set(row.dict, []);
    group.byDict.get(row.dict).push({ dict: row.dict, tags: senseTags, glossary });
  }
  return [...groups.values()].map(({ byDict, ...group }) => ({ ...group, senses: [...byDict.values()].flat() }));
}

const decoder = new TextDecoder();
const readJson = async read => JSON.parse(decoder.decode(await read()));

// Returns the dictionary title/revision, its tags, and one loader per term bank,
// so a caller holds one term bank in memory at a time.
export async function readYomitan(bytes) {
  const members = unzip(bytes);
  if (!members.has('index.json')) throw new Error('Not a Yomitan dictionary: index.json is missing');
  const { title, revision } = await readJson(members.get('index.json'));
  const named = pattern => [...members.keys()].filter(name => pattern.test(name)).map(name => members.get(name));
  const banks = named(/^term_bank_\d+\.json$/).map(read => async () => (await readJson(read)).map(toTerm));
  const tags = (await Promise.all(named(/^tag_bank_\d+\.json$/).map(readJson))).flat().map(toTag);
  return { title, revision, tags, banks };
}
