import {
  BUILTIN, DEFAULT_DECK, DEFAULT_KNOWN_QUERY, definitionHtml, getDeck, getNoteType, LAPIS, markerValues, NOTE_TYPE, type NoteType,
  renderField, setNoteType, suggestFields, unknownMarkers, wordField,
} from '../src/anki/anki.ts';
import { deleteDictionary, importDictionary, listDictionaries } from '../src/dictionary/db.ts';
import { byId } from '../src/shared/dom.ts';
import { furiganaMode } from '../src/page-text/furigana.ts';
import { hoverMode } from '../src/popup/hover.ts';
import { LAPIS_MODEL } from '../src/anki/lapis.ts';
import { PITCH } from '../src/dictionary/meta.ts';
import { pitchColors } from '../src/page-text/pitch-colors.ts';
import { sentenceHighlight } from '../src/page-text/sentence-hover.ts';
import { iPlusOne, type Setting, wordAudioEnabled, wordJoins } from '../src/shared/settings.ts';
import { call, messageOf } from '../src/shared/rpc.ts';
import {
  forgetStatusMove, getAllStatuses, importStatuses, moveStatusKeys, onStatusChange, parseStatusFile, STATUS_NAMES, STATUSES, statusFile, WORD_CSS,
} from '../src/status/status.ts';
import { TAG_CSS } from '../src/dictionary/tags.ts';
import { applyTheme, theme } from '../src/shared/theme.ts';
import { bindVideoOptions } from '../src/video/videooptions.ts';

applyTheme();

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

const swatch = (color: string) => {
  const dot = el('span', { className: 'dot' });
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
  const items = dictionaries.map(({ title, count, tags, meta: metaCount, entries }) => {
    const remove = el('button', { type: 'button', className: 'delete', textContent: 'Delete' });
    remove.onclick = async () => {
      if (!confirm(`Delete the dictionary "${title}"?`)) return;
      remove.disabled = true;
      await forgetStatusMove();
      await deleteDictionary(title);
      await showDictionaries();
    };
    // An import from before tags were stored has no tags flag, and one from before entries were counted has no entries count.
    const noEntries = count !== null && count > 0 && entries === undefined;
    const meta = count === null ? 'Import not finished. Import it again.'
      : !tags ? `${count} terms. Import again to show tags.`
      : noEntries ? `${count} terms${metaText(metaCount)}. Import again so that the spellings of a word share one status.`
      : `${count} terms${metaText(metaCount)}`;
    return el('li', { className: count === null || !tags || noEntries ? 'warn' : '' },
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
    await forgetStatusMove();
    const { title, count, meta } = await importDictionary(await file.arrayBuffer(), ({ bank, banks, count }) => {
      progress.max = banks;
      progress.value = bank;
      showStatus(status, `Importing ${file.name}: bank ${bank} of ${banks}, ${count} terms`);
    });
    // If this fails, the next service worker start moves them (background.ts).
    await moveStatusKeys(await listDictionaries(), words => call({ type: 'wordKeys', words }))
      .catch(error => console.warn('minerr could not move the statuses to their keys', error));
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

function joinRow(word: string): HTMLLIElement {
  const remove = el('button', { type: 'button', className: 'delete', textContent: 'Remove' });
  remove.onclick = async () => wordJoins.set((await wordJoins.get()).filter(other => other !== word));
  return el('li', {}, el('div', {}, el('span', { className: 'name', textContent: word })), remove);
}
const noJoins = el('li', { className: 'empty', textContent: 'No word overrides. Select a word on a page and press Alt+J to add one.' });
wordJoins.watch(joins => byId('word-joins', HTMLElement).replaceChildren(...(joins.length ? joins.map(joinRow) : [noJoins])));

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
  entry: null,
  selection: '',
}, { url: 'https://www.youtube.com/watch?v=sample', title: 'Sample video' }, { image: `<img src="${SAMPLE_IMAGE}" alt="">`, audio: '', wordaudio: '' });

const noteTypeSelect = byId('note-type', HTMLSelectElement);
const noteTypeStatus = byId('note-type-status', HTMLElement);
const noteFields = byId('note-fields', HTMLElement);
const fieldRows = byId('field-rows', HTMLElement);
const previewRows = byId('preview-rows', HTMLElement);
const lapisInstall = byId('lapis-install', HTMLElement);
// The values of the list: the kind of a preset, or custom: and the name of a note type of the user.
const PRESETS = [el('option', { value: 'lapis', textContent: 'Lapis' }), el('option', { value: 'builtin', textContent: 'Minerr (classic)' })];
const CUSTOM = 'custom:';
let noteType = await getNoteType();
// The note types in Anki, or null before Anki answers.
let models: string[] | null = null;

// The values of a user template are the user's HTML, so the preview shows them as Anki does.
function showPreview(fields: Record<string, string>): void {
  previewRows.replaceChildren(...Object.entries(fields).map(([name, template]) => {
    const value = renderField(template, SAMPLE);
    return el('tr', {}, el('th', { scope: 'row', textContent: name }),
      value ? el('td', { innerHTML: value }) : el('td', { className: 'empty', textContent: 'Empty' }));
  }));
}

function showNoteType(): void {
  noteTypeSelect.value = noteType.kind === 'custom' ? CUSTOM + noteType.model : noteType.kind;
  knownField.value = wordField(noteType);
  lapisInstall.hidden = !(noteType.kind === 'lapis' && models && !models.includes(LAPIS_MODEL));
  noteFields.hidden = noteType.kind !== 'custom';
  if (noteType.kind !== 'custom') return;
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

// The list keeps the selected note type when Anki is closed. Lapis and the Minerr note type are the presets.
async function showModels(): Promise<void> {
  const selected = noteType.kind === 'custom' ? [noteType.model] : [];
  try {
    models = await call({ type: 'ankiModels' });
  } catch {
    showStatus(noteTypeStatus, 'Open Anki, then click Check connection to see your note types.');
  }
  const names = [...new Set([...(models ?? []).filter(name => name !== NOTE_TYPE.modelName && name !== LAPIS_MODEL), ...selected])];
  noteTypeSelect.replaceChildren(...PRESETS, ...names.map(name => el('option', { value: CUSTOM + name, textContent: name })));
  if (noteType.kind === 'custom' && models?.includes(noteType.model)) await syncFields(noteType.model, noteType.fields);
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
  const { value } = noteTypeSelect;
  const model = value.startsWith(CUSTOM) ? value.slice(CUSTOM.length) : null;
  try {
    const next: NoteType = model === null ? (value === 'builtin' ? BUILTIN : LAPIS)
      : { kind: 'custom', model, fields: suggestFields(await call({ type: 'ankiModelFields', model })) };
    await setNoteType(next);
    noteType = next;
    showStatus(noteTypeStatus, 'Saved', 'ok');
  } catch (error) {
    showStatus(noteTypeStatus, messageOf(error), 'error');
  }
  showNoteType();
};

const lapisButton = byId('lapis-install-button', HTMLButtonElement);
lapisButton.onclick = async () => {
  lapisButton.disabled = true;
  showStatus(noteTypeStatus, 'Installing Lapis…');
  try {
    const result = await call({ type: 'ankiInstallLapis' });
    await showModels();
    showStatus(noteTypeStatus, result, 'ok');
  } catch (error) {
    showStatus(noteTypeStatus, messageOf(error), 'error');
  } finally {
    lapisButton.disabled = false;
  }
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

// The browser shortcuts (manifest.json commands), as Chrome has them now. The user can change them on the Chrome shortcuts page.
async function showShortcuts(): Promise<void> {
  const rows = (await chrome.commands.getAll()).map(({ name, shortcut, description }) => el('tr', {},
    el('td', {}, el('kbd', { textContent: shortcut || 'Not set' })),
    // Chrome gives the command of the toolbar button no description.
    el('td', { textContent: name === '_execute_action' ? 'Open the Minerr toolbar menu' : description ?? '' }), el('td')));
  byId('browser-keys', HTMLElement).replaceChildren(...rows);
}
showShortcuts();
document.addEventListener('visibilitychange', () => { if (!document.hidden) showShortcuts(); });
// An extension page cannot open a chrome:// link, but it can open a tab with that URL.
byId('shortcuts', HTMLButtonElement).onclick = () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });

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

async function bindCheckbox(id: string, { get, set, onChange }: Setting<boolean>): Promise<void> {
  const box = byId(id, HTMLInputElement);
  box.checked = await get();
  box.onchange = () => set(box.checked);
  onChange(value => { box.checked = value; });
}
await Promise.all([bindCheckbox('pitch-colors', pitchColors), bindCheckbox('sentence-highlight', sentenceHighlight), bindCheckbox('iplusone', iPlusOne),
  bindCheckbox('word-audio', wordAudioEnabled)]);
byId('pitch-legend', HTMLElement).append(...Object.values(PITCH).map(({ label, color }) => el('li', {}, swatch(color), label)));

await Promise.all([bindRadios('hoverMode', hoverMode), bindRadios('theme', theme), bindRadios('furigana', furiganaMode), bindVideoOptions(bindRadios)]);

await Promise.all([showDictionaries(), showModels(), showCounts()]);
