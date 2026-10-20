import { type CardFields, definitionHtml, escapeHtml } from './anki.ts';
import { blockOf } from './dom.ts';
import { JAPANESE } from './group.ts';
import { type HoverMode, hoverDelay, hoverMode } from './hover.ts';
import { installKeys } from './keys.ts';
import type { Entry } from './meta.ts';
import {
  addLabel, type Anchor, anchorRect, createBox, hideBox, isPopup, type Layer, markStatus, mount, position, render,
  setPopupVisible, showBox, showMessage, toast, type View,
} from './popup-view.ts';
import { call, messageOf } from './rpc.ts';
import { sentenceAround } from './sentence.ts';
import { setPopupWord } from './sentence-hover.ts';
import { watchActive } from './site.ts';
import { getStatuses, onStatusChange, setStatus, type Status, STATUSES, statusIn } from './status.ts';
import { parseWords, recolor, RUBY_TEXT, sameWord, wordFragment, wordOf, wordParts } from './words.ts';

// A word in a popup opens a popup over it with Shift + hover, up to this many popups.
const MAX_LAYERS = 4;

const elementOf = (node: Node) => (node instanceof Element ? node : node.parentElement ?? document.body);

// Where the boundary point (container, offset) falls in the text of node: 0 if the point is before node, its length if after.
function cutAt(node: Text, container: Node, offset: number): number {
  if (node === container) return offset;
  const point = new Range();
  point.setStart(container, offset);
  return point.comparePoint(node, 0) > 0 ? 0 : node.length;
}

// The sentence around the anchor inside its nearest block ancestor, with the word in <b>. A word with parts is one word,
// and ruby annotation text is not part of the sentence.
function sentenceHtml(anchor: Anchor): string {
  const range = new Range();
  if (anchor.kind === 'word') {
    const parts = wordParts(anchor.span);
    range.setStartBefore(parts[0] ?? anchor.span);
    range.setEndAfter(parts.at(-1) ?? anchor.span);
  } else {
    range.setStart(anchor.range.startContainer, anchor.range.startOffset);
    range.setEnd(anchor.range.endContainer, anchor.range.endOffset);
  }
  let before = '';
  let inside = '';
  let after = '';
  const walker = document.createTreeWalker(blockOf(elementOf(range.startContainer)), NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!(node instanceof Text) || node.parentElement?.closest(RUBY_TEXT)) continue;
    const start = cutAt(node, range.startContainer, range.startOffset);
    const end = Math.max(start, cutAt(node, range.endContainer, range.endOffset));
    before += node.data.slice(0, start);
    inside += node.data.slice(start, end);
    after += node.data.slice(end);
  }
  // A selection can start with white space, and the word can be shorter than the selection.
  const word = anchor.kind === 'word' ? inside : anchor.text;
  const skip = Math.max(0, inside.indexOf(word));
  const { start, end } = sentenceAround(before + inside.slice(0, skip), word, inside.slice(skip + word.length) + after);
  return `${escapeHtml(start)}<b>${escapeHtml(word)}</b>${escapeHtml(end)}`;
}

// The open popups, from the one over the page to the one on top. Each depth keeps its box.
const layers: Layer[] = [];
const boxes: HTMLDivElement[] = [];
// The word under the mouse, so that Shift can open it, and the timer of a popup that waits for the mouse to stop.
let hovered: HTMLElement | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
// The popup whose lookup runs; a newer open or a close makes it stale.
let opening: View | null = null;

const top = () => layers.at(-1) ?? null;
const spanOf = (layer: Layer | undefined) => (layer?.view.anchor.kind === 'word' ? layer.view.anchor.span : null);

// The depth of the popup that a word span opens: 0 for a page word, one more than its popup for a word in a popup.
const depthOf = (span: HTMLElement) => layers.findIndex(layer => layer.box.contains(span)) + 1;

// Keeps the word of each popup highlighted while the mouse is on a popup, so the user sees which word it belongs to.
function markActive(): void {
  const spans = layers.flatMap(layer => { const span = spanOf(layer); return span ? wordParts(span) : []; });
  for (const root of [document, ...boxes]) {
    for (const span of root.querySelectorAll<HTMLElement>('.ml-word[data-ml-active]')) if (!spans.includes(span)) span.removeAttribute('data-ml-active');
  }
  for (const span of spans) span.setAttribute('data-ml-active', '');
  setPopupWord(spanOf(layers[0]));
}

function closeFrom(depth: number): void {
  for (const layer of layers.splice(depth)) hideBox(layer.box);
  markActive();
}

// Closes the top popup, or every popup from depth; a hover or lookup that still waits does not open one after it.
function close(depth = Math.max(0, layers.length - 1)): void {
  clearTimeout(timer);
  opening = null;
  closeFrom(depth);
}

// Wraps the Japanese text of the definitions in word spans, so Shift + hover can open a popup over a word.
async function wrapWords(root: Element): Promise<void> {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node instanceof Text && JAPANESE.test(node.data) && !node.parentElement?.closest('.tag, .dict, .ml-word')) nodes.push(node);
  }
  if (!nodes.length) return;
  const { parsed, statuses } = await parseWords(nodes.map(node => node.data));
  nodes.forEach((node, i) => {
    const segments = parsed[i];
    if (segments && node.isConnected) node.replaceWith(wordFragment(segments, statuses, false));
  });
}

// The number of words on the page with the status key.
const countOf = (key: string) => [...document.querySelectorAll<HTMLElement>('.ml-word:not([data-ml-cont])')].filter(span => wordOf(span).key === key).length;

async function open(anchor: Anchor, { lemma, word, headword }: Pick<View, 'lemma' | 'word' | 'headword'>, depth: number, lookup: Promise<Entry[]>): Promise<void> {
  const view: View = { anchor, lemma, word, headword, status: 'unknown', groups: [], count: countOf(word.key) };
  opening = view;
  try {
    [view.groups, view.status] = await Promise.all([lookup, getStatuses([word]).then(statuses => statusIn(statuses, word))]);
  } catch (error) {
    console.warn('minerr lookup failed', error);
  }
  // The popup of a word in a popup needs that popup to be open still.
  if (opening !== view || depth > layers.length) return;
  opening = null;
  closeFrom(depth);
  const box = (boxes[depth] ??= createBox());
  mount();
  showBox(box);
  layers.push(render(box, view, { addCard, close: () => close() }));
  position(box, anchorRect(anchor));
  markActive();
  const definitions = box.querySelector('.definitions');
  if (definitions && depth + 1 < MAX_LAYERS) wrapWords(definitions).catch(error => console.warn('minerr parse failed', error));
}

// Opens the popup of a word span (a .ml-word with data-ml-lemma). The subtitle code calls it for keys that pick a word.
export async function openWord(span: HTMLElement): Promise<void> {
  const { mlLemma: lemma, mlHeadword: text, mlHeadwordReading: reading = '' } = span.dataset;
  const depth = depthOf(span);
  if (lemma === undefined || depth >= MAX_LAYERS) return;
  const headword = text === undefined ? undefined : { text, reading };
  await open({ kind: 'word', span }, { lemma, word: wordOf(span), headword }, depth, call({ type: 'lookup', lemma }));
}

// Alt+S: looks up the longest dictionary word at the start of the text selection on the page. False if no text is selected.
function lookupSelection(): boolean {
  const selection = getSelection();
  const text = selection?.toString().trimStart() ?? '';
  if (!selection?.rangeCount || !text) return false;
  const range = selection.getRangeAt(0).cloneRange();
  call({ type: 'lookupText', text }).then(found => {
    if (!found) {
      toast(`No dictionary entry for ${text.slice(0, 10)}.`);
      return;
    }
    const { lemma, entry } = found;
    const word = entry ?? { key: lemma };
    const headword = entry ? { text: entry.headword, reading: entry.reading } : undefined;
    open({ kind: 'text', range, text: text.slice(0, found.length) }, { lemma, word, headword }, 0, Promise.resolve(found.entries));
  }).catch(error => toast(messageOf(error)));
  return true;
}

const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));

async function addCard(): Promise<void> {
  const layer = top();
  if (!layer || layer.addButton.disabled) return;
  const { view, addButton: button } = layer;
  const card: CardFields = {
    word: view.lemma,
    reading: view.groups[0]?.reading ?? '',
    sentence: sentenceHtml(view.anchor),
    definition: definitionHtml(view.groups[0]),
  };
  button.disabled = true;
  button.replaceChildren('Adding to Anki…');
  setPopupVisible(false);
  await nextFrame();
  await nextFrame();
  try {
    await call({ type: 'addCard', card, word: view.word });
    if (layers.includes(layer)) showMessage(layer, 'Added to Anki.');
  } catch (error) {
    if (layers.includes(layer)) showMessage(layer, messageOf(error), true);
  } finally {
    setPopupVisible(true);
    button.disabled = false;
    button.replaceChildren(...addLabel());
  }
}

let enabled = true;
watchActive(value => {
  enabled = value;
  if (!enabled) close(0);
});

let mode: HoverMode = 'hover';
hoverMode.watch(value => { mode = value; });

function consider(span: HTMLElement, shift: boolean, buttonDown: boolean): void {
  clearTimeout(timer);
  const depth = depthOf(span);
  if (!enabled || depth >= MAX_LAYERS || sameWord(span, spanOf(layers[depth]))) return;
  const delay = hoverDelay({
    // A word in a popup opens a popup only with Shift, so the mouse can cross the definitions.
    mode: depth > 0 ? 'shift' : mode,
    shift,
    unknownWord: span.classList.contains(STATUSES.unknown.className),
    popupOpen: layers.length > 0,
    textSelected: !(getSelection()?.isCollapsed ?? true),
    buttonDown,
  });
  // A YouTube subtitle line can change during the wait, so open only a word that is still on the page.
  if (delay !== null) timer = setTimeout(() => { if (span.isConnected) openWord(span); }, delay);
}

// composedPath()[0] is the element under the mouse also inside the shadow root of the popup.
const wordAt = (event: Event) => {
  const [target] = event.composedPath();
  return target instanceof Element ? target.closest<HTMLElement>('.ml-word') : null;
};

// mousemove too: Chrome can skip the mouseover of a word in a popup box that opened under the mouse path.
for (const type of ['mouseover', 'mousemove'] as const) {
  document.addEventListener(type, event => {
    const span = wordAt(event);
    if (span === hovered) return;
    hovered = span;
    if (span) consider(span, event.shiftKey, event.buttons !== 0);
    else clearTimeout(timer);
  });
}

// The mouse left the window, so no mouseover tells us it left the word.
document.addEventListener('mouseout', event => {
  if (event.relatedTarget) return;
  hovered = null;
  clearTimeout(timer);
});

// A click in a popup closes the popups over it; a click outside the popups and the page words closes them all.
document.addEventListener('mousedown', event => {
  clearTimeout(timer);
  const path = event.composedPath();
  const inside = layers.findIndex(layer => path.includes(layer.box));
  if (inside >= 0) closeFrom(inside + 1);
  else if (layers.length && !isPopup(event.target) && !wordAt(event)) close(0);
});

// Capture, like the keys, so a page that stops keydown cannot block Shift.
window.addEventListener('keydown', event => {
  if (event.key === 'Shift' && !event.repeat && hovered) consider(hovered, true, false);
}, true);

installKeys({
  isOpen: () => layers.length > 0,
  setStatus: (status: Status) => {
    const layer = top();
    if (layer) setStatus(layer.view.word, status);
  },
  addCard,
  close: () => close(),
  word: () => spanOf(layers[0]),
  openWord,
  lookupSelection,
});

onStatusChange(changed => {
  for (const layer of layers) {
    const status = changed.get(layer.view.word.key);
    if (status) markStatus(layer, status);
  }
  for (const box of boxes) recolor(box, changed);
});
