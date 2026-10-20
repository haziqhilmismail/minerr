import { unzip } from './zip.js';

const BLOCK_TAGS = new Set(['div', 'p', 'li', 'ul', 'ol', 'table', 'tr', 'details', 'summary']);

function flattenContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(flattenContent).join('');
  if (!content || typeof content !== 'object') return '';
  if (content.tag === 'br') return '\n';
  if (content.tag === 'rt' || content.tag === 'rp') return '';
  const inner = flattenContent(content.content);
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

// Yomitan term_bank row: [expression, reading, definitionTags, rules, score, glossary[], sequence, termTags].
// An empty reading means the expression is its own reading.
export function toTerm([expression, reading, , , score, glossary]) {
  return {
    expression,
    reading: reading || expression,
    glossary: glossary.map(flattenGlossaryItem).filter(Boolean),
    score,
  };
}

const decoder = new TextDecoder();
const readJson = async read => JSON.parse(decoder.decode(await read()));

// Returns the dictionary title/revision and one loader per term bank, so a caller holds one bank in memory at a time.
export async function readYomitan(bytes) {
  const members = unzip(bytes);
  if (!members.has('index.json')) throw new Error('Not a Yomitan dictionary: index.json is missing');
  const { title, revision } = await readJson(members.get('index.json'));
  const banks = [...members.keys()]
    .filter(name => /^term_bank_\d+\.json$/.test(name))
    .map(name => async () => (await readJson(members.get(name))).map(toTerm));
  return { title, revision, banks };
}
