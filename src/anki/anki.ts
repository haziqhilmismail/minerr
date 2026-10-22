import { hasKanji, toHiragana } from '../text/group.ts';
import {
  furiganaPlain, harmonicRank, KANJI_FIELD, LAPIS_MODEL, LAPIS_PACKAGE_URL, LAPIS_SAMPLE_EXPRESSION, type LapisField, pitchCategories,
  pitchPositions, withKanjiLine,
} from './lapis.ts';
import type { Entry } from '../dictionary/meta.ts';
import { at, isList, isRecordOf, isString, isStringList } from '../shared/guards.ts';
import { TAG_CSS, tagClass } from '../dictionary/tags.ts';
import type { Group, Sense, Tag } from '../dictionary/yomitan.ts';

const ENDPOINT = 'http://127.0.0.1:8765';
const MODEL = 'Minerr';
const FIELDS = ['Word', 'Reading', 'Sentence', 'Definition', 'Image', 'SentenceAudio'];

export const DEFAULT_DECK = 'Minerr';
export const DEFAULT_KNOWN_QUERY = `deck:"${DEFAULT_DECK}" prop:ivl>=21`;
export const DEFAULT_KNOWN_FIELD = 'Word';

// The word of a new note and its HTML: sentence has the word in <b>, definition is from definitionHtml.
// entry is the first dictionary entry of the word, null if no dictionary has it. selection is the selected text of Alt+S, else ''.
// The service worker adds audio, the audio of the subtitle line for a word in video subtitles, and wordAudio, the audio of the word.
export interface CardFields {
  word: string;
  reading: string;
  sentence: string;
  definition: string;
  entry: Entry | null;
  selection: string;
  // The media of the card, which the service worker adds: the screenshot of the tab, the line audio, and the word audio.
  image?: MediaFile;
  audio?: MediaFile;
  wordAudio?: MediaFile;
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

// The note type of new notes. lapis is the Lapis note type of the user, with a fixed field map; Minerr only adds the ExpressionKanji field to it.
// builtin is the classic Minerr note type, which Minerr makes and keeps up to date.
// custom is a note type of the user: fields maps each of its fields to a template with markers. Minerr never changes it.
export type NoteType = { kind: 'lapis' } | { kind: 'builtin' } | { kind: 'custom'; model: string; fields: Record<string, string> };

export const LAPIS: NoteType = { kind: 'lapis' };
export const BUILTIN: NoteType = { kind: 'builtin' };

// Lapis is the default for a user who never selected a note type.
export function parseNoteType(value: unknown): NoteType {
  const kind = at(value, 'kind');
  const model = at(value, 'model');
  const fields = at(value, 'fields');
  if (kind === 'custom' && isString(model) && isRecordOf(fields, isString)) return { kind: 'custom', model, fields };
  return kind === 'builtin' ? BUILTIN : LAPIS;
}

export const getNoteType = async (): Promise<NoteType> => parseNoteType((await chrome.storage.local.get('noteType')).noteType);
export const setNoteType = (noteType: NoteType): Promise<void> => chrome.storage.local.set({ noteType });

export const MARKERS = ['word', 'reading', 'kanji', 'furigana', 'sentence', 'definition', 'image', 'audio', 'wordaudio', 'url', 'title'] as const;
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

// The HTML of the media of a note: the <img> of the screenshot, and the [sound:...] tags of the line audio and the word audio. '' for none.
export type MediaHtml = Record<'image' | 'audio' | 'wordaudio', string>;

// The kanji spelling of a word in kana: the headword of its dictionary entry when that has kanji (かわいい, 可愛い). '' for a word with kanji.
export const kanjiSpelling = (word: string, entry: Group | null): string =>
  (!hasKanji(word) && entry && hasKanji(entry.expression) ? entry.expression : '');

export function markerValues(card: CardFields, page: PageInfo, media: MediaHtml): MarkerValues {
  const word = escapeHtml(card.word);
  const reading = escapeHtml(card.reading);
  return {
    word,
    reading,
    kanji: escapeHtml(kanjiSpelling(card.word, card.entry)),
    furigana: reading && reading !== word ? `${word}[${reading}]` : word,
    sentence: card.sentence,
    definition: card.definition,
    ...media,
    url: escapeHtml(page.url),
    title: escapeHtml(page.title),
  };
}

// Senses as Yomitan {glossary} writes them, with its compact tags: a sense shows its tags only when they differ from the sense
// before, and the glossary items of a sense go on one line.
function yomitanGlossary(senses: Sense[]): string {
  let previous = '';
  const items = senses.map(({ dict, tags, glossary }) => {
    const names = tags.map(tag => escapeHtml(tag.name)).join(', ');
    const label = names && names !== previous ? `<i>(${names})</i> ` : '';
    previous = names;
    return `<li data-dictionary="${escapeHtml(dict)}">${label}${glossary.map(line => escapeHtml(line).replaceAll('\n', '; ')).join('; ')}</li>`;
  });
  return items.length ? `<div style="text-align: left;" class="yomitan-glossary"><ol>${items.join('')}</ol></div>` : '';
}

// The main meaning: the first sense of the entry, as Yomitan {single-glossary-<dictionary>} writes it. The "forms" sense of
// JMdict is a list of spellings, not a meaning.
function mainDefinition(entry: Entry | null): string {
  return entry ? yomitanGlossary(entry.senses.filter(({ tags }) => !tags.some(tag => tag.name === 'forms')).slice(0, 1)) : '';
}

// Yomitan {frequencies}.
const frequencyList = (entry: Entry | null) => (entry?.frequencies.length
  ? `<ul style="text-align: left;">${entry.frequencies.map(({ dict, display }) => `<li>${escapeHtml(dict)}: ${escapeHtml(display)}</li>`).join('')}</ul>` : '');

// The fields of a Lapis note, with the values of the Yomitan setup of the Lapis README. Lapis wants SentenceFurigana empty.
export function lapisFields(card: CardFields, page: PageInfo, media: MediaHtml): Record<LapisField, string> {
  const values = markerValues(card, page, media);
  const { entry } = card;
  return {
    Expression: values.word,
    ExpressionFurigana: escapeHtml(furiganaPlain(card.word, card.reading)),
    ExpressionReading: escapeHtml(toHiragana(card.reading)),
    ExpressionAudio: values.wordaudio,
    SelectionText: escapeHtml(card.selection),
    MainDefinition: mainDefinition(entry),
    DefinitionPicture: '',
    Sentence: values.sentence,
    SentenceFurigana: '',
    SentenceAudio: values.audio,
    Picture: values.image,
    // Only the main meaning for now: the other senses stay out of the card.
    Glossary: '',
    Hint: '',
    IsWordAndSentenceCard: '',
    IsClickCard: '',
    // A sentence card: the sentence on the front, the word and its definition on the back.
    IsSentenceCard: 'x',
    IsAudioCard: '',
    PitchPosition: entry ? pitchPositions(entry.pitches) : '',
    PitchCategories: entry ? pitchCategories(entry) : '',
    Frequency: frequencyList(entry),
    FreqSort: String(harmonicRank(entry?.frequencies ?? []) ?? 9999999),
    MiscInfo: `${values.title}<br><a href="${values.url}">${values.url}</a>`,
    ExpressionKanji: values.kanji,
  };
}

// Field names, in lower case with letters only, that get a marker by default. "Word Reading" is wordreading.
const FIELD_NAMES: Record<Marker, string[]> = {
  word: ['word', 'expression', 'vocab', 'vocabulary', 'term', 'kanji', 'front'],
  reading: ['reading', 'kana', 'wordreading', 'expressionreading', 'vocabreading'],
  kanji: ['expressionkanji', 'wordkanji', 'vocabkanji', 'kanjispelling'],
  furigana: ['furigana', 'wordfurigana', 'expressionfurigana', 'vocabfurigana'],
  sentence: ['sentence', 'example', 'context'],
  definition: ['meaning', 'definition', 'definitions', 'glossary', 'wordmeaning', 'maindefinition', 'vocabmeaning', 'back'],
  image: ['picture', 'image', 'screenshot', 'photo'],
  audio: ['sentenceaudio', 'audio', 'sound'],
  wordaudio: ['wordaudio', 'expressionaudio', 'vocabaudio', 'termaudio'],
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
  if (noteType.kind === 'lapis') return 'Expression';
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
.audio { margin-top: .5rem; }
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
{{#SentenceAudio}}<div class="audio">{{SentenceAudio}}</div>{{/SentenceAudio}}
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

// Creates the note type, or converges an existing one to the current fields, templates, and CSS.
// It writes only what differs: AnkiConnect refuses note type writes while an Anki editor window is open.
// A field that is missing (a note type from an earlier version) gets added; Minerr never removes or renames a field.
async function ensureModel(): Promise<void> {
  if (!(await modelNames()).includes(MODEL)) {
    await invoke('createModel', NOTE_TYPE);
    return;
  }
  const { Name, Front, Back } = RECOGNITION;
  const [fields, templates, styling] = await Promise.all([
    modelFieldNames(MODEL),
    invoke('modelTemplates', { modelName: MODEL }),
    invoke('modelStyling', { modelName: MODEL }),
  ]);
  for (const fieldName of FIELDS.filter(name => !fields.includes(name))) {
    await invoke('modelFieldAdd', { modelName: MODEL, fieldName, index: FIELDS.indexOf(fieldName) });
  }
  if (at(templates, Name, 'Front') !== Front || at(templates, Name, 'Back') !== Back) {
    await invoke('updateModelTemplates', { model: { name: MODEL, templates: { [Name]: { Front, Back } } } });
  }
  if (at(styling, 'css') !== CSS) await invoke('updateModelStyling', { model: { name: MODEL, css: CSS } });
}

const LAPIS_MISSING = 'Anki has no Lapis note type. Install Lapis in Options, or select another note type.';

const hasBack = (template: unknown): template is { Back: string } => isString(at(template, 'Back'));

// Adds the kanji spelling field to Lapis, and its line to each back template that has the word line. Each write happens once:
// a second run finds the field and the line, and writes nothing.
async function ensureLapis(): Promise<void> {
  if (!(await modelNames()).includes(LAPIS_MODEL)) throw new Error(LAPIS_MISSING);
  const [fields, templates] = await Promise.all([modelFieldNames(LAPIS_MODEL), invoke('modelTemplates', { modelName: LAPIS_MODEL })]);
  if (!fields.includes(KANJI_FIELD)) await invoke('modelFieldAdd', { modelName: LAPIS_MODEL, fieldName: KANJI_FIELD, index: fields.length });
  if (!isRecordOf(templates, hasBack)) unexpected('modelTemplates');
  const changed = Object.entries(templates).flatMap(([name, { Back }]) => {
    const next = withKanjiLine(Back);
    return next === null ? [] : [[name, { Back: next }] as const];
  });
  if (changed.length) await invoke('updateModelTemplates', { model: { name: LAPIS_MODEL, templates: Object.fromEntries(changed) } });
}

// Runs ensure once per service worker lifetime; a failed attempt (Anki closed) is forgotten, so the next add tries again.
function once(ensure: () => Promise<void>): () => Promise<void> {
  let pending: Promise<void> | null = null;
  return () => (pending ??= ensure().catch(error => { pending = null; throw error; }));
}
const modelReady = once(ensureModel);
const lapisReady = once(ensureLapis);

// A media file for AnkiConnect: data is base64. The screenshot is a JPEG; the line audio is an MP3 or a WebM.
export interface MediaFile {
  filename: string;
  data: string;
}

// Stores file in the media folder of Anki and returns the name that Anki gave it.
async function store(file: MediaFile): Promise<string> {
  const stored = await invoke('storeMediaFile', file);
  if (!isString(stored)) unexpected('storeMediaFile');
  return stored;
}

// A note before it goes to Anki. The fields name each file of media by its filename; the edit form changes the fields.
export interface NoteDraft {
  modelName: string;
  fields: Record<string, string>;
  media: MediaFile[];
}

const soundTag = (file: MediaFile | undefined) => (file ? `[sound:${file.filename}]` : '');

// The note of a card for the note type.
export function noteDraft(noteType: NoteType, card: CardFields, page: PageInfo): NoteDraft {
  const media = [card.image, card.audio, card.wordAudio].filter((file): file is MediaFile => file !== undefined);
  const html: MediaHtml = { image: card.image ? `<img src="${escapeHtml(card.image.filename)}">` : '', audio: soundTag(card.audio), wordaudio: soundTag(card.wordAudio) };
  switch (noteType.kind) {
    case 'lapis':
      return { modelName: LAPIS_MODEL, fields: lapisFields(card, page, html), media };
    case 'builtin':
      return {
        modelName: MODEL, media,
        fields: { Word: card.word, Reading: card.reading, Sentence: card.sentence, Definition: card.definition, Image: html.image, SentenceAudio: html.audio },
      };
    case 'custom': {
      const values = markerValues(card, page, html);
      return { modelName: noteType.model, fields: Object.fromEntries(Object.entries(noteType.fields).map(([name, template]) => [name, renderField(template, values)])), media };
    }
  }
}

// True if the note type has a field for the word audio, so the service worker fetches it.
export const usesWordAudio = (noteType: NoteType): boolean =>
  noteType.kind === 'lapis' || (noteType.kind === 'custom' && Object.values(noteType.fields).some(template => template.includes('{wordaudio}')));

// Adds the note and returns its ID. Only the files that a field still names go to the media folder of Anki.
export async function addDraft(deck: string, { modelName, fields, media }: NoteDraft): Promise<number> {
  await invoke('createDeck', { deck });
  if (modelName === MODEL) await modelReady();
  else if (modelName === LAPIS_MODEL) await lapisReady();
  let stored = fields;
  for (const file of media.filter(file => Object.values(fields).some(value => value.includes(file.filename)))) {
    const name = await store(file);
    stored = Object.fromEntries(Object.entries(stored).map(([field, value]) => [field, value.replaceAll(file.filename, name)]));
  }
  const noteId = await invoke('addNote', { note: { deckName: deck, modelName, fields: stored, tags: ['minerr'] } });
  if (typeof noteId !== 'number') unexpected('addNote');
  return noteId;
}

const LAPIS_PACKAGE = '_minerr_lapis.apkg';

// Imports Lapis.apkg from the Lapis project, if Anki has no Lapis note type. AnkiConnect downloads the file to the media folder.
// importPackage needs the full path: Anki does not run in the media folder. The package also makes a "Lapis" deck with one sample note:
// Minerr deletes that deck only if it holds the sample note and nothing else.
export async function installLapis(): Promise<string> {
  if ((await modelNames()).includes(LAPIS_MODEL)) return 'Lapis is already in Anki.';
  const filename = await invoke('storeMediaFile', { filename: LAPIS_PACKAGE, url: LAPIS_PACKAGE_URL });
  if (!isString(filename)) unexpected('storeMediaFile');
  try {
    const folder = await invoke('getMediaDirPath');
    if (!isString(folder)) unexpected('getMediaDirPath');
    if (await invoke('importPackage', { path: `${folder}/${filename}` }) !== true) throw new Error('Anki did not import Lapis.apkg.');
  } finally {
    await invoke('deleteMediaFile', { filename });
  }
  const decks = await invoke('deckNames');
  if (!isStringList(decks)) unexpected('deckNames');
  if (!decks.includes(LAPIS_MODEL)) return 'Installed Lapis.';
  const notes = await invoke('notesInfo', { notes: await invoke('findNotes', { query: `deck:"${LAPIS_MODEL}"` }) });
  if (!isList(notes)) unexpected('notesInfo');
  const onlySample = notes.length > 0
    && notes.every(note => at(note, 'modelName') === LAPIS_MODEL && at(note, 'fields', 'Expression', 'value') === LAPIS_SAMPLE_EXPRESSION);
  if (!onlySample) return 'Installed Lapis. The "Lapis" deck has other notes, so Minerr kept it.';
  await invoke('deleteDecks', { decks: [LAPIS_MODEL], cardsToo: true });
  return 'Installed Lapis.';
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
