import { type CardFields, definitionHtml, escapeHtml, type NoteDraft } from './anki.ts';
import { cardForm } from './cardform.ts';
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
import { sentenceText, wordRange } from './sentence-text.ts';
import { setPopupWord } from './sentence-hover.ts';
import { type Active, VIDEO, watchActive } from './site.ts';
import { getStatuses, onStatusChange, setStatus, type Status, STATUSES } from './status.ts';
import { parseWords, recolor, sameWord, wordFragment, wordOf, wordParts } from './words.ts';

// A word in a popup opens a popup over it with Shift + hover, up to this many popups.
const MAX_LAYERS = 4;

// The text of a subtitle line: the line of the overlay, or a row of the subtitle list.
const SUBTITLE_LINE = '.minerr-subs-line, .minerr-lines .text';

// A word in a subtitle line gets the whole line as its sentence, as in asbplayer and Migaku: no guess where the sentence ends.
function subtitleHtml(line: Element, word: Range): string {
  const side = (start: boolean) => {
    const range = new Range();
    range.selectNodeContents(line);
    if (start) range.setEnd(word.startContainer, word.startOffset);
    else range.setStart(word.endContainer, word.endOffset);
    return escapeHtml(range.toString().replace(/\s*\n\s*/g, ' '));
  };
  return `${side(true)}<b>${escapeHtml(word.toString())}</b>${side(false)}`;
}

// The sentence around the anchor, with the word in <b>. A word with parts is one word.
function sentenceHtml(anchor: Anchor): string {
  const parts = anchor.kind === 'word' ? wordParts(anchor.span) : [];
  const range = anchor.kind === 'word' ? wordRange(parts[0] ?? anchor.span, parts.at(-1) ?? anchor.span) : anchor.range;
  const line = anchor.kind === 'word' ? anchor.span.closest(SUBTITLE_LINE) : null;
  if (line) return subtitleHtml(line, range);
  const { text, from, to } = sentenceText(range);
  const before = text.slice(0, from);
  const inside = text.slice(from, to);
  const after = text.slice(to);
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
// The popup with the open card form (E). While it is open, no other popup opens, and Esc closes the form.
let editing: Layer | null = null;

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

// False if no card form is open.
function stopEdit(): boolean {
  if (!editing) return false;
  editing.box.classList.remove('editing');
  editing.box.querySelector('form')?.remove();
  editing = null;
  return true;
}

function closeFrom(depth: number): void {
  if (editing && layers.indexOf(editing) >= depth) stopEdit();
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
    [view.groups, view.status] = await Promise.all([lookup, getStatuses([word]).then(statuses => statuses.get(word.key) ?? 'unknown')]);
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
  layers.push(render(box, view, { addCard, editCard, close: () => close() }));
  position(box, anchorRect(anchor));
  markActive();
  const definitions = box.querySelector('.definitions');
  if (definitions && depth + 1 < MAX_LAYERS) wrapWords(definitions).catch(error => console.warn('minerr parse failed', error));
}

// Opens the popup of a word span (a .ml-word with data-ml-lemma). The subtitle code calls it for keys that pick a word.
export async function openWord(span: HTMLElement): Promise<void> {
  const { mlLemma: lemma, mlHeadword: text, mlHeadwordReading: reading = '' } = span.dataset;
  const depth = depthOf(span);
  // An open card form keeps its popup: a play-mode pause would otherwise throw away the edits.
  if (lemma === undefined || depth >= MAX_LAYERS || editing) return;
  const headword = text === undefined ? undefined : { text, reading };
  await open({ kind: 'word', span }, { lemma, word: wordOf(span), headword }, depth, call({ type: 'lookup', lemma }));
}

// Alt+S: looks up the longest dictionary word at the start of the text selection on the page. False if no text is selected.
function lookupSelection(): boolean {
  const selection = getSelection();
  const text = selection?.toString().trimStart() ?? '';
  if (!selection?.rangeCount || !text) return false;
  const range = selection.getRangeAt(0).cloneRange();
  const common = range.commonAncestorContainer;
  // Page text that is off gives no popup; the text of the subtitle overlay does.
  if (active !== 'on' && !(common instanceof Element ? common : common.parentElement)?.closest(VIDEO)) return false;
  call({ type: 'lookupText', text }).then(found => {
    if (!found) {
      toast(`No dictionary entry for ${text.slice(0, 10)}.`);
      return;
    }
    const { lemma, entry } = found;
    const word = entry ?? { key: lemma };
    const headword = entry ? { text: entry.headword, reading: entry.reading } : undefined;
    // A status key changes the words of a selection first, so the selection goes and the key changes the popup word.
    selection.removeAllRanges();
    open({ kind: 'text', range, text: text.slice(0, found.length) }, { lemma, word, headword }, 0, Promise.resolve(found.entries));
  }).catch(error => toast(messageOf(error)));
  return true;
}

const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));

function cardOf(view: View): CardFields {
  return {
    word: view.lemma,
    reading: view.groups[0]?.reading ?? '',
    sentence: sentenceHtml(view.anchor),
    definition: definitionHtml(view.groups[0]),
    entry: view.groups[0] ?? null,
    selection: view.anchor.kind === 'text' ? view.anchor.range.toString().trim() : '',
  };
}

// Runs work with the add button busy, and shows its error in the popup. hide: the popup hides first, for the screenshot.
async function busy<T>(layer: Layer, label: string, hide: boolean, work: () => Promise<T>): Promise<T | null> {
  const button = layer.addButton;
  button.disabled = true;
  button.replaceChildren(label);
  if (hide) {
    setPopupVisible(false);
    await nextFrame();
    await nextFrame();
  }
  try {
    return await work();
  } catch (error) {
    if (layers.includes(layer)) showMessage(layer, messageOf(error), true);
    return null;
  } finally {
    setPopupVisible(true);
    button.disabled = false;
    button.replaceChildren(...addLabel());
  }
}

async function send(layer: Layer, card: CardFields, hide: boolean, draft?: NoteDraft): Promise<void> {
  const added = await busy(layer, 'Adding to Anki…', hide, () => call({ type: 'addCard', card, word: layer.view.word, ...(draft ? { draft } : {}) }));
  if (added !== null && layers.includes(layer)) showMessage(layer, 'Added to Anki.');
}

async function addCard(): Promise<void> {
  const layer = top();
  if (layer && !layer.addButton.disabled) await send(layer, cardOf(layer.view), true);
}

// Opens the popup of a word span and adds its card, as the + of a line in the subtitle sidebar does.
export async function addWordCard(span: HTMLElement): Promise<void> {
  await openWord(span);
  if (spanOf(layers[0]) === span) await addCard();
}

// E: the card form, with the fields that the service worker made for the note type, the screenshot, and the audio.
async function editCard(): Promise<void> {
  const layer = top();
  if (!layer || layer.addButton.disabled) return;
  const card = cardOf(layer.view);
  const draft = await busy(layer, 'Making the card…', true, () => call({ type: 'cardDraft', card }));
  if (!draft || !layers.includes(layer) || editing) return;
  editing = layer;
  const form = cardForm(draft, { send: edited => { stopEdit(); send(layer, card, false, edited); }, cancel: stopEdit });
  layer.box.classList.add('editing');
  layer.box.append(form);
  form.querySelector('textarea')?.focus();
}

let active: Active = 'off';
watchActive(value => {
  active = value;
  if (active !== 'on') close(0);
});

let mode: HoverMode = 'hover';
hoverMode.watch(value => { mode = value; });

function consider(span: HTMLElement, shift: boolean, buttonDown: boolean): void {
  clearTimeout(timer);
  const depth = depthOf(span);
  if (active === 'off' || editing || depth >= MAX_LAYERS || sameWord(span, spanOf(layers[depth]))) return;
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
  // A click outside does not close a popup with a card form: only Send, Cancel, or Esc do.
  else if (editing) return;
  else if (layers.length && !isPopup(event.target) && !wordAt(event)) close(0);
});

// Capture, like the keys, so a page that stops keydown cannot block Shift.
window.addEventListener('keydown', event => {
  if (event.key === 'Shift' && !event.repeat && hovered) consider(hovered, true, false);
}, true);

export const isPopupOpen = (): boolean => layers.length > 0;

installKeys({
  isOpen: isPopupOpen,
  isEditing: () => editing !== null,
  setStatus: (status: Status) => {
    const layer = top();
    if (layer) setStatus(layer.view.word, status);
  },
  addCard,
  editCard,
  close: () => { if (!stopEdit()) close(); },
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
