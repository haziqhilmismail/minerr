import { type CardFields, definitionHtml, escapeHtml } from './anki.ts';
import { blockOf } from './dom.ts';
import { type HoverMode, hoverDelay, hoverMode } from './hover.ts';
import {
  addLabel, createBox, isPopup, type Layer, markStatus, mount, position, render, setPopupVisible, showMessage, type View,
} from './popup-view.ts';
import { call, messageOf } from './rpc.ts';
import { sentenceAround } from './sentence.ts';
import { installSentenceHover, setPopupWord } from './sentence-hover.ts';
import { watchActive } from './site.ts';
import { getStatuses, onStatusChange, setStatus, STATUS_NAMES, STATUSES } from './status.ts';
import { isEditable } from './chord.ts';
import './keys.ts';

// The sentence around the word inside its nearest block ancestor, with the word in <b>.
function sentenceHtml(span: HTMLElement): string {
  const block = blockOf(span.parentElement ?? span);
  const range = document.createRange();
  range.selectNodeContents(block);
  range.setEndBefore(span);
  const before = range.toString();
  range.selectNodeContents(block);
  range.setStartAfter(span);
  const { start, word, end } = sentenceAround(before, span.textContent ?? '', range.toString());
  return `${escapeHtml(start)}<b>${escapeHtml(word)}</b>${escapeHtml(end)}`;
}

const box = createBox();
let current: Layer | null = null;
// The word under the mouse, so that Shift can open it, and the timer of a popup that waits for the mouse to stop.
let hovered: HTMLElement | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

// Keeps the word highlighted while the mouse is on the popup, so the user sees which word it belongs to.
function markActive(span: HTMLElement | null): void {
  document.querySelector('.ml-word[data-ml-active]')?.removeAttribute('data-ml-active');
  span?.setAttribute('data-ml-active', '');
  setPopupWord(span);
}

let opening: View | null = null;

// Opens the popup of a word span (a .ml-word with data-ml-lemma). The subtitle code calls it for keys that pick a word.
export async function openWord(span: HTMLElement): Promise<void> {
  const lemma = span.dataset.mlLemma;
  if (lemma === undefined) return;
  const count = document.querySelectorAll(`.ml-word[data-ml-lemma="${CSS.escape(lemma)}"]`).length;
  const view: View = { span, lemma, status: 'unknown', groups: [], count };
  opening = view;
  try {
    [view.groups, view.status] = await Promise.all([
      call({ type: 'lookup', lemma }),
      getStatuses([lemma]).then(statuses => statuses.get(lemma) ?? 'unknown'),
    ]);
  } catch (error) {
    console.warn('minerr lookup failed', error);
  }
  if (opening !== view) return;
  mount();
  current = render(box, view, { addCard, close });
  box.hidden = false;
  position(box, span);
  markActive(span);
}

function close(): void {
  clearTimeout(timer);
  opening = null;
  current = null;
  box.hidden = true;
  markActive(null);
}

const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));

async function addCard(): Promise<void> {
  const layer = current;
  if (!layer || layer.addButton.disabled) return;
  const { view, addButton: button } = layer;
  const card: CardFields = {
    word: view.lemma,
    reading: view.groups[0]?.reading ?? '',
    sentence: sentenceHtml(view.span),
    definition: definitionHtml(view.groups[0]),
  };
  button.disabled = true;
  button.replaceChildren('Adding to Anki…');
  setPopupVisible(false);
  await nextFrame();
  await nextFrame();
  try {
    await call({ type: 'addCard', card });
    if (current === layer) showMessage(layer, 'Added to Anki.');
  } catch (error) {
    if (current === layer) showMessage(layer, messageOf(error), true);
  } finally {
    setPopupVisible(true);
    button.disabled = false;
    button.replaceChildren(...addLabel());
  }
}

const HOTKEYS: Record<string, () => void> = {
  ...Object.fromEntries(STATUS_NAMES.map(status => [STATUSES[status].hotkey, () => {
    if (current) setStatus(current.view.lemma, status);
  }])),
  a: addCard,
  Escape: close,
};

installSentenceHover();

let enabled = true;
watchActive(value => {
  enabled = value;
  if (!enabled) close();
});

let mode: HoverMode = 'hover';
hoverMode.watch(value => { mode = value; });

function consider(span: HTMLElement, shift: boolean, buttonDown: boolean): void {
  clearTimeout(timer);
  if (!enabled || span === current?.view.span) return;
  const delay = hoverDelay({
    mode,
    shift,
    unknownWord: span.classList.contains(STATUSES.unknown.className),
    popupOpen: current !== null,
    textSelected: !(getSelection()?.isCollapsed ?? true),
    buttonDown,
  });
  // A YouTube subtitle line can change during the wait, so open only a word that is still on the page.
  if (delay !== null) timer = setTimeout(() => { if (span.isConnected) openWord(span); }, delay);
}

document.addEventListener('mouseover', event => {
  const span = event.target instanceof Element ? event.target.closest<HTMLElement>('.ml-word') : null;
  if (span === hovered) return;
  hovered = span;
  if (span) consider(span, event.shiftKey, event.buttons !== 0);
  else clearTimeout(timer);
});

// The mouse left the window, so no mouseover tells us it left the word.
document.addEventListener('mouseout', event => {
  if (event.relatedTarget) return;
  hovered = null;
  clearTimeout(timer);
});

document.addEventListener('mousedown', event => {
  clearTimeout(timer);
  if (current && !isPopup(event.target) && !(event.target instanceof Element && event.target.closest('.ml-word'))) close();
});

// Capture, like the hotkeys below, so a page that stops keydown cannot block Shift.
window.addEventListener('keydown', event => {
  if (event.key === 'Shift' && !event.repeat && hovered) consider(hovered, true, false);
}, true);

// Capture on window so page shortcuts (YouTube uses 1-4 to seek) do not also fire.
window.addEventListener('keydown', event => {
  if (!current || event.ctrlKey || event.metaKey || event.altKey || isEditable(event.target)) return;
  const action = HOTKEYS[event.key.length === 1 ? event.key.toLowerCase() : event.key];
  if (!action) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  action();
}, true);

onStatusChange(changed => {
  const status = current && changed.get(current.view.lemma);
  if (current && status) markStatus(current, status);
});
