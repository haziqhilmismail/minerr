import {
  BUILTIN, DEFAULT_DECK, DEFAULT_KNOWN_QUERY, definitionHtml, getDeck, getNoteType, markerValues, NOTE_TYPE, type NoteType,
  renderField, setNoteType, suggestFields, unknownMarkers, wordField,
} from './src/anki.ts';
import { deleteDictionary, importDictionary, listDictionaries } from './src/db.ts';
import { byId } from './src/dom.ts';
import { furiganaMode } from './src/furigana.ts';
import { hoverMode } from './src/hover.ts';
import { PITCH } from './src/meta.ts';
import { pitchColors } from './src/pitch-colors.ts';
import type { Setting } from './src/settings.ts';
import { call, messageOf } from './src/rpc.ts';
import {
  getAllStatuses, importStatuses, onStatusChange, parseStatusFile, STATUS_NAMES, STATUSES, statusFile, WORD_CSS,
} from './src/status.ts';
import { TAG_CSS } from './src/tags.ts';
import { applyTheme, theme } from './src/theme.ts';

applyTheme();

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

const swatch = (color: string) => {
  const dot = el('span', { className: 'swatch' });
  dot.style.background = color;
  return dot;
};

function showStatus(node: HTMLElement, text: string, kind = ''): void {
  node.textContent = text;
  node.className = `status ${kind}`;
}

const dictList = byId('dict-list', HTMLElement);
const metaText = (meta = 0) => (meta ? `, ${meta} frequency and pitch entries` : '');

async function showDictionaries(): Promise<void> {
  const dictionaries = await listDictionaries();
  const items = dictionaries.map(({ title, count, tags, meta: entries }) => {
    const remove = el('button', { type: 'button', className: 'delete', textContent: 'Delete' });
    remove.onclick = async () => {
      if (!confirm(`Delete the dictionary "${title}"?`)) return;
      remove.disabled = true;
      await deleteDictionary(title);
      await showDictionaries();
    };
    // An import from before tags were stored has no tags flag.
    const meta = count === null ? 'Import not finished. Import it again.'
      : tags ? `${count} terms${metaText(entries)}` : `${count} terms. Import again to show tags.`;
    return el('li', { className: count === null || !tags ? 'warn' : '' },
      el('div', {}, el('span', { className: 'name', textContent: title }), el('span', { className: 'meta', textContent: meta })),
      remove);
  });
  dictList.replaceChildren(...(items.length ? items
    : [el('li', { className: 'empty', textContent: 'No dictionary installed. Import one to see definitions in the popup.' })]));
}

const fileInput = byId('dict-file', HTMLInputElement);
const progress = byId('dict-progress', HTMLProgressElement);

async function importFile(file: File): Promise<void> {
  const status = byId('dict-status', HTMLElement);
  fileInput.disabled = true;
  dictList.hidden = true;
  progress.removeAttribute('value');
  progress.hidden = false;
  try {
    showStatus(status, `Reading ${file.name}…`);
    const { title, count, meta } = await importDictionary(await file.arrayBuffer(), ({ bank, banks, count }) => {
      progress.max = banks;
      progress.value = bank;
      showStatus(status, `Importing ${file.name}: bank ${bank} of ${banks}, ${count} terms`);
    });
    showStatus(status, `Imported ${title}: ${count} terms${metaText(meta)}`, 'ok');
  } catch (error) {
    showStatus(status, `Import failed: ${messageOf(error)}`, 'error');
  } finally {
    fileInput.disabled = false;
    fileInput.value = '';
    progress.hidden = true;
    await showDictionaries();
    dictList.hidden = false;
  }
}

fileInput.onchange = () => {
  const file = fileInput.files?.[0];
  if (file) importFile(file);
};
const drop = byId('dict-drop', HTMLElement);
drop.ondragover = event => {
  event.preventDefault();
  drop.classList.add('over');
};
drop.ondragleave = () => drop.classList.remove('over');
drop.ondrop = event => {
  event.preventDefault();
  drop.classList.remove('over');
  const file = event.dataTransfer?.files[0];
  if (file && !fileInput.disabled) importFile(file);
};

const deck = byId('deck', HTMLInputElement);
const deckSaved = byId('deck-saved', HTMLElement);
deck.value = await getDeck();
deck.oninput = () => showStatus(deckSaved, '');
deck.onchange = async () => {
  const value = deck.value.trim() || DEFAULT_DECK;
  deck.value = value;
  await chrome.storage.local.set({ deck: value });
  showStatus(deckSaved, 'Saved', 'ok');
};

const knownQuery = byId('known-query', HTMLInputElement);
const knownField = byId('known-field', HTMLInputElement);
knownQuery.value = DEFAULT_KNOWN_QUERY;

const SAMPLE_IMAGE = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180">
<rect width="320" height="180" fill="#3b4a5e"/><rect y="132" width="320" height="48" fill="#000"/>
<text x="160" y="164" fill="#fff" font-size="20" text-anchor="middle" font-family="sans-serif">猫が魚を食べなかった。</text></svg>`)}`;
const SAMPLE = markerValues({
  word: '食べる',
  reading: 'たべる',
  sentence: '猫が魚を<b>食べなかった</b>。',
  definition: definitionHtml({
    expression: '食べる',
    reading: 'たべる',
    termTags: [{ name: '⭐', category: 'popular', notes: 'high priority term' }],
    senses: [
      { dict: 'JMdict', tags: [{ name: 'v1', category: 'partOfSpeech', notes: 'Ichidan verb' }], glossary: ['to eat'] },
      { dict: 'JMdict', tags: [], glossary: ['to live on (e.g. a salary)', 'to make a living'] },
    ],
  }),
}, { url: 'https://www.youtube.com/watch?v=sample', title: 'Sample video' }, `<img src="${SAMPLE_IMAGE}" alt="">`);

const noteTypeSelect = byId('note-type', HTMLSelectElement);
const noteTypeStatus = byId('note-type-status', HTMLElement);
const noteFields = byId('note-fields', HTMLElement);
const fieldRows = byId('field-rows', HTMLElement);
const previewRows = byId('preview-rows', HTMLElement);
const builtinOption = el('option', { value: '', textContent: 'Minerr (built-in)' });
let noteType = await getNoteType();

// The values of a user template are the user's HTML, so the preview shows them as Anki does.
function showPreview(fields: Record<string, string>): void {
  previewRows.replaceChildren(...Object.entries(fields).map(([name, template]) => {
    const value = renderField(template, SAMPLE);
    return el('tr', {}, el('th', { scope: 'row', textContent: name }),
      value ? el('td', { innerHTML: value }) : el('td', { className: 'empty', textContent: 'Empty' }));
  }));
}

function showNoteType(): void {
  noteTypeSelect.value = noteType.kind === 'custom' ? noteType.model : '';
  knownField.value = wordField(noteType);
  noteFields.hidden = noteType.kind === 'builtin';
  if (noteType.kind === 'builtin') return;
  const { model } = noteType;
  const fields = { ...noteType.fields };
  fieldRows.replaceChildren(...Object.entries(fields).flatMap(([name, template], i) => {
    const input = el('input', { type: 'text', id: `field-${i}`, value: template, spellcheck: false });
    const error = el('p', { className: 'error', id: `field-${i}-error` });
    input.setAttribute('aria-describedby', error.id);
    input.oninput = async () => {
      fields[name] = input.value;
      const unknown = unknownMarkers(input.value);
      error.textContent = unknown.length ? `Unknown marker ${unknown.join(', ')}. Use a marker from the list above.` : '';
      input.setAttribute('aria-invalid', String(unknown.length > 0));
      showPreview(fields);
      if (Object.values(fields).some(value => unknownMarkers(value).length)) {
        showStatus(noteTypeStatus, 'Not saved. Correct the unknown markers.', 'error');
        return;
      }
      noteType = { kind: 'custom', model, fields: { ...fields } };
      await setNoteType(noteType);
      knownField.value = wordField(noteType);
      showStatus(noteTypeStatus, 'Saved', 'ok');
    };
    return [el('label', { htmlFor: input.id, textContent: name }), input, error];
  }));
  showPreview(fields);
}

// The list keeps the selected note type when Anki is closed. The Minerr note type is the built-in choice.
async function showModels(): Promise<void> {
  const selected = noteType.kind === 'custom' ? [noteType.model] : [];
  let models: string[] = [];
  try {
    models = await call({ type: 'ankiModels' });
  } catch {
    showStatus(noteTypeStatus, 'Open Anki, then click Check connection to see your note types.');
  }
  const names = [...new Set([...models, ...selected])].filter(name => name !== NOTE_TYPE.modelName);
  noteTypeSelect.replaceChildren(builtinOption, ...names.map(name => el('option', { value: name, textContent: name })));
  if (noteType.kind === 'custom' && models.includes(noteType.model)) await syncFields(noteType.model, noteType.fields);
  showNoteType();
}

// Follows the fields of the note type in Anki: a new field gets a suggested marker, and a removed field drops out.
async function syncFields(model: string, fields: Record<string, string>): Promise<void> {
  const names = await call({ type: 'ankiModelFields', model });
  const suggested = suggestFields(names);
  const synced = Object.fromEntries(names.map(name => [name, fields[name] ?? suggested[name] ?? '']));
  if (JSON.stringify(synced) === JSON.stringify(fields)) return;
  noteType = { kind: 'custom', model, fields: synced };
  await setNoteType(noteType);
  showStatus(noteTypeStatus, 'Updated the fields from Anki', 'ok');
}

noteTypeSelect.onchange = async () => {
  const model = noteTypeSelect.value;
  try {
    const next: NoteType = model ? { kind: 'custom', model, fields: suggestFields(await call({ type: 'ankiModelFields', model })) } : BUILTIN;
    await setNoteType(next);
    noteType = next;
    showStatus(noteTypeStatus, 'Saved', 'ok');
  } catch (error) {
    showStatus(noteTypeStatus, messageOf(error), 'error');
  }
  showNoteType();
};

const ankiCheck = byId('anki-check', HTMLButtonElement);
ankiCheck.onclick = async () => {
  const status = byId('anki-status', HTMLElement);
  ankiCheck.disabled = true;
  showStatus(status, 'Checking…');
  try {
    showStatus(status, `Connected (AnkiConnect version ${await call({ type: 'ankiVersion' })})`, 'ok');
    showStatus(noteTypeStatus, '');
    await showModels();
  } catch (error) {
    showStatus(status, messageOf(error), 'error');
  } finally {
    ankiCheck.disabled = false;
  }
};
byId('known-import', HTMLButtonElement).onclick = async () => {
  const status = byId('known-status', HTMLElement);
  showStatus(status, 'Asking Anki…');
  try {
    const count = await call({ type: 'importKnown', query: knownQuery.value, field: knownField.value });
    showStatus(status, `Marked ${count} words as known.`, 'ok');
  } catch (error) {
    showStatus(status, messageOf(error), 'error');
  }
};

document.head.append(el('style', { textContent: WORD_CSS + TAG_CSS }));
byId('legend', HTMLElement).prepend(...Object.values(STATUSES).map(({ hotkey, label, className, color }) => el('tr', {},
  el('td', {}, el('kbd', { textContent: hotkey })),
  el('td', {}, swatch(color), `Mark as ${label.toLowerCase()}`),
  el('td', { className: 'sample' }, el('span', { className: `ml-word ${className}`, textContent: '単語' })))));

const statusCounts = byId('status-counts', HTMLElement);
const statusMessage = byId('status-message', HTMLElement);
const statusFileInput = byId('status-file', HTMLInputElement);

async function showCounts(): Promise<void> {
  const statuses = Object.values(await getAllStatuses());
  statusCounts.replaceChildren(...STATUS_NAMES.filter(status => status !== 'unknown').map(status => el('li', {},
    swatch(STATUSES[status].color), STATUSES[status].label,
    el('strong', { textContent: String(statuses.filter(value => value === status).length) }))));
}
onStatusChange(showCounts);

const localDate = (date: Date) => [date.getFullYear(), date.getMonth() + 1, date.getDate()].map(n => String(n).padStart(2, '0')).join('-');

byId('status-export', HTMLButtonElement).onclick = async () => {
  const now = new Date();
  const file = statusFile(await getAllStatuses(), now);
  const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }));
  el('a', { href: url, download: `minerr-statuses-${localDate(now)}.json` }).click();
  // The download reads the blob after this task, so the URL lives a little longer.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  showStatus(statusMessage, `Exported ${Object.keys(file.words).length} words.`, 'ok');
};

statusFileInput.onchange = async () => {
  const file = statusFileInput.files?.[0];
  if (!file) return;
  try {
    const { added, changed, unchanged } = await importStatuses(parseStatusFile(await file.text()));
    showStatus(statusMessage, `Imported ${added + changed + unchanged} words: ${added} added, ${changed} changed, ${unchanged} unchanged.`, 'ok');
  } catch (error) {
    showStatus(statusMessage, `Import failed. ${messageOf(error)} No status changed.`, 'error');
  } finally {
    statusFileInput.value = '';
  }
};

async function bindRadios<T extends string>(name: string, { get, set, isValue }: Setting<T>): Promise<void> {
  const value = await get();
  for (const input of document.querySelectorAll(`input[name="${name}"]`)) {
    if (!(input instanceof HTMLInputElement)) continue;
    input.checked = input.value === value;
    input.onchange = () => {
      if (isValue(input.value)) set(input.value);
    };
  }
}

const pitchBox = byId('pitch-colors', HTMLInputElement);
pitchBox.checked = await pitchColors.get();
pitchBox.onchange = () => pitchColors.set(pitchBox.checked);
byId('pitch-legend', HTMLElement).append(...Object.values(PITCH).map(({ label, color }) => el('li', {}, swatch(color), label)));

await Promise.all([bindRadios('hoverMode', hoverMode), bindRadios('theme', theme), bindRadios('furigana', furiganaMode)]);

await Promise.all([showDictionaries(), showModels(), showCounts()]);
