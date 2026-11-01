import { isMetaRow, type TermMeta, toMeta } from './meta.ts';
import { at, isList } from '../shared/guards.ts';
import { type Bytes, unzip } from './zip.ts';

const BLOCK_TAGS = new Set(['div', 'p', 'li', 'ul', 'ol', 'table', 'tr', 'details', 'summary']);

export interface Tag {
  name: string;
  category: string;
  notes: string;
}

// A tag bank entry of one dictionary.
export type DictTag = Tag & { dict: string };

export interface Term {
  expression: string;
  reading: string;
  definitionTags: string[];
  termTags: string[];
  glossary: string[];
  score: number;
  // The entry of the term in a sequenced dictionary (JMdict): the terms of one word share it.
  sequence?: number;
  // The tags of definitionTags that a Jitendex entry writes in its own content. The import moves them to the tags store.
  inlineTags?: Tag[];
  // Examples, cross-references and sources: they show in the popup, but not on a card.
  notes?: string[];
}

// A term of one dictionary. A term imported before Minerr stored tags has no tag names.
export type DictTerm = Omit<Term, 'definitionTags' | 'termTags'> & Partial<Pick<Term, 'definitionTags' | 'termTags'>> & { dict: string };

export interface Sense {
  dict: string;
  tags: Tag[];
  glossary: string[];
  notes?: string[];
}

// One (expression, reading) with its senses.
export interface Group {
  expression: string;
  reading: string;
  termTags: Tag[];
  senses: Sense[];
}

// Yomitan term_bank row: [expression, reading, definitionTags, rules, score, glossary[], sequence, termTags].
// Tag names are separated by spaces.
export type TermRow = [
  expression: string, reading: string, definitionTags: string | null, rules: unknown, score: number,
  glossary: unknown[], sequence?: unknown, termTags?: string | null,
];

// Yomitan tag_bank row: [name, category, order, notes, score].
export type TagRow = [name: string, category: string, order: unknown, notes: string, score?: unknown];

const isTagNames = (value: unknown) => value === null || typeof value === 'string';

const isTermRow = (row: unknown): row is TermRow => isList(row) && typeof row[0] === 'string' && typeof row[1] === 'string'
  && isTagNames(row[2]) && typeof row[4] === 'number' && isList(row[5]) && (row[7] === undefined || isTagNames(row[7]));

const isTagRow = (row: unknown): row is TagRow => isList(row) && typeof row[0] === 'string' && typeof row[1] === 'string'
  && typeof row[3] === 'string';

const roleOf = (node: unknown) => at(at(node, 'data'), 'content');
const isTagNode = (node: unknown) => at(at(node, 'data'), 'class') === 'tag';

function flattenContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (isList(content)) return content.map(flattenContent).join('');
  if (!content || typeof content !== 'object') return '';
  const tag = at(content, 'tag');
  if (tag === 'br') return '\n';
  if (tag === 'rt' || tag === 'rp') return '';
  const inner = flattenContent(at(content, 'content'));
  // A label is a span next to other text, and only CSS keeps them apart. A span inside a sentence must stay joined.
  if (tag === 'td' || tag === 'th' || isTagNode(content) || roleOf(content) === 'reference-label') return `${inner} `;
  return typeof tag === 'string' && BLOCK_TAGS.has(tag) ? `\n${inner}\n` : inner;
}

// One glossary item (string, {type:'text'}, {type:'structured-content'}, or an image) -> plain text lines.
export function flattenGlossaryItem(item: unknown): string {
  const type = at(item, 'type');
  const text = typeof item === 'string' ? item
    : type === 'text' ? at(item, 'text')
    : type === 'structured-content' ? flattenContent(at(item, 'content'))
    : '';
  return typeof text === 'string' ? text.split('\n').map(line => line.trim()).filter(Boolean).join('\n') : '';
}

const splitTags = (names: string | null | undefined) => (names ?? '').split(' ').filter(Boolean);

// JMdict gives the redirect rows of a word (起き上る ⟶起き上がる) the negative sequence of the word.
// A dictionary without entries writes 0 or no sequence.
const entryOf = (sequence: unknown) => (typeof sequence === 'number' && Number.isSafeInteger(sequence) && sequence !== 0 ? Math.abs(sequence) : undefined);

const FORMS_TAG: Tag = { name: 'forms', category: '', notes: '' };

const childrenOf = (node: unknown): unknown[] => {
  const content = at(node, 'content');
  return isList(content) ? content : content === undefined ? [] : [content];
};

// The outermost nodes with one of the roles, in document order.
const withRole = (node: unknown, roles: string[]): unknown[] => (isList(node) ? node : [node]).flatMap(child => {
  const role = roleOf(child);
  return typeof role === 'string' && roles.includes(role) ? [child] : child && typeof child === 'object' ? withRole(childrenOf(child), roles) : [];
});

const linesOf = (content: unknown) => flattenContent(content).split('\n').map(line => line.trim()).filter(Boolean);

// The code is the JMdict name of the tag (n, v5r): the Lapis pitch categories read it.
function inlineTag(node: unknown): Tag {
  const code = at(at(node, 'data'), 'code');
  const title = at(node, 'title');
  return {
    name: typeof code === 'string' ? code : flattenContent(node).trim(),
    category: roleOf(node) === 'part-of-speech-info' ? 'partOfSpeech' : '',
    notes: typeof title === 'string' ? title : '',
  };
}

type EntrySense = Required<Pick<Term, 'inlineTags' | 'glossary' | 'notes'>>;

// A Jitendex entry holds all senses of a word in one row. An entry without sense groups returns no senses.
function jitendexSenses(content: unknown): EntrySense[] {
  const parts = withRole(content, ['sense-group', 'forms', 'attribution']);
  if (!parts.some(part => roleOf(part) === 'sense-group')) return [];
  const senses = parts.flatMap((part): EntrySense[] => {
    if (roleOf(part) === 'attribution') return [];
    if (roleOf(part) === 'forms') {
      return [{ inlineTags: [FORMS_TAG], glossary: linesOf(childrenOf(part).filter(child => roleOf(child) !== 'forms-label')), notes: [] }];
    }
    const shared = childrenOf(part).filter(isTagNode).map(inlineTag);
    // A group can say which spellings it applies to: 〔物作り only〕.
    const sharedNotes = linesOf(childrenOf(part).filter(child => !isTagNode(child) && !withRole(child, ['sense']).length));
    return withRole(part, ['sense']).map(sense => {
      const glossary = withRole(sense, ['glossary']).flatMap(list => childrenOf(list).flatMap(linesOf));
      const notes = [...sharedNotes, ...linesOf(childrenOf(sense).filter(child => !isTagNode(child) && roleOf(child) !== 'glossary'))];
      const inlineTags = [...shared, ...childrenOf(sense).filter(isTagNode).map(inlineTag)];
      // A few senses have only an explanation ("Literally ..."), and a card needs a definition.
      return glossary.length ? { inlineTags, glossary, notes } : { inlineTags, glossary: notes, notes: [] };
    });
  });
  senses.at(-1)?.notes.push(...withRole(parts, ['attribution']).flatMap(linesOf));
  return senses;
}

// An empty reading means the expression is its own reading.
function toTerm([expression, reading, definitionTags, , score, glossary, sequence, termTags]: TermRow): Term {
  const entry = entryOf(sequence);
  return {
    expression,
    reading: reading || expression,
    definitionTags: splitTags(definitionTags),
    termTags: splitTags(termTags),
    glossary: glossary.map(flattenGlossaryItem).filter(Boolean),
    score,
    ...(entry ? { sequence: entry } : {}),
  };
}

// One row of the term bank -> one term per sense, the shape of JMdict. The tags of the row belong to the word.
export function toTerms(row: TermRow): Term[] {
  const term = toTerm(row);
  const senses = row[5].flatMap(item => (at(item, 'type') === 'structured-content' ? jitendexSenses(at(item, 'content')) : []));
  if (!senses.length) return [term];
  return senses.map(({ inlineTags, glossary, notes }) => ({
    ...term,
    definitionTags: inlineTags.map(({ name }) => name),
    termTags: [...term.definitionTags, ...term.termTags],
    inlineTags,
    glossary,
    ...(notes.length ? { notes } : {}),
  }));
}

export const toTag = ([name, category, , notes]: TagRow): Tag => ({ name, category, notes });

// rows: terms with their dict, in score order. tags: the tag bank entries of their dictionaries.
// Returns one group per (expression, reading) with its senses; each dictionary's senses stay together.
// Tag names that are only digits are JMdict sense numbers, and the list numbers the senses already.
export function groupTerms(rows: DictTerm[], tags: DictTag[]): Group[] {
  const bank = new Map(tags.map(tag => [`${tag.dict}\n${tag.name}`, tag]));
  const resolve = (dict: string, names: string[] = []): Tag[] => names.filter(name => !/^\d+$/.test(name)).map(name => {
    const tag = bank.get(`${dict}\n${name}`);
    return { name, category: tag?.category ?? '', notes: tag?.notes ?? '' };
  });
  const groups = new Map<string, Omit<Group, 'senses'> & { byDict: Map<string, Sense[]> }>();
  for (const row of rows) {
    const key = `${row.expression}\n${row.reading}`;
    let group = groups.get(key);
    if (!group) {
      group = { expression: row.expression, reading: row.reading, termTags: [], byDict: new Map() };
      groups.set(key, group);
    }
    for (const tag of resolve(row.dict, row.termTags)) {
      if (!group.termTags.some(t => t.name === tag.name)) group.termTags.push(tag);
    }
    const senseTags = resolve(row.dict, row.definitionTags);
    // A JMdict "forms" sense lists the other spellings; one line reads better than one line per spelling.
    const glossary = senseTags.some(t => t.name === 'forms')
      ? [row.glossary.flatMap(text => text.split('\n')).join('、')]
      : row.glossary;
    let senses = group.byDict.get(row.dict);
    if (!senses) {
      senses = [];
      group.byDict.set(row.dict, senses);
    }
    senses.push({ dict: row.dict, tags: senseTags, glossary, ...(row.notes ? { notes: row.notes } : {}) });
  }
  return [...groups.values()].map(({ byDict, ...group }) => ({ ...group, senses: [...byDict.values()].flat() }));
}

type Read = () => Promise<Uint8Array>;

const decoder = new TextDecoder();
const readJson = async (read: Read): Promise<unknown> => JSON.parse(decoder.decode(await read()));

function rowsOf<Row>(name: string, rows: unknown, isRow: (row: unknown) => row is Row): Row[] {
  if (isList(rows) && rows.every(isRow)) return rows;
  throw new Error(`Not a Yomitan dictionary: ${name} has a row of the wrong shape`);
}

export interface YomitanDictionary {
  title: string;
  revision: string;
  // rank-based (1 is the most common word, the Yomitan default) or occurrence-based (a count).
  frequencyMode: 'rank-based' | 'occurrence-based';
  tags: Tag[];
  banks: (() => Promise<Term[]>)[];
  metaBanks: (() => Promise<TermMeta[]>)[];
}

// Returns the dictionary title/revision, its tags, and one loader per term bank and per term meta bank,
// so a caller holds one term bank in memory at a time.
export async function readYomitan(bytes: Bytes): Promise<YomitanDictionary> {
  const members = unzip(bytes);
  const readIndex = members.get('index.json');
  if (!readIndex) throw new Error('Not a Yomitan dictionary: index.json is missing');
  const index = await readJson(readIndex);
  const title = at(index, 'title');
  const revision = at(index, 'revision');
  if (typeof title !== 'string' || typeof revision !== 'string') {
    throw new Error('Not a Yomitan dictionary: index.json has no title or revision');
  }
  const named = (pattern: RegExp) => [...members].filter(([name]) => pattern.test(name));
  const banks = named(/^term_bank_\d+\.json$/)
    .map(([name, read]) => async () => rowsOf(name, await readJson(read), isTermRow).flatMap(toTerms));
  const tagBanks = await Promise.all(named(/^tag_bank_\d+\.json$/)
    .map(async ([name, read]) => rowsOf(name, await readJson(read), isTagRow)));
  const metaBanks = named(/^term_meta_bank_\d+\.json$/)
    .map(([name, read]) => async () => rowsOf(name, await readJson(read), isMetaRow).flatMap(row => toMeta(row) ?? []));
  const frequencyMode = at(index, 'frequencyMode') === 'occurrence-based' ? 'occurrence-based' : 'rank-based';
  return { title, revision, frequencyMode, tags: tagBanks.flat().map(toTag), banks, metaBanks };
}
