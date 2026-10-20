import { at, isList } from './parse.ts';
import { TAG_CSS, tagClass } from './tags.ts';
import type { Group, Tag } from './yomitan.ts';

const ENDPOINT = 'http://127.0.0.1:8765';
const MODEL = 'Minerr';
const FIELDS = ['Word', 'Reading', 'Sentence', 'Definition', 'Image'];

export const DEFAULT_DECK = 'Minerr';
export const DEFAULT_KNOWN_QUERY = `deck:"${DEFAULT_DECK}" prop:ivl>=21`;
export const DEFAULT_KNOWN_FIELD = 'Word';

// The HTML values of the fields of a new note.
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

// Creates the note type, or converges an existing one to the current templates and CSS.
// It writes only what differs: AnkiConnect refuses note type writes while an Anki editor window is open.
// An existing note type that lacks one of FIELDS is not migrated; addNote then fails with the AnkiConnect error.
async function ensureModel(): Promise<void> {
  const names = await invoke('modelNames');
  if (!isList(names)) unexpected('modelNames');
  if (!names.includes(MODEL)) {
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

// jpegDataUrl is from captureVisibleTab. Returns the ID of the new note.
export async function addNote(deck: string, card: CardFields, jpegDataUrl: string): Promise<number> {
  await invoke('createDeck', { deck });
  modelReady ??= ensureModel().catch(error => { modelReady = null; throw error; });
  await modelReady;
  const noteId = await invoke('addNote', {
    note: {
      deckName: deck,
      modelName: MODEL,
      fields: { Word: card.word, Reading: card.reading, Sentence: card.sentence, Definition: card.definition, Image: '' },
      tags: ['minerr'],
      picture: [{ data: jpegDataUrl.split(',')[1] ?? '', filename: `minerr-${Date.now()}.jpg`, fields: ['Image'] }],
    },
  });
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
