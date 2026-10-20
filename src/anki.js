const ENDPOINT = 'http://127.0.0.1:8765';
const MODEL = 'Minerr';
const FIELDS = ['Word', 'Reading', 'Sentence', 'Definition', 'Image'];

export const DEFAULT_DECK = 'Minerr';
export const DEFAULT_KNOWN_QUERY = `deck:"${DEFAULT_DECK}" prop:ivl>=21`;
export const DEFAULT_KNOWN_FIELD = 'Word';

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
.dict { display: block; color: var(--muted); font-size: .7rem; }
.image { margin-top: 1.5rem; }
.image img { display: block; max-width: 100%; height: auto; margin: 0 auto; border-radius: .5rem; }
`;

export const NOTE_TYPE = {
  modelName: MODEL,
  inOrderFields: FIELDS,
  css: CSS,
  cardTemplates: [{
    Name: 'Recognition',
    Front: '<div class="sentence">{{Sentence}}</div>\n<div class="word">{{Word}}</div>',
    Back: `{{FrontSide}}
<hr id="answer">
<div class="headword"><ruby>{{Word}}{{#Reading}}<rt>{{Reading}}</rt>{{/Reading}}</ruby></div>
{{#Definition}}<div class="definition">{{Definition}}</div>{{/Definition}}
{{#Image}}<div class="image">{{Image}}</div>{{/Image}}`,
  }],
};

export const escapeHtml = text => text.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// entries are dictionary lookup results ({dict, glossary}); one dictionary label closes each run of the same dictionary.
export function definitionHtml(entries) {
  if (!entries.length) return '';
  const items = entries.map((e, i) => {
    const dict = e.dict === entries[i + 1]?.dict ? '' : `<span class="dict">${escapeHtml(e.dict)}</span>`;
    return `<li>${escapeHtml(e.glossary.join('\n')).replaceAll('\n', '<br>')}${dict}</li>`;
  });
  return `<ol>${items.join('')}</ol>`;
}

async function invoke(action, params = {}) {
  let response;
  try {
    response = await fetch(ENDPOINT, { method: 'POST', body: JSON.stringify({ action, version: 6, params }) });
  } catch {
    throw new Error(`AnkiConnect is unreachable at ${ENDPOINT}. Open Anki and install the AnkiConnect add-on.`);
  }
  const { result, error } = await response.json();
  if (error) throw new Error(`AnkiConnect ${action}: ${error}`);
  return result;
}

// Creates the note type, or converges an existing one to the current templates and CSS.
// An existing note type that lacks one of FIELDS is not migrated; addNote then fails with the AnkiConnect error.
async function ensureModel() {
  if (!(await invoke('modelNames')).includes(MODEL)) return invoke('createModel', NOTE_TYPE);
  const [{ Name, Front, Back }] = NOTE_TYPE.cardTemplates;
  await invoke('updateModelTemplates', { model: { name: MODEL, templates: { [Name]: { Front, Back } } } });
  await invoke('updateModelStyling', { model: { name: MODEL, css: CSS } });
}

// Once per service worker lifetime; a failed attempt (Anki closed) clears it so the next add tries again.
let modelReady = null;

// card: {word, reading, sentence, definition} as HTML field values; jpegDataUrl from captureVisibleTab.
export async function addNote(deck, card, jpegDataUrl) {
  await invoke('createDeck', { deck });
  modelReady ??= ensureModel().catch(error => { modelReady = null; throw error; });
  await modelReady;
  return invoke('addNote', {
    note: {
      deckName: deck,
      modelName: MODEL,
      fields: { Word: card.word, Reading: card.reading, Sentence: card.sentence, Definition: card.definition, Image: '' },
      tags: ['minerr'],
      picture: [{ data: jpegDataUrl.split(',')[1], filename: `minerr-${Date.now()}.jpg`, fields: ['Image'] }],
    },
  });
}

export const version = () => invoke('version');

const stripHtml = html => html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();

export async function fieldValues(query, field) {
  const notes = await invoke('notesInfo', { notes: await invoke('findNotes', { query }) });
  const values = notes.map(note => stripHtml(note.fields[field]?.value ?? '')).filter(Boolean);
  return [...new Set(values)];
}
