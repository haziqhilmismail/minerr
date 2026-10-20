// The subtitle sidebar: a card for each timed line of the video, in a panel as high as the window at its right side.
// The open panel sets data-minerr-side on the root, and the page gets narrower by the width of the panel, so the panel
// covers nothing. The root is positioned, so an absolute page (YouTube's ytd-app) also gets narrower. Fixed parts
// of a page (the YouTube masthead) need their own rule; src/subtitles.ts has the YouTube rules.
// The cards are page text (VIDEO in src/site.ts), so page.ts underlines their words and the popup works on them.
import type { SubtitleSegment } from './captions.ts';
import { statusOf } from './iplusone.ts';
import { choices, FILTER_NAMES, LINE_FILTERS, type LineFilter, type LineWord, shownLines } from './linefilter.ts';
import { addWordCard } from './popup.ts';
import { STATUSES } from './status.ts';
import { applyTheme } from './theme.ts';
import { TOKENS } from './tokens.ts';
import { wordOf } from './words.ts';

// The list does not follow the video under the mouse, or while the user selects a target word.
const PAUSED = ':hover, :has(.pick)';

// The panel declares the tokens of docs/design.md and follows the Minerr theme (src/theme.ts), not the colors of the page.
const STYLE = `
  :root { --minerr-side-width: min(400px, 40vw); }
  :root[data-minerr-side]:not([data-minerr-off]) { position: relative !important; margin-right: var(--minerr-side-width) !important; }
  .minerr-lines { ${TOKENS} color-scheme: light dark;
    position: fixed; top: 0; right: 0; bottom: 0; z-index: 2147483646; width: var(--minerr-side-width);
    box-sizing: border-box; display: flex; flex-direction: column; overflow: hidden;
    border-left: 1px solid var(--line); background: var(--bg); color: var(--text); box-shadow: var(--shadow-2);
    font: 16px/1.5 var(--font-ui); text-align: left;
  }
  .minerr-lines[data-theme="light"] { color-scheme: light; }
  .minerr-lines[data-theme="dark"] { color-scheme: dark; }
  .minerr-lines[hidden], :root[data-minerr-off] .minerr-lines { display: none; }
  .minerr-lines button, .minerr-lines select, .minerr-lines input { box-sizing: border-box; margin: 0; border: 1px solid var(--line);
    border-radius: var(--radius-pill); background: transparent; color: inherit; font: 600 14px/1.6 var(--font-ui); cursor: pointer; }
  .minerr-lines button:hover, .minerr-lines input:hover { background: var(--raised); }
  .minerr-lines select { width: 100%; padding: 6px 10px; border-radius: var(--radius-s); background: var(--field); }
  .minerr-lines :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .minerr-lines-head { display: flex; align-items: center; gap: 8px; padding: 12px 12px 0 16px; }
  .minerr-lines-head strong { font-size: 17px; font-weight: 800; }
  .minerr-lines-head span { color: var(--muted); font-size: 14px; }
  .minerr-lines-head .paused { display: none; padding: 1px 10px; border-radius: var(--radius-pill); background: var(--accent-soft);
    color: var(--accent); font-size: 12px; font-weight: 700; }
  .minerr-lines:is(${PAUSED}) .minerr-lines-head .paused { display: inline; }
  .minerr-lines-head button { width: 34px; height: 34px; margin-left: auto; padding: 0; border: 0; border-radius: 50%;
    color: var(--muted); font-size: 20px; line-height: 1; }
  .minerr-lines-head button:hover { color: var(--text); }
  .minerr-lines-bar { padding: 10px 12px 12px 16px; border-bottom: 1px solid var(--line); }
  .minerr-lines ol { position: relative; flex: 1; min-height: 0; margin: 0; padding: 10px 12px; overflow: auto; overscroll-behavior: contain; list-style: none; }
  .minerr-lines li { margin: 0 0 8px; padding: 6px 10px 10px 14px; border-radius: var(--radius-m); background: var(--card);
    box-shadow: var(--shadow-1); cursor: pointer; }
  .minerr-lines li[hidden] { display: none; }
  .minerr-lines li:hover { box-shadow: inset 0 0 0 1px var(--line), var(--shadow-1); }
  .minerr-lines li[aria-current="true"] { background: color-mix(in srgb, var(--accent-fill) 14%, var(--card));
    box-shadow: inset 0 0 0 2px var(--accent), var(--shadow-1); }
  .minerr-lines .card-head { display: flex; align-items: center; gap: 2px; }
  .minerr-lines time { margin-right: auto; color: var(--muted); font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .minerr-lines li[aria-current="true"] time { color: var(--accent); font-weight: 800; }
  .minerr-lines .card-head button { width: 32px; height: 32px; padding: 0; border: 0; border-radius: 50%; color: var(--muted); font-size: 16px; line-height: 1; }
  .minerr-lines .card-head button:hover { color: var(--text); }
  .minerr-lines .card-head .add { color: var(--accent); font-size: 22px; }
  .minerr-lines li[data-bookmark] .mark { color: var(--star); }
  .minerr-lines .text { margin: 2px 0 0; font: 19px/1.65 var(--font-jp); white-space: pre-line; overflow-wrap: anywhere; }
  .minerr-lines .pick { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 8px; padding-top: 8px;
    border-top: 1px solid var(--line); cursor: default; }
  .minerr-lines .pick span { flex-basis: 100%; color: var(--muted); font-size: 13px; font-weight: 600; }
  .minerr-lines .pick input { padding: 3px 12px; background: var(--field); font: 17px/1.5 var(--font-jp); }
  .minerr-lines .pick .unknown { border-color: ${STATUSES.unknown.color}; box-shadow: inset 0 0 0 1px ${STATUSES.unknown.color}; }
  .minerr-lines .pick button, .minerr-lines-empty button { padding: 3px 14px; border-color: transparent; background: var(--raised); }
  .minerr-lines .pick button { color: var(--muted); }
  .minerr-lines .pick button:hover, .minerr-lines-empty button:hover { background: var(--accent-soft); color: var(--text); }
  .minerr-lines-empty { padding: 16px; color: var(--muted); }
  .minerr-lines-empty p { margin: 0 0 10px; }
`;

const ADD_LABEL = 'Add a card for a word of the line';
// Where subtitles with times come from. src/video.ts shows it in its hint for the keys that need times.
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
}

// A word of a line: its first span, and the text of all its parts.
interface SpanWord extends LineWord {
  span: HTMLElement;
  text: string;
}

const button = (className: string, text: string, label: string) =>
  Object.assign(document.createElement('button'), { type: 'button', className, textContent: text, title: label, ariaLabel: label });

// The words of a line in text order. A word in parts (src/words.ts) is one word; a span without a status is no word yet.
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

  async function addFor(card: Card, span: HTMLElement): Promise<void> {
    closePick();
    await actions.still(card.index);
    if (span.isConnected) await addWordCard(span);
  }

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
    const [only, ...more] = words.filter(word => word.status === 'unknown');
    if (only && !more.length) {
      addFor(card, only.span);
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
    };
    const play = button('play', '▶', 'Play the line');
    play.addEventListener('click', () => actions.play(index));
    card.add.addEventListener('click', () => plus(card));
    card.mark.addEventListener('click', () => toggleBookmark(index));
    const cardHead = Object.assign(document.createElement('div'), { className: 'card-head' });
    cardHead.append(Object.assign(document.createElement('time'), { textContent: minutes(segment.start) }), play, card.add, card.mark);
    card.row.append(cardHead, card.text);
    card.row.addEventListener('click', event => {
      if (!(event.target instanceof Element && event.target.closest('.ml-word, button, .pick'))) actions.seek(index);
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
    current = -1;
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
  function center(): void {
    const row = cards[current]?.row;
    if (row && !row.hidden) list.scrollTop = row.offsetTop - (list.clientHeight - row.offsetHeight) / 2;
  }
  // While PAUSED, the "Scroll paused" badge shows; the list goes to the current line when the mouse leaves.
  panel.addEventListener('pointerleave', center);

  function setCurrent(index: number): void {
    if (index === current) return;
    cards[current]?.row.removeAttribute('aria-current');
    current = index;
    cards[index]?.row.setAttribute('aria-current', 'true');
    if (!panel.matches(PAUSED)) center();
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
    rowIndex: node => {
      const row = node instanceof Element ? node.closest('li') : null;
      return (row && cardOf.get(row)?.index) ?? null;
    },
  };
}
