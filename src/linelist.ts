// The subtitle sidebar: a card for each timed line of the video, beside the video. The host page puts the panel in its place
// (src/subtitles.ts on YouTube, player.ts in the player); without a place, it is a column at the right of the window.
// The cards are page text (VIDEO in src/site.ts), so page.ts underlines their words and the popup works on them.
import type { SubtitleSegment } from './captions.ts';
import { wordStatuses } from './overlay.ts';
import { addWordCard } from './popup.ts';
import { isIPlusOne } from './sentence.ts';
import type { Status } from './status.ts';
import { TOKENS } from './tokens.ts';

// The tokens are light-dark() pairs (src/tokens.ts), so the sidebar follows the color-scheme that the host sets:
// the theme on the player page, light or dark YouTube.
const STYLE = `
  .minerr-lines {
    ${TOKENS}
    box-sizing: border-box; display: flex; flex-direction: column; min-height: 0; overflow: hidden;
    border: 1px solid var(--line); border-radius: var(--radius-m); background: var(--card); color: var(--text);
    font: 15px/1.5 var(--font-ui); text-align: left; box-shadow: var(--shadow-1);
  }
  .minerr-lines[hidden], :root[data-minerr-off] .minerr-lines { display: none; }
  body > .minerr-lines { position: fixed; top: 8px; right: 8px; bottom: 8px; z-index: 2147483646; width: min(360px, 40vw); box-shadow: var(--shadow-3); }
  .minerr-lines button { box-sizing: border-box; border: 1px solid var(--line); border-radius: var(--radius-pill); background: transparent;
    color: inherit; font: 600 12px/1.6 var(--font-ui); cursor: pointer; }
  .minerr-lines button:hover { border-color: var(--accent); background: var(--accent-soft); }
  .minerr-lines button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .minerr-lines-head { display: flex; align-items: center; gap: 8px; padding: 12px 10px 0 16px; }
  .minerr-lines-head strong { font: 800 15px/1.4 var(--font-ui); }
  .minerr-lines-head span { margin-right: auto; color: var(--muted); font: 12px/1.4 var(--font-ui); }
  .minerr-lines-head button { width: 32px; height: 32px; border-color: transparent; border-radius: 50%; font-size: 16px; line-height: 1; }
  .minerr-lines-bar { display: flex; flex-wrap: wrap; gap: 4px; padding: 8px 12px 12px; border-bottom: 1px solid var(--line); }
  .minerr-lines-bar button { min-height: 28px; padding: 2px 12px; }
  .minerr-lines-bar button[aria-pressed="true"] { border-color: transparent; background: var(--accent-fill); color: var(--on-accent); }
  .minerr-lines ol { position: relative; flex: 1; min-height: 0; margin: 0; padding: 10px; overflow: auto; overscroll-behavior: contain; list-style: none; }
  .minerr-lines li { margin: 0 0 8px; padding: 4px 10px 10px 12px; border-left: 3px solid transparent; border-radius: var(--radius-s);
    background: var(--raised); cursor: pointer; }
  .minerr-lines li[hidden] { display: none; }
  .minerr-lines li:hover { box-shadow: inset 0 0 0 1px var(--line); }
  .minerr-lines li[aria-current="true"] { border-left-color: var(--accent-fill); background: var(--accent-soft); }
  .minerr-lines .card-head { display: flex; align-items: center; gap: 2px; }
  .minerr-lines time { margin-right: auto; color: var(--muted); font: 12px/1.5 ui-monospace, monospace; }
  .minerr-lines li[aria-current="true"] time { color: var(--accent); font-weight: 700; }
  .minerr-lines .card-head button { width: 28px; height: 28px; padding: 0; border-color: transparent; border-radius: 50%; color: var(--muted); font-size: 14px; line-height: 1; }
  .minerr-lines .card-head button:hover { color: var(--text); }
  .minerr-lines .card-head .add { font-size: 18px; }
  .minerr-lines .card-head .add[aria-disabled="true"] { opacity: 0.35; cursor: not-allowed; }
  .minerr-lines li[data-bookmark] .mark { color: #e0a800; }
  .minerr-lines .text { margin: 0; font: 16px/1.5 var(--font-jp); white-space: pre-line; overflow-wrap: anywhere; }
  .minerr-lines-empty { margin: 0; padding: 14px; color: var(--muted); }
`;

// What a filter reads of a line: the statuses of its words, and whether the user bookmarked it.
interface LineState {
  statuses: Status[];
  marked: boolean;
}

// The filters of the list. 'iPlusOne' lines have exactly one unknown word; 'learning' lines have a word in learning.
export const LINE_FILTERS = {
  all: { label: 'All', keeps: () => true },
  iPlusOne: { label: '1 unknown word', keeps: ({ statuses }: LineState) => isIPlusOne(statuses) },
  learning: { label: 'Learning', keeps: ({ statuses }: LineState) => statuses.includes('learning') },
  bookmarks: { label: 'Bookmarks', keeps: ({ marked }: LineState) => marked },
} as const;
export type LineFilter = keyof typeof LINE_FILTERS;

const FILTER_NAMES = Object.keys(LINE_FILTERS).filter((name): name is LineFilter => Object.hasOwn(LINE_FILTERS, name));

// After the user scrolls the list, the list stops to follow the video for this long.
const HOLD_MS = 3000;
const ADD_LABEL = 'Add a card for the unknown word of the line';
const ADD_OFF = 'A card from + needs a line with exactly one unknown word. Move the mouse over a word and press A to add any word.';
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

const button = (className: string, text: string, label: string) =>
  Object.assign(document.createElement('button'), { type: 'button', className, textContent: text, title: label, ariaLabel: label });

// The unknown word of an i+1 line, or null.
function unknownWord({ text }: Card): HTMLElement | null {
  return isIPlusOne(wordStatuses(text)) ? text.querySelector<HTMLElement>('.ml-word.ml-unknown:not([data-ml-cont])') : null;
}

export function createLineList(actions: LineActions): LineList {
  document.head.append(Object.assign(document.createElement('style'), { textContent: STYLE }));
  const panel = Object.assign(document.createElement('section'), { className: 'minerr-lines', hidden: true, ariaLabel: 'Subtitle sidebar' });
  const count = document.createElement('span');
  const close = button('close', '×', 'Close the subtitle sidebar (G)');
  const head = Object.assign(document.createElement('div'), { className: 'minerr-lines-head' });
  head.append(Object.assign(document.createElement('strong'), { textContent: 'Subtitles' }), count, close);
  const list = document.createElement('ol');
  const empty = Object.assign(document.createElement('p'), { className: 'minerr-lines-empty', hidden: true });
  let filter: LineFilter = 'all';
  let current = -1;
  let cards: Card[] = [];
  const cardOf = new WeakMap<Element, Card>();
  let marks = new Set<number>();
  // The bookmarks of the video load from storage; a bookmark change waits for them, so it keeps the stored ones.
  let loaded: Promise<void> = Promise.resolve();
  let video: string | null = null;
  let segments: SubtitleSegment[] = [];
  let scrolledAt = -Infinity;

  const filterButtons = FILTER_NAMES.map(name => {
    const filterButton = Object.assign(document.createElement('button'), { type: 'button', textContent: LINE_FILTERS[name].label });
    filterButton.addEventListener('click', () => {
      filter = name;
      apply();
    });
    return [name, filterButton] as const;
  });
  const bar = Object.assign(document.createElement('div'), { className: 'minerr-lines-bar' });
  bar.append(...filterButtons.map(([, filterButton]) => filterButton));
  panel.append(head, bar, list, empty);

  function update(card: Card): void {
    const statuses = wordStatuses(card.text);
    const marked = marks.has(segments[card.index]?.start ?? -1);
    const on = isIPlusOne(statuses);
    card.row.hidden = !LINE_FILTERS[filter].keeps({ statuses, marked });
    card.row.toggleAttribute('data-bookmark', marked);
    card.mark.setAttribute('aria-pressed', String(marked));
    card.add.setAttribute('aria-disabled', String(!on));
    card.add.title = on ? ADD_LABEL : ADD_OFF;
  }

  function showEmpty(): void {
    empty.hidden = cards.some(card => !card.row.hidden);
    empty.textContent = segments.length ? 'No line matches the filter.' : NO_TIMES;
  }

  function apply(): void {
    for (const [name, filterButton] of filterButtons) filterButton.setAttribute('aria-pressed', String(name === filter));
    cards.forEach(update);
    showEmpty();
  }

  // A status change or the parse of page.ts changes the classes of the words: the filters and the + of those cards.
  const changed = new Set<Card>();
  let pending = 0;
  new MutationObserver(records => {
    for (const record of records) {
      const row = (record.target instanceof Element ? record.target : record.target.parentElement)?.closest('li');
      const card = row && cardOf.get(row);
      if (card) changed.add(card);
    }
    pending ||= requestAnimationFrame(() => {
      pending = 0;
      changed.forEach(update);
      changed.clear();
      showEmpty();
    });
  }).observe(list, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });

  async function addCard(card: Card): Promise<void> {
    if (!unknownWord(card)) return;
    await actions.still(card.index);
    // The seek can come after a status change; the line must still have its one unknown word.
    const word = unknownWord(card);
    if (word) await addWordCard(word);
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
    card.add.addEventListener('click', () => addCard(card));
    card.mark.addEventListener('click', () => toggleBookmark(index));
    const cardHead = Object.assign(document.createElement('div'), { className: 'card-head' });
    cardHead.append(Object.assign(document.createElement('time'), { textContent: minutes(segment.start) }), play, card.add, card.mark);
    card.row.append(cardHead, card.text);
    card.row.addEventListener('click', event => {
      if (!(event.target instanceof Element && event.target.closest('.ml-word, button'))) actions.seek(index);
    });
    cardOf.set(card.row, card);
    return card;
  }

  // The cards exist only while the panel is open: page.ts parses them, and the i+1 highlight would count hidden cards.
  function build(): void {
    count.textContent = segments.length ? `${segments.length} lines` : '';
    bar.hidden = !segments.length;
    cards = panel.hidden ? [] : segments.map(makeCard);
    list.replaceChildren(...cards.map(card => card.row));
    current = -1;
    scrolledAt = -Infinity;
    apply();
  }

  // A scroll, a key, or the focus in the list is the user's: the list does not move under the user for HOLD_MS.
  const held = () => { scrolledAt = performance.now(); };
  for (const type of ['wheel', 'touchmove', 'keydown', 'focusin']) list.addEventListener(type, held, { passive: true });
  list.addEventListener('pointerdown', event => { if (event.target === list) held(); });

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

  function toggle(): void {
    panel.hidden = !panel.hidden;
    build();
  }
  close.addEventListener('click', toggle);

  function setCurrent(index: number): void {
    if (index === current) return;
    cards[current]?.row.removeAttribute('aria-current');
    current = index;
    const row = cards[index]?.row;
    row?.setAttribute('aria-current', 'true');
    // scrollTop, not scrollIntoView, which also scrolls the page around the list.
    if (row && !row.hidden && performance.now() - scrolledAt > HOLD_MS) list.scrollTop = row.offsetTop - (list.clientHeight - row.offsetHeight) / 2;
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
