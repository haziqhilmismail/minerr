// The subtitle sidebar: a card for each timed line of the video, in the side panel page (pages/sidepanel.ts), which Chrome
// shows next to the tab of the video. The tab sends the lines and the current line over a port (sidebar-port.ts); the
// actions of a card go back to the tab. The cards are page text (VIDEO in src/page-text/site.ts), so page.ts underlines
// their words and the popup works on them. pages/sidepanel.html holds the CSS.
import type { SubtitleSegment } from '../captions.ts';
import { getBookmarks, onBookmarksChange, toggleBookmark } from './bookmarks.ts';
import { choices, FILTER_NAMES, LINE_FILTERS, type LineFilter, type LineWord, shownLines, targetWord } from './sidebar-filter.ts';
import { createSelection, type Outcome } from './sidebar-select.ts';
import { addWordCard, closePopups } from '../../popup/popup.ts';
import { STATUSES, statusOf } from '../../status/status.ts';
import { wordOf } from '../../text/word-spans.ts';

const ADD_LABEL = 'Add a card for a word of the line';
// Where subtitles with times come from. src/video/video.ts shows it in its hint for the keys that need times.
export const TIMES_SOURCE = 'Generate them with WhisperX, or start the Minerr server for the YouTube subtitles.';
const NO_TIMES = `The subtitle sidebar needs subtitles with times. ${TIMES_SOURCE}`;
const NO_VIDEO = 'This tab has no video with subtitles. Open a video, then press G on it.';

const minutes = (time: number) => `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, '0')}`;

// What the cards ask of the video, by the index of the line. The card of + goes through popup.ts, as a card from the popup does.
export interface LineActions {
  seek: (index: number) => void;
  // Plays the line once, then pauses at its end.
  play: (index: number) => void;
  // Pauses the video at the start of the line, for the screenshot of a card.
  still: (index: number) => Promise<void>;
  toast: (text: string) => void;
}

// The timed lines of a video. id names the video, for its bookmarks.
export interface LineSet {
  id: string | null;
  segments: SubtitleSegment[];
}

export interface LineList {
  root: HTMLElement;
  // null: the tab has no video. Without segments, the list shows that it needs subtitles with times.
  setLines: (lines: LineSet | null) => void;
  setCurrent: (index: number) => void;
  // The user played the video: the list follows it again, from the current line.
  resumeFollow: () => void;
  // The index of the line of a row that holds node, or null.
  rowIndex: (node: Node) => number | null;
}

// The card of a line and the parts that change with the statuses of its words and its bookmark.
interface Card {
  index: number;
  row: HTMLLIElement;
  text: HTMLParagraphElement;
  add: HTMLButtonElement;
  mark: HTMLButtonElement;
  check: HTMLButtonElement;
}

// A word of a line: its first span, and the text of all its parts.
interface SpanWord extends LineWord {
  span: HTMLElement;
  text: string;
}

const button = (className: string, text: string, label: string) =>
  Object.assign(document.createElement('button'), { type: 'button', className, textContent: text, title: label, ariaLabel: label });

// The words of a line in text order. A word in parts (src/text/word-spans.ts) is one word; a span without a status is no word yet.
function lineWords(text: HTMLElement): SpanWord[] {
  const words: SpanWord[] = [];
  for (const span of text.querySelectorAll<HTMLElement>('.ml-word')) {
    const last = words.at(-1);
    if (span.dataset.mlCont !== undefined && last) {
      last.text += span.textContent ?? '';
      continue;
    }
    const status = statusOf(span);
    if (status) words.push({ span, text: span.textContent ?? '', key: wordOf(span).key, status });
  }
  return words;
}

export function createLineList(actions: LineActions): LineList {
  const root = Object.assign(document.createElement('section'), { className: 'minerr-lines', ariaLabel: 'Subtitle sidebar' });
  const count = document.createElement('span');
  const paused = Object.assign(document.createElement('span'), { className: 'paused', textContent: 'Scroll paused' });
  const head = Object.assign(document.createElement('div'), { className: 'minerr-lines-head' });
  head.append(Object.assign(document.createElement('strong'), { textContent: 'Subtitles' }), count, paused);
  const select = Object.assign(document.createElement('select'), { ariaLabel: 'Filter the lines' });
  const options = new Map(FILTER_NAMES.map(name => [name, new Option(LINE_FILTERS[name].label, name)]));
  select.append(...options.values());
  const bar = Object.assign(document.createElement('div'), { className: 'minerr-lines-bar' });
  bar.append(select);
  const list = document.createElement('ol');
  const empty = Object.assign(document.createElement('div'), { className: 'minerr-lines-empty', hidden: true });
  const emptyText = document.createElement('p');
  const clear = button('clear', 'Clear filter', 'Show all lines');
  empty.append(emptyText, clear);
  root.append(head, bar, empty, list);
  let filter: LineFilter = 'all';
  let current = -1;
  let cards: Card[] = [];
  const cardOf = new WeakMap<Element, Card>();
  let marks = new Set<number>();
  let lines: LineSet | null = null;
  const segments = () => lines?.segments ?? [];
  // The open chooser of a target word, in one card at a time.
  let pick: { card: Card; box: HTMLElement } | null = null;

  const setFilter = (name: LineFilter) => {
    filter = name;
    apply();
  };
  select.addEventListener('change', () => setFilter(FILTER_NAMES.find(name => name === select.value) ?? 'all'));
  clear.addEventListener('click', () => setFilter('all'));

  // A filter can depend on the other lines (the first line of a word), so every change applies the filter to all cards.
  // ponytail: O(lines) per changed frame; 1,500 lines take a few ms. Update only the changed cards if longer tracks lag.
  function apply(): void {
    const states = cards.map(card => ({ words: lineWords(card.text), marked: marks.has(segments()[card.index]?.start ?? -1) }));
    const shown = shownLines(states, filter);
    cards.forEach((card, index) => {
      const marked = states[index]?.marked ?? false;
      card.row.hidden = !shown[index];
      card.row.toggleAttribute('data-bookmark', marked);
      card.mark.setAttribute('aria-pressed', String(marked));
    });
    select.value = filter;
    options.get('bookmarks')?.replaceChildren(`${LINE_FILTERS.bookmarks.label} (${states.filter(line => line.marked).length})`);
    empty.hidden = shown.includes(true);
    emptyText.textContent = !lines ? NO_VIDEO : segments().length ? 'No line matches the filter.' : NO_TIMES;
    clear.hidden = !segments().length;
  }

  // A status change or the parse of page.ts changes the classes of the words, and so the filter.
  let pending = 0;
  new MutationObserver(() => {
    pending ||= requestAnimationFrame(() => {
      pending = 0;
      apply();
    });
  }).observe(list, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });

  function closePick(): void {
    if (!pick) return;
    if (pick.box.contains(document.activeElement)) pick.card.add.focus();
    pick.box.remove();
    pick = null;
  }

  // True when Anki has the card.
  async function addFor(card: Card, span: HTMLElement): Promise<boolean> {
    closePick();
    follow(card.index);
    await actions.still(card.index);
    return span.isConnected && addWordCard(span);
  }

  // Create N cards skips a line without exactly one unknown word: only the user can select its target word.
  async function addLine(index: number): Promise<Outcome> {
    const card = cards[index];
    const target = card && targetWord(lineWords(card.text));
    if (!card || !target) return 'skipped';
    const added = await addFor(card, target.span);
    // The popup would cover the progress in the footer. After an error it stays open, to show the cause.
    if (added) closePopups();
    return added ? 'added' : 'failed';
  }

  const selection = createSelection(root, addLine, selected => {
    for (const card of cards) {
      const on = selected.has(card.index);
      card.check.setAttribute('aria-pressed', String(on));
      card.check.textContent = on ? '✓' : '';
    }
  });

  // Inputs, not buttons, hold the words: page.ts does not parse an input, so the words of a chooser are no page text.
  function openPick(card: Card, words: SpanWord[]): void {
    closePick();
    const box = Object.assign(document.createElement('div'), { className: 'pick', role: 'group', ariaLabel: 'Select a target word' });
    box.style.setProperty('--unknown', STATUSES.unknown.color);
    box.append(Object.assign(document.createElement('span'), { textContent: 'Select a target word:' }));
    for (const word of words) {
      const choice = Object.assign(document.createElement('input'), { type: 'button', value: word.text, className: word.status,
        title: `Add a card for ${word.text} (${STATUSES[word.status].label})` });
      choice.addEventListener('click', () => addFor(card, word.span));
      box.append(choice);
    }
    const cancel = button('cancel', 'Cancel', 'Close the word list');
    cancel.addEventListener('click', closePick);
    box.append(cancel);
    box.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      closePick();
    });
    card.row.append(box);
    pick = { card, box };
    box.querySelector('input')?.focus();
  }

  // Exactly one unknown word gives its card at once. Else the user selects the target word, as in Migaku.
  function plus(card: Card): void {
    if (pick?.card === card) return closePick();
    const words = lineWords(card.text);
    const target = targetWord(words);
    if (target) {
      addFor(card, target.span);
      return;
    }
    if (!words.length) return actions.toast('The line has no words that Minerr knows yet.');
    openPick(card, choices(words));
  }

  function bookmark(index: number): void {
    const id = lines?.id;
    const segment = segments()[index];
    if (!id || !segment) return;
    toggleBookmark(id, segment.start).then(actions.toast);
  }

  function makeCard(segment: SubtitleSegment, index: number): Card {
    const card: Card = {
      index,
      row: document.createElement('li'),
      text: Object.assign(document.createElement('p'), { className: 'text', textContent: segment.text }),
      add: button('add', '+', ADD_LABEL),
      mark: button('mark', '★', 'Bookmark the line (B)'),
      check: button('check', '', 'Select the line'),
    };
    card.check.setAttribute('aria-pressed', 'false');
    card.check.addEventListener('click', () => selection.toggle(index));
    const play = button('play', '▶', 'Play the line');
    play.addEventListener('click', () => {
      follow(index);
      actions.play(index);
    });
    card.add.addEventListener('click', () => plus(card));
    card.mark.addEventListener('click', () => bookmark(index));
    const cardHead = Object.assign(document.createElement('div'), { className: 'card-head' });
    cardHead.append(card.check, Object.assign(document.createElement('time'), { textContent: minutes(segment.start) }), play, card.add, card.mark);
    card.row.append(cardHead, card.text);
    card.row.addEventListener('click', event => {
      if (event.target instanceof Element && event.target.closest('.ml-word, button, .pick')) return;
      follow(index);
      actions.seek(index);
    });
    cardOf.set(card.row, card);
    return card;
  }

  function build(): void {
    count.textContent = segments().length ? `${segments().length} lines` : '';
    bar.hidden = !segments().length;
    pick = null;
    cards = segments().map(makeCard);
    list.replaceChildren(...cards.map(card => card.row));
    selection.reset();
    current = -1;
    root.removeAttribute('data-scroll-paused');
    apply();
  }

  // The bookmarks of the video come from the storage, also after a change from the B key in the tab.
  function loadBookmarks(id: string | null): void {
    marks = new Set();
    if (!id) return;
    getBookmarks(id).then(stored => {
      if (lines?.id !== id) return;
      marks = stored;
      apply();
    });
  }
  onBookmarksChange((id, stored) => {
    if (lines?.id !== id) return;
    marks = stored;
    apply();
  });

  // scrollTop, not scrollIntoView, which also scrolls the page around the list.
  function center(index: number): void {
    const row = cards[index]?.row;
    if (row && !row.hidden) list.scrollTop = row.offsetTop - (list.clientHeight - row.offsetHeight) / 2;
  }

  // The list does not follow the video while the mouse is on it, or after the user scrolled it (data-scroll-paused).
  const isPaused = () => list.matches(':hover') || root.hasAttribute('data-scroll-paused');

  // A scroll of the user (wheel, scroll bar, keys, a click that is no seek) stops the follow until the video plays,
  // or until the user goes to a line. The mouse that leaves the panel does not scroll the list.
  function follow(index = current): void {
    root.removeAttribute('data-scroll-paused');
    center(index);
  }
  for (const type of ['wheel', 'pointerdown', 'keydown']) {
    list.addEventListener(type, () => root.setAttribute('data-scroll-paused', ''), { passive: true });
  }

  function setCurrent(index: number): void {
    if (index === current) return;
    cards[current]?.row.removeAttribute('aria-current');
    current = index;
    cards[index]?.row.setAttribute('aria-current', 'true');
    if (!isPaused()) center(index);
  }

  return {
    root,
    setLines: next => {
      const id = next?.id ?? null;
      if (id !== (lines?.id ?? null)) loadBookmarks(id);
      lines = next;
      build();
    },
    setCurrent,
    resumeFollow: () => follow(),
    rowIndex: node => {
      const row = node instanceof Element ? node.closest('li') : null;
      return (row && cardOf.get(row)?.index) ?? null;
    },
  };
}
