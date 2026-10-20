import { DEFAULT_DECK, DEFAULT_KNOWN_FIELD, DEFAULT_KNOWN_QUERY } from './src/anki.js';
import { deleteDictionary, importDictionary, listDictionaries } from './src/db.js';
import { call } from './src/rpc.js';
import { STATUSES, WORD_CSS } from './src/status.js';

const $ = id => document.getElementById(id);

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function showStatus(node, text, kind = '') {
  node.textContent = text;
  node.className = `status ${kind}`;
}

async function showDictionaries() {
  const dictionaries = await listDictionaries();
  const items = dictionaries.map(({ title, count }) => {
    const remove = el('button', { type: 'button', className: 'delete', textContent: 'Delete' });
    remove.onclick = async () => {
      if (!confirm(`Delete the dictionary "${title}"?`)) return;
      remove.disabled = true;
      await deleteDictionary(title);
      await showDictionaries();
    };
    const meta = count === null ? 'Import not finished. Import it again.' : `${count} terms`;
    return el('li', { className: count === null ? 'unfinished' : '' },
      el('div', {}, el('span', { className: 'name', textContent: title }), el('span', { className: 'meta', textContent: meta })),
      remove);
  });
  $('dict-list').replaceChildren(...(items.length ? items
    : [el('li', { className: 'empty', textContent: 'No dictionary installed. Import one to see definitions in the popup.' })]));
}

const fileInput = $('dict-file');
const progress = $('dict-progress');

async function importFile(file) {
  const status = $('dict-status');
  fileInput.disabled = true;
  $('dict-list').hidden = true;
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
    showStatus(status, `Import failed: ${error.message}`, 'error');
  } finally {
    fileInput.disabled = false;
    fileInput.value = '';
    progress.hidden = true;
    await showDictionaries();
    $('dict-list').hidden = false;
  }
}

fileInput.onchange = () => fileInput.files[0] && importFile(fileInput.files[0]);
const drop = $('dict-drop');
drop.ondragover = event => {
  event.preventDefault();
  drop.classList.add('over');
};
drop.ondragleave = () => drop.classList.remove('over');
drop.ondrop = event => {
  event.preventDefault();
  drop.classList.remove('over');
  const [file] = event.dataTransfer.files;
  if (file && !fileInput.disabled) importFile(file);
};

const { deck } = await chrome.storage.local.get({ deck: DEFAULT_DECK });
$('deck').value = deck;
$('deck').oninput = () => showStatus($('deck-saved'), '');
$('deck').onchange = async () => {
  const value = $('deck').value.trim() || DEFAULT_DECK;
  $('deck').value = value;
  await chrome.storage.local.set({ deck: value });
  showStatus($('deck-saved'), 'Saved', 'ok');
};

$('anki-check').onclick = async () => {
  const button = $('anki-check');
  const status = $('anki-status');
  button.disabled = true;
  showStatus(status, 'Checking…');
  try {
    showStatus(status, `Connected (AnkiConnect version ${await call({ type: 'ankiVersion' })})`, 'ok');
  } catch (error) {
    showStatus(status, error.message, 'error');
  } finally {
    button.disabled = false;
  }
};

$('known-query').value = DEFAULT_KNOWN_QUERY;
$('known-field').value = DEFAULT_KNOWN_FIELD;
$('known-import').onclick = async () => {
  const status = $('known-status');
  showStatus(status, 'Asking Anki…');
  try {
    const count = await call({ type: 'importKnown', query: $('known-query').value, field: $('known-field').value });
    showStatus(status, `Marked ${count} words as known.`, 'ok');
  } catch (error) {
    showStatus(status, error.message, 'error');
  }
};

document.head.append(el('style', { textContent: WORD_CSS }));
$('legend').prepend(...Object.values(STATUSES).map(({ hotkey, label, className, color }) => {
  const swatch = el('span', { className: 'swatch' });
  swatch.style.background = color;
  return el('tr', {},
    el('td', {}, el('kbd', { textContent: hotkey })),
    el('td', {}, swatch, `Mark as ${label.toLowerCase()}`),
    el('td', { className: 'sample' }, el('span', { className: `ml-word ${className}`, textContent: '単語' })));
}));

await showDictionaries();
