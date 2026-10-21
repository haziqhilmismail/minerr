// The subtitle sidebar: a card for each timed line of the video, in a panel as high as the window at its right side.
// The open panel sets data-minerr-side on the root, and the page gets narrower by the width of the panel, so the panel
// covers nothing. The root is positioned, so an absolute page (YouTube's ytd-app) also gets narrower. Fixed parts
// of a page (the YouTube masthead) need their own rule; src/video/youtube/youtube-overlay.ts has the YouTube rules.
// The cards are page text (VIDEO in src/page-text/site.ts), so page.ts underlines their words and the popup works on them.
import type { SubtitleSegment } from '../captions.ts';
import { statusOf } from '../../page-text/iplusone.ts';
import { choices, FILTER_NAMES, LINE_FILTERS, type LineFilter, type LineWord, shownLines, targetWord } from './sidebar-filter.ts';
import { createSelection, type Outcome, SELECT_CSS } from './sidebar-select.ts';
import { addWordCard, closePopups } from '../../popup/popup.ts';
import { STATUSES } from '../../status/status.ts';
import { applyTheme } from '../../shared/theme.ts';
import { themed } from '../../shared/design-tokens.ts';
import { wordOf } from '../../text/word-spans.ts';

// The list does not follow the video under the mouse, or after the user scrolled it (data-scroll-paused).
const PAUSED = ':hover, [data-scroll-paused]';

// The open panel, for the rules of the page around it.
export const SIDE_OPEN = ':root[data-minerr-side]:not([data-minerr-off])';

// The panel follows the Minerr theme (src/shared/theme.ts), not the colors of the page.
const STYLE = `
  :root { --minerr-side-width: min(400px, 40vw); }
  ${SIDE_OPEN} { position: relative !important; margin-right: var(--minerr-side-width) !important; }
  ${themed('.minerr-lines')}
  .minerr-lines {
    position: fixed; top: 0; right: 0; bottom: 0; z-index: 2147483646; width: var(--minerr-side-width);
    box-sizing: border-box; display: flex; flex-direction: column; overflow: hidden;
    border-left: 1px solid var(--separator); background: var(--bg); color: var(--text);
    font: var(--text-body)/1.45 var(--font-ui); text-align: left; -webkit-font-smoothing: antialiased;
  }
  .minerr-lines[hidden], :root[data-minerr-off] .minerr-lines, .minerr-lines li[hidden] { display: none; }
  .minerr-lines button, .minerr-lines select, .minerr-lines input { box-sizing: border-box; margin: 0; border: 0;
    border-radius: var(--radius-pill); background: transparent; color: inherit; font: 600 var(--text-footnote)/1.4 var(--font-ui); cursor: pointer;
    transition: background-color var(--fast) var(--ease), color var(--fast) var(--ease), opacity var(--fast) var(--ease), scale var(--fast) var(--ease); }
  .minerr-lines button:hover, .minerr-lines input:hover { background: var(--raised); }
  .minerr-lines button:active { scale: 0.95; }
  .minerr-lines select { width: 100%; min-height: 36px; padding: 0 var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-s);
    corner-shape: var(--corner); background: var(--field); font-size: var(--text-body); font-weight: 400; }
  .minerr-lines :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .minerr-lines-head { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-3) var(--space-3) var(--space-2) var(--space-4); }
  .minerr-lines-head strong { font: 700 var(--text-headline)/1.3 var(--font-display); }
  .minerr-lines-head span { color: var(--muted); font-size: var(--text-footnote); }
  .minerr-lines-head .paused { display: none; padding: 1px var(--space-2); border-radius: var(--radius-pill); background: var(--accent-soft);
    color: var(--accent); font-size: var(--text-caption); font-weight: 600; }
  .minerr-lines:is(${PAUSED}) .minerr-lines-head .paused { display: inline; }
  .minerr-lines-head button { width: 32px; height: 32px; margin-left: auto; padding: 0; border-radius: 50%; background: var(--raised);
    color: var(--muted); font-size: 18px; line-height: 1; }
  .minerr-lines-head button:hover { background: var(--line); }
  .minerr-lines :is(.minerr-lines-head, .card-head) button:hover { color: var(--text); }
  .minerr-lines-bar { padding: 0 var(--space-3) var(--space-3) var(--space-4); border-bottom: 1px solid var(--separator); }
  .minerr-lines ol { position: relative; flex: 1; min-height: 0; margin: 0; padding: var(--space-3); overflow: auto; overscroll-behavior: contain; list-style: none; }
  .minerr-lines li { margin: 0 0 var(--space-2); padding: var(--space-2) var(--space-2) var(--space-3) var(--space-4); border-radius: var(--radius-m);
    corner-shape: var(--corner); background: var(--card); box-shadow: var(--shadow-1); cursor: pointer;
    transition: box-shadow var(--fast) var(--ease), background-color var(--fast) var(--ease); }
  .minerr-lines li:hover { box-shadow: var(--shadow-2); }
  .minerr-lines li[aria-current="true"] { background: color-mix(in srgb, var(--accent-fill) 12%, var(--card));
    box-shadow: inset 0 0 0 1.5px var(--accent), var(--shadow-1); }
  .minerr-lines .card-head { display: flex; align-items: center; gap: 2px; }
  .minerr-lines time { margin-right: auto; color: var(--muted); font-size: var(--text-footnote); font-weight: 600; font-variant-numeric: tabular-nums; }
  .minerr-lines li[aria-current="true"] time { color: var(--accent); font-weight: 700; }
  .minerr-lines .card-head button { width: 32px; height: 32px; padding: 0; border-radius: 50%; color: var(--muted); font-size: 15px; line-height: 1; }
  .minerr-lines .card-head .add { color: var(--accent); font-size: var(--text-title2); font-weight: 400; }
  .minerr-lines li[data-bookmark] .mark { color: var(--star); }
  .minerr-lines .text { margin: 2px 0 0; font: 19px/1.65 var(--font-jp); white-space: pre-line; overflow-wrap: anywhere; }
  .minerr-lines .pick { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin-top: var(--space-2); padding-top: var(--space-3);
    border-top: 1px solid var(--separator); cursor: default; }
  .minerr-lines .pick span { flex-basis: 100%; color: var(--muted); font-size: var(--text-footnote); font-weight: 600; }
  .minerr-lines .pick input { min-height: 36px; padding: 0 var(--space-3); border: 1px solid var(--line); background: var(--field); font: 17px/1.5 var(--font-jp); }
  .minerr-lines .pick .unknown { border-color: ${STATUSES.unknown.color}; box-shadow: inset 0 0 0 1px ${STATUSES.unknown.color}; }
  .minerr-lines .pick button, .minerr-lines-empty button { min-height: 36px; padding: 0 var(--space-4); background: var(--raised); }
  .minerr-lines .pick button { color: var(--muted); }
  .minerr-lines .pick button:hover, .minerr-lines-empty button:hover { background: var(--accent-soft); color: var(--text); }
  .minerr-lines-empty { padding: var(--space-4); color: var(--muted); }
  .minerr-lines-empty p { margin: 0 0 var(--space-3); }
  ${SELECT_CSS}
`;

const ADD_LABEL = 'Add a card for a word of the line';
// Where subtitles with times come from. src/video/video.ts shows it in its hint for the keys that need times.
export const TIMES_SOURCE = 'Generate them with WhisperX, or start the Minerr server for the YouTube subtitles.';
const NO_TIMES = `The subtitle sidebar needs subtitles with times. ${TIMES_SOURCE}`;

// Minerr keeps the start times of the bookmarked lines of each video.
const bookmarkKey = (id: string) => `bm:${id}`;

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

export interface LineList {
  panel: HTMLElement;
  // id names the video, for its bookmarks. Without segments, the list shows that it needs subtitles with times.
  setLines: (segments: SubtitleSegment[], id: string | null) => void;
  // Bookmarks the line, or removes its bookmark.
  toggleBookmark: (index: number) => void;
  toggle: () => void;
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
  document.head.append(Object.assign(document.createElement('style'), { textContent: STYLE }));
  const panel = Object.assign(document.createElement('section'), { className: 'minerr-lines', hidden: true, ariaLabel: 'Subtitle sidebar' });
  applyTheme(panel);
  const count = document.createElement('span');
  const paused = Object.assign(document.createElement('span'), { className: 'paused', textContent: 'Scroll paused' });
  const close = button('close', '×', 'Close the subtitle sidebar (G)');
  const head = Object.assign(document.createElement('div'), { className: 'minerr-lines-head' });
  head.append(Object.assign(document.createElement('strong'), { textContent: 'Subtitles' }), count, paused, close);
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
  panel.append(head, bar, empty, list);
  let filter: LineFilter = 'all';
  let current = -1;
  let cards: Card[] = [];
  const cardOf = new WeakMap<Element, Card>();
  let marks = new Set<number>();
  // The bookmarks of the video load from storage; a bookmark change waits for them, so it keeps the stored ones.
  let loaded: Promise<void> = Promise.resolve();
  let video: string | null = null;
  let segments: SubtitleSegment[] = [];
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
    const lines = cards.map(card => ({ words: lineWords(card.text), marked: marks.has(segments[card.index]?.start ?? -1) }));
    const shown = shownLines(lines, filter);
    cards.forEach((card, index) => {
      const marked = lines[index]?.marked ?? false;
      card.row.hidden = !shown[index];
      card.row.toggleAttribute('data-bookmark', marked);
      card.mark.setAttribute('aria-pressed', String(marked));
    });
    select.value = filter;
    options.get('bookmarks')?.replaceChildren(`${LINE_FILTERS.bookmarks.label} (${lines.filter(line => line.marked).length})`);
    empty.hidden = shown.includes(true);
    emptyText.textContent = segments.length ? 'No line matches the filter.' : NO_TIMES;
    clear.hidden = !segments.length;
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

  const selection = createSelection(panel, addLine, selected => {
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
    card.mark.addEventListener('click', () => toggleBookmark(index));
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

  // The cards exist only while the panel is open: page.ts parses them, and the i+1 highlight would count hidden cards.
  function build(): void {
    count.textContent = segments.length ? `${segments.length} lines` : '';
    bar.hidden = !segments.length;
    pick = null;
    cards = panel.hidden ? [] : segments.map(makeCard);
    list.replaceChildren(...cards.map(card => card.row));
    selection.reset();
    current = -1;
    panel.removeAttribute('data-scroll-paused');
    apply();
  }

  function loadBookmarks(id: string | null): void {
    video = id;
    marks = new Set();
    if (!id) return;
    loaded = chrome.storage.local.get(bookmarkKey(id)).then(stored => {
      const starts: unknown = stored[bookmarkKey(id)];
      if (video !== id || !Array.isArray(starts)) return;
      marks = new Set(starts.filter(start => typeof start === 'number'));
      apply();
    });
  }

  function toggleBookmark(index: number): void {
    const id = video;
    const segment = segments[index];
    if (!id || !segment) return actions.toast('Go to a line first, then bookmark it.');
    loaded = loaded.then(() => {
      if (video !== id) return;
      if (!marks.delete(segment.start)) marks.add(segment.start);
      chrome.storage.local.set({ [bookmarkKey(id)]: [...marks] });
      apply();
      actions.toast(marks.has(segment.start) ? 'Bookmarked the line.' : 'Removed the bookmark.');
    });
  }

  // The page makes room for the open panel. Pages that size their parts in script (the YouTube player) do it on resize.
  function toggle(): void {
    panel.hidden = !panel.hidden;
    document.documentElement.toggleAttribute('data-minerr-side', !panel.hidden);
    dispatchEvent(new Event('resize'));
    build();
  }
  close.addEventListener('click', toggle);

  // scrollTop, not scrollIntoView, which also scrolls the page around the list.
  function center(index: number): void {
    const row = cards[index]?.row;
    if (row && !row.hidden) list.scrollTop = row.offsetTop - (list.clientHeight - row.offsetHeight) / 2;
  }

  // A scroll of the user (wheel, scroll bar, keys, a click that is no seek) stops the follow until the video plays,
  // or until the user goes to a line. The mouse that leaves the panel does not scroll the list.
  function follow(index = current): void {
    panel.removeAttribute('data-scroll-paused');
    center(index);
  }
  for (const type of ['wheel', 'pointerdown', 'keydown']) {
    list.addEventListener(type, () => panel.setAttribute('data-scroll-paused', ''), { passive: true });
  }

  function setCurrent(index: number): void {
    if (index === current) return;
    cards[current]?.row.removeAttribute('aria-current');
    current = index;
    cards[index]?.row.setAttribute('aria-current', 'true');
    if (!panel.matches(PAUSED)) center(index);
  }

  return {
    panel,
    setLines: (next, id) => {
      segments = next;
      if (id !== video) loadBookmarks(id);
      build();
    },
    toggleBookmark,
    toggle,
    setCurrent,
    resumeFollow: () => follow(),
    rowIndex: node => {
      const row = node instanceof Element ? node.closest('li') : null;
      return (row && cardOf.get(row)?.index) ?? null;
    },
  };
}
