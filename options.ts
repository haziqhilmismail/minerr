import { DEFAULT_DECK, DEFAULT_KNOWN_FIELD, DEFAULT_KNOWN_QUERY, getDeck } from './src/anki.ts';
import { deleteDictionary, importDictionary, listDictionaries } from './src/db.ts';
import { byId } from './src/dom.ts';
import { call, messageOf } from './src/rpc.ts';
import { STATUSES, WORD_CSS } from './src/status.ts';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function showStatus(node: HTMLElement, text: string, kind = ''): void {
  node.textContent = text;
  node.className = `status ${kind}`;
}

const dictList = byId('dict-list', HTMLElement);

async function showDictionaries(): Promise<void> {
  const dictionaries = await listDictionaries();
  const items = dictionaries.map(({ title, count, tags }) => {
    const remove = el('button', { type: 'button', className: 'delete', textContent: 'Delete' });
    remove.onclick = async () => {
      if (!confirm(`Delete the dictionary "${title}"?`)) return;
      remove.disabled = true;
      await deleteDictionary(title);
      await showDictionaries();
    };
    // An import from before tags were stored has no tags flag.
    const meta = count === null ? 'Import not finished. Import it again.'
      : tags ? `${count} terms` : `${count} terms. Import again to show tags.`;
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
    const { title, count } = await importDictionary(await file.arrayBuffer(), ({ bank, banks, count }) => {
      progress.max = banks;
      progress.value = bank;
      showStatus(status, `Importing ${file.name}: bank ${bank} of ${banks}, ${count} terms`);
    });
    showStatus(status, `Imported ${title}: ${count} terms`, 'ok');
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

const ankiCheck = byId('anki-check', HTMLButtonElement);
ankiCheck.onclick = async () => {
  const status = byId('anki-status', HTMLElement);
  ankiCheck.disabled = true;
  showStatus(status, 'Checking…');
  try {
    showStatus(status, `Connected (AnkiConnect version ${await call({ type: 'ankiVersion' })})`, 'ok');
  } catch (error) {
    showStatus(status, messageOf(error), 'error');
  } finally {
    ankiCheck.disabled = false;
  }
};

const knownQuery = byId('known-query', HTMLInputElement);
const knownField = byId('known-field', HTMLInputElement);
knownQuery.value = DEFAULT_KNOWN_QUERY;
knownField.value = DEFAULT_KNOWN_FIELD;
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

document.head.append(el('style', { textContent: WORD_CSS }));
byId('legend', HTMLElement).prepend(...Object.values(STATUSES).map(({ hotkey, label, className, color }) => {
  const swatch = el('span', { className: 'swatch' });
  swatch.style.background = color;
  return el('tr', {},
    el('td', {}, el('kbd', { textContent: hotkey })),
    el('td', {}, swatch, `Mark as ${label.toLowerCase()}`),
    el('td', { className: 'sample' }, el('span', { className: `ml-word ${className}`, textContent: '単語' })));
}));

await showDictionaries();
