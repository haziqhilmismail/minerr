// Lists every word with a stored status: search, filter, sort, change statuses in bulk, and add pasted words.
import { byId } from '../src/shared/dom.ts';
import { call, messageOf } from '../src/shared/rpc.ts';
import {
  getAllStatuses, importStatuses, isStatus, isStoredStatus, mergeStatuses, onStatusChange, setStatuses, type Status, STATUS_NAMES, STATUSES, type StoredStatus,
} from '../src/status/status.ts';
import { applyTheme } from '../src/shared/theme.ts';
import { type Filter, keysOf, listWords, wordsOfLines } from '../src/status/wordlist.ts';

applyTheme();

// One page of rows keeps the table fast with tens of thousands of words.
const PAGE_SIZE = 200;

const search = byId('search', HTMLInputElement);
const filter = byId('filter', HTMLSelectElement);
const sort = byId('sort', HTMLSelectElement);
const rows = byId('rows', HTMLElement);
const selectAll = byId('select-all', HTMLInputElement);
const selection = byId('selection', HTMLElement);
const range = byId('range', HTMLElement);
const previous = byId('previous', HTMLButtonElement);
const next = byId('next', HTMLButtonElement);
const pasteText = byId('paste-text', HTMLTextAreaElement);
const pasteStatus = byId('paste-status', HTMLSelectElement);
const preview = byId('paste-preview', HTMLElement);
const save = byId('paste-save', HTMLButtonElement);

const isFilter = (value: unknown): value is Filter => value === 'all' || isStoredStatus(value);

const words = new Map(Object.entries(await getAllStatuses()));
// The selection is a part of the listed words; a new search or filter clears it.
const selected = new Set<string>();
let listed: string[] = [];
let page = 0;

function cell(className: string, content: Node | string): HTMLTableCellElement {
  const td = Object.assign(document.createElement('td'), { className });
  td.append(content);
  return td;
}

function statusSelect(lemma: string, status: Status): HTMLSelectElement {
  const select = Object.assign(document.createElement('select'), { ariaLabel: `Status of ${lemma}` });
  for (const name of STATUS_NAMES) select.append(new Option(STATUSES[name].label, name, false, name === status));
  select.addEventListener('change', () => {
    if (isStatus(select.value)) setStatuses([{ key: lemma }], select.value);
  });
  return select;
}

function row(lemma: string): HTMLTableRowElement {
  const check = Object.assign(document.createElement('input'), { type: 'checkbox', checked: selected.has(lemma), ariaLabel: `Select ${lemma}` });
  check.addEventListener('change', () => {
    if (check.checked) selected.add(lemma);
    else selected.delete(lemma);
    showSelection();
  });
  const tr = document.createElement('tr');
  tr.append(cell('check', check), cell('word', lemma), cell('', statusSelect(lemma, words.get(lemma) ?? 'unknown')));
  return tr;
}

const bulkButtons = STATUS_NAMES.map(status => {
  const { label, color } = STATUSES[status];
  const dot = Object.assign(document.createElement('span'), { className: 'dot' });
  dot.style.background = color;
  const button = document.createElement('button');
  button.append(dot, status === 'unknown' ? 'Unknown (remove)' : label);
  button.addEventListener('click', async () => {
    const lemmas = [...selected];
    if (status === 'unknown' && !confirm(`Set ${lemmas.length} words to unknown? They go out of the list.`)) return;
    selected.clear();
    await setStatuses(lemmas.map(key => ({ key })), status);
    // No storage change event comes when no status changed, and the selection still needs to clear.
    render();
  });
  return button;
});
byId('bulk', HTMLElement).append(...bulkButtons);

function showSelection(): void {
  selection.textContent = `${selected.size} selected`;
  selectAll.checked = listed.length > 0 && selected.size === listed.length;
  for (const button of bulkButtons) button.disabled = selected.size === 0;
}

function render(): void {
  const start = page * PAGE_SIZE;
  const shown = listed.slice(start, start + PAGE_SIZE);
  rows.replaceChildren(...shown.map(row));
  range.textContent = shown.length ? `${start + 1}–${start + shown.length} of ${listed.length}` : words.size ? 'No word matches.' : 'No words yet.';
  previous.disabled = page === 0;
  next.disabled = start + PAGE_SIZE >= listed.length;
  showSelection();
}

function list(): void {
  listed = listWords(words, { search: search.value, filter: isFilter(filter.value) ? filter.value : 'all', sort: sort.value === 'status' ? 'status' : 'word' });
  const inList = new Set(listed);
  for (const lemma of selected) if (!inList.has(lemma)) selected.delete(lemma);
  page = Math.min(page, Math.max(0, Math.ceil(listed.length / PAGE_SIZE) - 1));
  render();
}

function newQuery(): void {
  selected.clear();
  page = 0;
  list();
}

search.addEventListener('input', newQuery);
filter.addEventListener('change', newQuery);
sort.addEventListener('change', list);
selectAll.addEventListener('change', () => {
  for (const lemma of listed) {
    if (selectAll.checked) selected.add(lemma);
    else selected.delete(lemma);
  }
  render();
});
previous.addEventListener('click', () => { page--; render(); });
next.addEventListener('click', () => { page++; render(); });

onStatusChange(changed => {
  for (const [lemma, status] of changed) {
    if (status === 'unknown') words.delete(lemma);
    else words.set(lemma, status);
  }
  list();
});

// The words of the last preview, which Save applies.
let pending: Record<string, StoredStatus> | null = null;

function showPreview(text: string, className = ''): void {
  preview.textContent = text;
  preview.className = className;
}

function discardPreview(): void {
  pending = null;
  save.disabled = true;
}

async function pastedWords(): Promise<string[]> {
  const text = pasteText.value;
  const kind = document.querySelector<HTMLInputElement>('input[name="pasteKind"]:checked')?.value;
  if (kind === 'text') return keysOf(await call({ type: 'parse', texts: text.split('\n') }));
  const words = wordsOfLines(text);
  return [...new Set(await call({ type: 'wordKeys', words }))];
}

byId('paste-preview-button', HTMLButtonElement).addEventListener('click', async () => {
  discardPreview();
  const status = isStoredStatus(pasteStatus.value) ? pasteStatus.value : 'known';
  let found: string[];
  try {
    found = await pastedWords();
  } catch (error) {
    showPreview(messageOf(error), 'error');
    return;
  }
  if (!found.length) {
    showPreview('No words found. Paste one word on each line, or select Japanese text.', 'error');
    return;
  }
  pending = Object.fromEntries(found.map(lemma => [lemma, status]));
  const { added, changed, unchanged } = mergeStatuses(Object.fromEntries(words), pending).counts;
  const sample = found.slice(0, 12).join('、') + (found.length > 12 ? '…' : '');
  showPreview(`${found.length} words: ${added} new, ${changed} with a different status, ${unchanged} with this status. ${sample}. Click Save to set them to ${STATUSES[status].label.toLowerCase()}.`);
  save.disabled = false;
});

save.addEventListener('click', async () => {
  if (!pending) return;
  const chosen = pending;
  discardPreview();
  const { added, changed } = await importStatuses(chosen);
  showPreview(`Saved. ${added} new words, ${changed} changed.`, 'ok');
});

for (const input of [pasteText, pasteStatus, ...document.querySelectorAll('input[name="pasteKind"]')]) input.addEventListener('input', discardPreview);

list();
