import { at, isList, isRecordOf, isString, isStringList } from './parse.ts';
import { TAG_CSS, tagClass } from './tags.ts';
import type { Group, Tag } from './yomitan.ts';

const ENDPOINT = 'http://127.0.0.1:8765';
const MODEL = 'Minerr';
const FIELDS = ['Word', 'Reading', 'Sentence', 'Definition', 'Image'];

export const DEFAULT_DECK = 'Minerr';
export const DEFAULT_KNOWN_QUERY = `deck:"${DEFAULT_DECK}" prop:ivl>=21`;
export const DEFAULT_KNOWN_FIELD = 'Word';

// The word of a new note and its HTML: sentence has the word in <b>, definition is from definitionHtml.
export interface CardFields {
  word: string;
  reading: string;
  sentence: string;
  definition: string;
}

export async function getDeck(): Promise<string> {
  const { deck } = await chrome.storage.local.get({ deck: DEFAULT_DECK });
  return typeof deck === 'string' ? deck : DEFAULT_DECK;
}

// The page of the word of a new note.
export interface PageInfo {
  url: string;
  title: string;
}

// The note type of new notes. builtin is the Minerr note type, which Minerr makes and keeps up to date.
// custom is a note type of the user: fields maps each of its fields to a template with markers. Minerr never changes it.
export type NoteType = { kind: 'builtin' } | { kind: 'custom'; model: string; fields: Record<string, string> };

export const BUILTIN: NoteType = { kind: 'builtin' };

export function parseNoteType(value: unknown): NoteType {
  const model = at(value, 'model');
  const fields = at(value, 'fields');
  return at(value, 'kind') === 'custom' && isString(model) && isRecordOf(fields, isString)
    ? { kind: 'custom', model, fields } : BUILTIN;
}

export const getNoteType = async (): Promise<NoteType> => parseNoteType((await chrome.storage.local.get('noteType')).noteType);
export const setNoteType = (noteType: NoteType): Promise<void> => chrome.storage.local.set({ noteType });

export const MARKERS = ['word', 'reading', 'furigana', 'sentence', 'definition', 'image', 'url', 'title'] as const;
export type Marker = (typeof MARKERS)[number];
// The HTML that replaces each marker.
export type MarkerValues = Record<Marker, string>;

const MARKER = /\{([^{}]*)\}/g;
const isMarker = (name: unknown): name is Marker => MARKERS.some(marker => marker === name);

// The markers in template that are not in MARKERS, each one time, as written: ['{Word}'].
export const unknownMarkers = (template: string): string[] =>
  [...new Set([...template.matchAll(MARKER)].filter(match => !isMarker(match[1])).map(match => match[0]))];

// One pass, so a marker in a value (a page title with "{word}") stays as it is. The other text of template is HTML and stays as it is.
export const renderField = (template: string, values: MarkerValues): string =>
  template.replace(MARKER, (text, name: string) => (isMarker(name) ? values[name] : text));

// image is the HTML of the screenshot, or '' if no field uses {image}.
export function markerValues(card: CardFields, page: PageInfo, image: string): MarkerValues {
  const word = escapeHtml(card.word);
  const reading = escapeHtml(card.reading);
  return {
    word,
    reading,
    furigana: reading && reading !== word ? `${word}[${reading}]` : word,
    sentence: card.sentence,
    definition: card.definition,
    image,
    url: escapeHtml(page.url),
    title: escapeHtml(page.title),
  };
}

// Field names, in lower case with letters only, that get a marker by default. "Word Reading" is wordreading.
const FIELD_NAMES: Record<Marker, string[]> = {
  word: ['word', 'expression', 'vocab', 'vocabulary', 'term', 'kanji', 'front'],
  reading: ['reading', 'kana', 'wordreading', 'expressionreading', 'vocabreading'],
  furigana: ['furigana', 'wordfurigana', 'expressionfurigana', 'vocabfurigana'],
  sentence: ['sentence', 'example', 'context'],
  definition: ['meaning', 'definition', 'definitions', 'glossary', 'wordmeaning', 'maindefinition', 'vocabmeaning', 'back'],
  image: ['picture', 'image', 'screenshot', 'photo'],
  url: ['url', 'source', 'link'],
  title: ['title'],
};

// The default template of each field: one marker if the name is in FIELD_NAMES, else empty.
export function suggestFields(names: string[]): Record<string, string> {
  return Object.fromEntries(names.map(name => {
    const key = name.toLowerCase().replace(/[^a-z]/g, '');
    const marker = MARKERS.find(m => FIELD_NAMES[m].includes(key));
    return [name, marker ? `{${marker}}` : ''];
  }));
}

// The field that holds the word in dictionary form, for the import of known words.
export function wordField(noteType: NoteType): string {
  if (noteType.kind === 'builtin') return DEFAULT_KNOWN_FIELD;
  const [name] = Object.entries(noteType.fields).find(([, template]) => template.includes('{word}')) ?? [DEFAULT_KNOWN_FIELD];
  return name;
}

const CSS = `
.card {
  --bg: #f7f8fb; --text: #1e2230; --muted: #6b7083; --line: #dfe1ea; --accent: #2c4bb8; --mark: rgba(44, 75, 184, .16);
  padding: 2rem 1rem; background: var(--bg); color: var(--text); text-align: center;
  font-family: "Hiragino Sans", "Yu Gothic", "Meiryo", "Noto Sans JP", sans-serif; font-size: 1.25rem; line-height: 1.6;
}
.card.nightMode, .card.night_mode, .nightMode .card, .night_mode .card {
  --bg: #24252c; --text: #e9eaf0; --muted: #a0a3b2; --line: #3a3c47; --accent: #9aacf7; --mark: rgba(154, 172, 247, .2);
}
.sentence, #answer, .definition, .image { max-width: 36rem; margin-inline: auto; }
.sentence { font-size: clamp(1.5rem, 1.2rem + 1.5vw, 2.1rem); line-height: 1.7; }
.sentence b { padding: 0 .08em; color: var(--accent); background: linear-gradient(transparent 62%, var(--mark) 0); }
.word { margin-top: .75rem; color: var(--muted); font-size: 1rem; }
#answer { margin-block: 1.5rem 2rem; border: 0; border-top: 1px solid var(--line); }
.headword { font-size: 2.25rem; font-weight: 700; line-height: 1.3; }
.headword rt { ruby-align: center; color: var(--muted); font-size: .45em; font-weight: 400; }
.definition { margin-top: 1rem; text-align: left; }
.definition ol { margin: 0; padding-left: 1.6em; }
.definition li { margin-bottom: .6em; }
.definition li::marker { color: var(--muted); font-size: .85em; }
.definition .tags { margin-bottom: .6em; }
.dict { display: block; color: var(--muted); font-size: .7rem; }
${TAG_CSS}
.image { margin-top: 1.5rem; }
.image img { display: block; max-width: 100%; height: auto; margin: 0 auto; border-radius: .5rem; }
`;

// The one card type of the note type.
export const RECOGNITION = {
  Name: 'Recognition',
  Front: '<div class="sentence">{{Sentence}}</div>\n<div class="word">{{Word}}</div>',
  Back: `{{FrontSide}}
<hr id="answer">
<div class="headword"><ruby>{{Word}}{{#Reading}}<rt>{{Reading}}</rt>{{/Reading}}</ruby></div>
{{#Definition}}<div class="definition">{{Definition}}</div>{{/Definition}}
{{#Image}}<div class="image">{{Image}}</div>{{/Image}}`,
};

export const NOTE_TYPE = {
  modelName: MODEL,
  inOrderFields: FIELDS,
  css: CSS,
  cardTemplates: [RECOGNITION],
};

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
export const escapeHtml = (text: string): string => text.replace(/[&<>"]/g, c => ESCAPES[c] ?? c);

const tagsHtml = (tags: Tag[]) => tags
  .map(tag => `<span class="${tagClass(tag.category)}" title="${escapeHtml(tag.notes)}">${escapeHtml(tag.name)}</span> `).join('');

// group is one groupTerms group: its term tags as a chip row, then its senses as a numbered list with tag chips.
// One dictionary label closes each run of senses from the same dictionary.
export function definitionHtml(group: Group | undefined): string {
  if (!group) return '';
  const { termTags, senses } = group;
  const items = senses.map((sense, i) => {
    const dict = sense.dict === senses[i + 1]?.dict ? '' : `<span class="dict">${escapeHtml(sense.dict)}</span>`;
    return `<li>${tagsHtml(sense.tags)}${escapeHtml(sense.glossary.join('\n')).replaceAll('\n', '<br>')}${dict}</li>`;
  });
  const tags = termTags.length ? `<div class="tags">${tagsHtml(termTags).trimEnd()}</div>` : '';
  return `${tags}<ol>${items.join('')}</ol>`;
}

function unexpected(action: string): never {
  throw new Error(`AnkiConnect ${action}: unexpected reply`);
}

async function invoke(action: string, params: object = {}): Promise<unknown> {
  let response;
  try {
    response = await fetch(ENDPOINT, { method: 'POST', body: JSON.stringify({ action, version: 6, params }) });
  } catch {
    throw new Error(`AnkiConnect is unreachable at ${ENDPOINT}. Open Anki and install the AnkiConnect add-on.`);
  }
  const reply: unknown = await response.json();
  const error = at(reply, 'error');
  if (typeof error === 'string' && error.startsWith('Close the affected editor')) {
    throw new Error('Anki has a Browse, Add, or Edit window open. Close it, then try again.');
  }
  if (error) throw new Error(`AnkiConnect ${action}: ${error}`);
  return at(reply, 'result');
}

export async function modelNames(): Promise<string[]> {
  const names = await invoke('modelNames');
  if (!isStringList(names)) unexpected('modelNames');
  return names;
}

export async function modelFieldNames(model: string): Promise<string[]> {
  const names = await invoke('modelFieldNames', { modelName: model });
  if (!isStringList(names)) unexpected('modelFieldNames');
  return names;
}

// Creates the note type, or converges an existing one to the current templates and CSS.
// It writes only what differs: AnkiConnect refuses note type writes while an Anki editor window is open.
// An existing note type that lacks one of FIELDS is not migrated; addNote then fails with the AnkiConnect error.
async function ensureModel(): Promise<void> {
  if (!(await modelNames()).includes(MODEL)) {
    await invoke('createModel', NOTE_TYPE);
    return;
  }
  const { Name, Front, Back } = RECOGNITION;
  const [templates, styling] = await Promise.all([
    invoke('modelTemplates', { modelName: MODEL }),
    invoke('modelStyling', { modelName: MODEL }),
  ]);
  if (at(templates, Name, 'Front') !== Front || at(templates, Name, 'Back') !== Back) {
    await invoke('updateModelTemplates', { model: { name: MODEL, templates: { [Name]: { Front, Back } } } });
  }
  if (at(styling, 'css') !== CSS) await invoke('updateModelStyling', { model: { name: MODEL, css: CSS } });
}

// Once per service worker lifetime; a failed attempt (Anki closed) clears it so the next add tries again.
let modelReady: Promise<void> | null = null;

// A JPEG file for AnkiConnect: data is base64.
interface Picture {
  filename: string;
  data: string;
}

async function builtinNote(card: CardFields, picture: Picture) {
  modelReady ??= ensureModel().catch(error => { modelReady = null; throw error; });
  await modelReady;
  return {
    modelName: MODEL,
    fields: { Word: card.word, Reading: card.reading, Sentence: card.sentence, Definition: card.definition, Image: '' },
    picture: [{ ...picture, fields: ['Image'] }],
  };
}

// The screenshot goes to the media folder only if a field uses {image}; {image} then becomes an <img> of the stored file.
async function customNote({ model, fields }: Extract<NoteType, { kind: 'custom' }>, card: CardFields, page: PageInfo, picture: Picture) {
  const templates = Object.entries(fields);
  let image = '';
  if (templates.some(([, template]) => template.includes('{image}'))) {
    const stored = await invoke('storeMediaFile', picture);
    if (!isString(stored)) unexpected('storeMediaFile');
    image = `<img src="${escapeHtml(stored)}">`;
  }
  const values = markerValues(card, page, image);
  return { modelName: model, fields: Object.fromEntries(templates.map(([name, template]) => [name, renderField(template, values)])) };
}

export interface NewNote {
  deck: string;
  noteType: NoteType;
  card: CardFields;
  page: PageInfo;
  // From captureVisibleTab.
  jpegDataUrl: string;
}

// Returns the ID of the new note.
export async function addNote({ deck, noteType, card, page, jpegDataUrl }: NewNote): Promise<number> {
  await invoke('createDeck', { deck });
  const picture = { data: jpegDataUrl.split(',')[1] ?? '', filename: `minerr-${Date.now()}.jpg` };
  const note = noteType.kind === 'builtin' ? await builtinNote(card, picture) : await customNote(noteType, card, page, picture);
  const noteId = await invoke('addNote', { note: { deckName: deck, ...note, tags: ['minerr'] } });
  if (typeof noteId !== 'number') unexpected('addNote');
  return noteId;
}

export async function version(): Promise<number> {
  const value = await invoke('version');
  if (typeof value !== 'number') unexpected('version');
  return value;
}

const stripHtml = (html: string) => html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();

export async function fieldValues(query: string, field: string): Promise<string[]> {
  const notes = await invoke('notesInfo', { notes: await invoke('findNotes', { query }) });
  if (!isList(notes)) unexpected('notesInfo');
  const values = notes.map(note => {
    const value = at(note, 'fields', field, 'value');
    return typeof value === 'string' ? stripHtml(value) : '';
  }).filter(Boolean);
  return [...new Set(values)];
}
