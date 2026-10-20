// Shows the text of an .epub, .txt, .srt, or .vtt file, or pasted text, with Minerr words, the popup, and the i+1 highlight.
// Content scripts do not run on extension pages, so this page loads those modules itself, and src/stats.ts for the toolbar popup.
import './src/page.ts';
import './src/popup.ts';
import './src/iplusone.ts';
import './src/stats.ts';
import { isPosition, pageMove, positionKey, type TextChapter, textChapters, textParagraphs, turn, type Viewport } from './src/book.ts';
import { parseSubtitles } from './src/captions.ts';
import { byId } from './src/dom.ts';
import { type Book, type Chapter, readEpub } from './src/epub.ts';
import { messageOf } from './src/rpc.ts';
import { setting } from './src/settings.ts';
import { applyTheme } from './src/theme.ts';

applyTheme();

const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
const verticalText = setting('readerVertical', isBoolean, false);
const autoPaste = setting('readerAutoPaste', isBoolean, false);
const CLIPBOARD: chrome.permissions.Permissions = { permissions: ['clipboardRead'] };
const SAVE_MS = 300;

// The start screen, a file with the chapter on screen, or the pasted texts in the order of the paste.
type View =
  | { kind: 'start' }
  | { kind: 'book'; key: string; book: Book; chapter: number }
  | { kind: 'paste'; entries: string[] };

const start = byId('start', HTMLElement);
const text = byId('text', HTMLElement);
const article = byId('article', HTMLElement);
const title = byId('title', HTMLElement);
const status = byId('status', HTMLElement);
const chapterChoice = byId('chapter-choice', HTMLElement);
const chapters = byId('chapters', HTMLSelectElement);
const autoChoice = byId('auto-choice', HTMLElement);
const autoInput = byId('auto-paste', HTMLInputElement);
const clearButton = byId('clear', HTMLButtonElement);
const verticalButton = byId('vertical', HTMLButtonElement);
const fileInput = byId('file', HTMLInputElement);

let view: View = { kind: 'start' };

const isVertical = () => text.classList.contains('vertical');

// Vertical text scrolls to the left: Chrome gives scrollLeft 0 at the start and negative values after it.
function viewport(): Viewport {
  return isVertical()
    ? { offset: -text.scrollLeft, size: text.clientWidth, total: text.scrollWidth }
    : { offset: text.scrollTop, size: text.clientHeight, total: text.scrollHeight };
}

function scrollToOffset(offset: number): void {
  if (isVertical()) text.scrollLeft = -offset;
  else text.scrollTop = offset;
}

function progress(): number {
  const { offset, size, total } = viewport();
  return total > size ? offset / (total - size) : 0;
}

function scrollToProgress(fraction: number): void {
  const { size, total } = viewport();
  scrollToOffset(fraction * Math.max(0, total - size));
}

const showStatus = (message: string, className = '') => {
  status.textContent = message;
  status.className = className;
};

function paragraphs(lines: string[]): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (const line of lines) fragment.append(Object.assign(document.createElement('p'), { textContent: line }));
  return fragment;
}

const textBook = (name: string, parts: TextChapter[]): Book =>
  ({ title: name, chapters: parts.map((part): Chapter => ({ title: part.title, content: paragraphs(part.paragraphs) })) });

function render(): void {
  start.hidden = view.kind !== 'start';
  text.hidden = view.kind === 'start';
  chapterChoice.hidden = view.kind !== 'book' || view.book.chapters.length < 2;
  autoChoice.hidden = view.kind !== 'paste';
  clearButton.hidden = view.kind !== 'paste';
  // The title is an attribute that CSS shows, so page.ts does not make words of it.
  title.dataset.title = view.kind === 'book' ? view.book.title : view.kind === 'paste' ? 'Pasted text' : 'Reader';
  document.title = `${title.dataset.title} - Minerr`;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function savePosition(): void {
  clearTimeout(saveTimer);
  if (view.kind !== 'book') return;
  const { key, chapter } = view;
  saveTimer = setTimeout(() => chrome.storage.local.set({ [key]: { chapter, progress: progress() } }), SAVE_MS);
}

// page.ts parses the copy on screen, so a chapter shows the current statuses each time it opens.
function showChapter(index: number, fraction: number): void {
  if (view.kind !== 'book') return;
  const chapter = view.book.chapters[index];
  if (!chapter) return;
  view.chapter = index;
  chapters.value = String(index);
  article.replaceChildren(chapter.content.cloneNode(true));
  scrollToProgress(fraction);
  savePosition();
}

async function readBook(file: File): Promise<Book> {
  if (/\.epub$/i.test(file.name)) return readEpub(await file.arrayBuffer(), file.name);
  const content = await file.text();
  const lines = /\.(srt|vtt)$/i.test(file.name) ? parseSubtitles(content).map(segment => segment.text) : textParagraphs(content);
  if (!lines.length) throw new Error('The file has no text.');
  return textBook(file.name, textChapters(file.name, lines));
}

async function openFile(file: File): Promise<void> {
  showStatus(`Opening ${file.name}…`);
  let book: Book;
  try {
    book = await readBook(file);
  } catch (error) {
    showStatus(`Minerr cannot read ${file.name}. ${messageOf(error)}`, 'error');
    return;
  }
  const key = positionKey(file.name, file.size);
  const saved = (await chrome.storage.local.get(key))[key];
  const position = isPosition(saved) && saved.chapter < book.chapters.length ? saved : { chapter: 0, progress: 0 };
  view = { kind: 'book', key, book, chapter: position.chapter };
  chapters.replaceChildren(...book.chapters.map((chapter, i) => new Option(chapter.title, String(i))));
  render();
  showChapter(position.chapter, position.progress);
  showStatus('');
  text.focus();
}

function entry(pasted: string): HTMLElement {
  const section = Object.assign(document.createElement('section'), { className: 'entry' });
  section.append(paragraphs(textParagraphs(pasted)));
  return section;
}

function showPaste(): Extract<View, { kind: 'paste' }> {
  if (view.kind === 'paste') return view;
  const paste: View = { kind: 'paste', entries: [] };
  view = paste;
  article.replaceChildren();
  render();
  showStatus('Press Ctrl+V to read the text in the clipboard.');
  return paste;
}

// The last text from the clipboard, so a focus without a new copy adds nothing.
let lastPasted = '';
function addPasted(pasted: string): void {
  lastPasted = pasted;
  if (!pasted.trim()) return;
  showPaste().entries.push(pasted);
  article.append(entry(pasted));
  showStatus('');
  scrollToProgress(1);
}

const isEditable = (target: EventTarget | null) => target instanceof HTMLElement
  && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

// Capture on window, as the popup keys do; the popup does not use these keys.
window.addEventListener('keydown', event => {
  if (view.kind === 'start' || event.ctrlKey || event.metaKey || event.altKey || isEditable(event.target)) return;
  const move = pageMove(event.key, event.shiftKey, isVertical());
  if (!move) return;
  event.preventDefault();
  const next = turn(move, viewport());
  if (next.kind === 'scroll') scrollToOffset(next.to);
  else if (view.kind === 'book') showChapter(view.chapter + next.step, next.step === 1 ? 0 : 1);
}, true);

// A mouse wheel scrolls up and down; in vertical text, the lines go from right to left.
text.addEventListener('wheel', event => {
  if (!isVertical() || event.shiftKey || !event.deltaY) return;
  event.preventDefault();
  text.scrollLeft -= event.deltaY;
}, { passive: false });

text.addEventListener('scroll', savePosition);
chapters.addEventListener('change', () => showChapter(Number(chapters.value), 0));

verticalText.watch(vertical => {
  const fraction = progress();
  text.classList.toggle('vertical', vertical);
  verticalButton.setAttribute('aria-pressed', String(vertical));
  scrollToProgress(fraction);
});
verticalButton.addEventListener('click', () => verticalText.set(!isVertical()));

byId('open', HTMLButtonElement).addEventListener('click', () => fileInput.click());
byId('choose', HTMLButtonElement).addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  const [file] = fileInput.files ?? [];
  if (file) await openFile(file);
  fileInput.value = '';
});
byId('paste-mode', HTMLButtonElement).addEventListener('click', showPaste);
clearButton.addEventListener('click', () => {
  view = { kind: 'start' };
  showPaste();
});

document.addEventListener('paste', event => {
  if (isEditable(event.target) || view.kind === 'book') return;
  event.preventDefault();
  addPasted(event.clipboardData?.getData('text/plain') ?? '');
});

// The optional clipboardRead permission lets the page read the clipboard without a question each time.
async function readClipboard(): Promise<void> {
  if (view.kind !== 'paste' || !autoInput.checked || !(await chrome.permissions.contains(CLIPBOARD))) return;
  const pasted = await navigator.clipboard.readText().catch(() => '');
  if (pasted !== lastPasted) addPasted(pasted);
}

autoInput.checked = await autoPaste.get();
autoInput.addEventListener('change', async () => {
  const on = autoInput.checked && await chrome.permissions.request(CLIPBOARD);
  autoInput.checked = on;
  await autoPaste.set(on);
  readClipboard();
});
window.addEventListener('focus', readClipboard);

document.addEventListener('dragover', event => {
  event.preventDefault();
  document.body.classList.add('dragging');
});
document.addEventListener('dragleave', event => {
  if (!event.relatedTarget) document.body.classList.remove('dragging');
});
document.addEventListener('drop', event => {
  event.preventDefault();
  document.body.classList.remove('dragging');
  const [file] = event.dataTransfer?.files ?? [];
  if (file) openFile(file);
});

if (new URLSearchParams(location.search).has('paste')) {
  showPaste();
  readClipboard();
} else {
  render();
}
