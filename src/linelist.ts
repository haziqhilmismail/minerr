// The subtitle sidebar: a card for each timed line of the video, beside the video. The host page puts the panel in its place
// (src/subtitles.ts on YouTube, player.ts in the player); without a place, it is a column at the right of the window.
// The cards are page text (VIDEO in src/site.ts), so page.ts underlines their words and the popup works on them.
import type { SubtitleSegment } from './captions.ts';
import { wordStatuses } from './overlay.ts';
import { isIPlusOne } from './sentence.ts';
import type { Status } from './status.ts';

// The colors come from the light-dark() pairs of theme.css, so they follow the color scheme of the host page.
// A host can set the --minerr-side-* properties to match its own palette.
const STYLE = `
  .minerr-lines {
    --minerr-side-bg: light-dark(#ffffff, #1f2027); --minerr-side-card: light-dark(#f4f5f8, #2b2c35);
    --minerr-side-text: light-dark(#1c1d24, #ecedf2); --minerr-side-muted: light-dark(#5f6270, #a3a5b3);
    --minerr-side-line: light-dark(#dcdee6, #353642); --minerr-side-accent: light-dark(#2c4bb8, #7c93f2);
    --minerr-side-on-accent: light-dark(#ffffff, #10173a);
    box-sizing: border-box; display: flex; flex-direction: column; min-height: 0; overflow: hidden;
    border: 1px solid var(--minerr-side-line); border-radius: 12px; background: var(--minerr-side-bg); color: var(--minerr-side-text);
    font: 15px/1.5 "Hiragino Sans", "Yu Gothic UI", "Meiryo", "Noto Sans JP", system-ui, sans-serif; text-align: left;
  }
  .minerr-lines[hidden], :root[data-minerr-off] .minerr-lines { display: none; }
  body > .minerr-lines { position: fixed; top: 8px; right: 8px; bottom: 8px; z-index: 2147483646; width: min(360px, 40vw); }
  .minerr-lines button { box-sizing: border-box; border: 1px solid var(--minerr-side-line); border-radius: 6px; background: transparent;
    color: inherit; font: 600 12px/1.6 system-ui, sans-serif; cursor: pointer; }
  .minerr-lines button:hover { border-color: var(--minerr-side-muted); }
  .minerr-lines button:focus-visible { outline: 2px solid var(--minerr-side-accent); outline-offset: 1px; }
  .minerr-lines-head { display: flex; align-items: center; gap: 8px; padding: 10px 10px 0 14px; }
  .minerr-lines-head strong { font: 700 14px/1.4 system-ui, sans-serif; }
  .minerr-lines-head span { margin-right: auto; color: var(--minerr-side-muted); font: 12px/1.4 system-ui, sans-serif; }
  .minerr-lines-head button { width: 28px; height: 28px; border-color: transparent; font-size: 16px; line-height: 1; }
  .minerr-lines-bar { display: flex; flex-wrap: wrap; gap: 4px; padding: 8px 10px 10px; border-bottom: 1px solid var(--minerr-side-line); }
  .minerr-lines-bar button { padding: 2px 9px; }
  .minerr-lines-bar button[aria-pressed="true"] { border-color: transparent; background: var(--minerr-side-accent); color: var(--minerr-side-on-accent); }
  .minerr-lines ol { position: relative; flex: 1; min-height: 0; margin: 0; padding: 8px; overflow: auto; overscroll-behavior: contain; list-style: none; }
  .minerr-lines li { margin: 0 0 6px; padding: 4px 8px 8px 10px; border-left: 3px solid transparent; border-radius: 8px;
    background: var(--minerr-side-card); cursor: pointer; }
  .minerr-lines li[hidden] { display: none; }
  .minerr-lines li:hover { box-shadow: inset 0 0 0 1px var(--minerr-side-line); }
  .minerr-lines li[aria-current="true"] { border-left-color: var(--minerr-side-accent);
    background: color-mix(in srgb, var(--minerr-side-accent) 16%, var(--minerr-side-card)); }
  .minerr-lines .card-head { display: flex; align-items: center; gap: 2px; }
  .minerr-lines time { margin-right: auto; color: var(--minerr-side-muted); font: 12px/1.5 ui-monospace, monospace; }
  .minerr-lines li[aria-current="true"] time { color: var(--minerr-side-accent); font-weight: 700; }
  .minerr-lines .card-head button { width: 28px; height: 26px; padding: 0; border-color: transparent; color: var(--minerr-side-muted); font-size: 14px; line-height: 1; }
  .minerr-lines .card-head button:hover { border-color: var(--minerr-side-line); color: var(--minerr-side-text); }
  .minerr-lines li[data-bookmark] .mark { color: #e0a800; }
  .minerr-lines .text { margin: 0; font-size: 16px; white-space: pre-line; overflow-wrap: anywhere; }
  .minerr-lines-empty { margin: 0; padding: 14px; color: var(--minerr-side-muted); }
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

// Minerr keeps the start times of the bookmarked lines of each video.
const bookmarkKey = (id: string) => `bm:${id}`;

const minutes = (time: number) => `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, '0')}`;

// What the cards ask of the video, by the index of the line.
export interface LineActions {
  seek: (index: number) => void;
  // Plays the line once, then pauses at its end.
  play: (index: number) => void;
  toast: (text: string) => void;
}

export interface LineList {
  panel: HTMLElement;
  // id names the video, for its bookmarks. No segments: the list shows note instead.
  setLines: (segments: SubtitleSegment[], id: string | null, note: string) => void;
  // Bookmarks the line, or removes its bookmark. Returns the text of the toast.
  toggleBookmark: (index: number) => string;
  toggle: () => void;
  setCurrent: (index: number) => void;
  // The index of the line of a row that holds node, or null.
  rowIndex: (node: Node) => number | null;
}

const button = (className: string, text: string, label: string) =>
  Object.assign(document.createElement('button'), { type: 'button', className, textContent: text, title: label, ariaLabel: label });

const textOf = (row: Element) => row.querySelector('.text') ?? row;

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
  let rows: HTMLLIElement[] = [];
  let marks = new Set<number>();
  let video: string | null = null;
  let segments: SubtitleSegment[] = [];
  let note = '';
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

  function update(row: HTMLLIElement, index: number): void {
    const statuses = wordStatuses(textOf(row));
    const marked = marks.has(segments[index]?.start ?? -1);
    row.hidden = !LINE_FILTERS[filter].keeps({ statuses, marked });
    row.toggleAttribute('data-bookmark', marked);
    row.querySelector('.mark')?.setAttribute('aria-pressed', String(marked));
  }

  function showEmpty(): void {
    empty.hidden = rows.some(row => !row.hidden);
    empty.textContent = segments.length ? 'No line matches the filter.' : note;
  }

  function apply(): void {
    for (const [name, filterButton] of filterButtons) filterButton.setAttribute('aria-pressed', String(name === filter));
    rows.forEach(update);
    showEmpty();
  }

  // A status change or the parse of page.ts changes the classes of the words, and so the filters of those rows.
  const changed = new Set<HTMLLIElement>();
  let pending = 0;
  new MutationObserver(records => {
    for (const record of records) {
      const row = (record.target instanceof Element ? record.target : record.target.parentElement)?.closest('li');
      if (row) changed.add(row);
    }
    pending ||= requestAnimationFrame(() => {
      pending = 0;
      for (const row of changed) {
        const index = rows.indexOf(row);
        if (index >= 0) update(row, index);
      }
      changed.clear();
      showEmpty();
    });
  }).observe(list, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });

  function card(segment: SubtitleSegment, index: number): HTMLLIElement {
    const row = document.createElement('li');
    const play = button('play', '▶', 'Play the line');
    const mark = button('mark', '★', 'Bookmark the line (B)');
    play.addEventListener('click', () => actions.play(index));
    mark.addEventListener('click', () => actions.toast(toggleBookmark(index)));
    const cardHead = Object.assign(document.createElement('div'), { className: 'card-head' });
    cardHead.append(Object.assign(document.createElement('time'), { textContent: minutes(segment.start) }), play, mark);
    row.append(cardHead, Object.assign(document.createElement('p'), { className: 'text', textContent: segment.text }));
    row.addEventListener('click', event => {
      if (!(event.target instanceof Element && event.target.closest('.ml-word, button'))) actions.seek(index);
    });
    return row;
  }

  // The rows exist only while the panel is open: page.ts parses them, and the i+1 highlight would count hidden rows.
  function build(): void {
    count.textContent = segments.length ? `${segments.length} lines` : '';
    bar.hidden = !segments.length;
    rows = panel.hidden ? [] : segments.map(card);
    list.replaceChildren(...rows);
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
    chrome.storage.local.get(bookmarkKey(id)).then(stored => {
      const starts: unknown = stored[bookmarkKey(id)];
      if (video !== id || !Array.isArray(starts)) return;
      marks = new Set(starts.filter(start => typeof start === 'number'));
      apply();
    });
  }

  function toggleBookmark(index: number): string {
    const segment = segments[index];
    if (!video || !segment) return 'Go to a line first, then bookmark it.';
    if (!marks.delete(segment.start)) marks.add(segment.start);
    chrome.storage.local.set({ [bookmarkKey(video)]: [...marks] });
    apply();
    return marks.has(segment.start) ? 'Bookmarked the line.' : 'Removed the bookmark.';
  }

  function toggle(): void {
    panel.hidden = !panel.hidden;
    build();
  }
  close.addEventListener('click', toggle);

  function setCurrent(index: number): void {
    if (index === current) return;
    rows[current]?.removeAttribute('aria-current');
    current = index;
    const row = rows[index];
    row?.setAttribute('aria-current', 'true');
    // scrollTop, not scrollIntoView, which also scrolls the page around the list.
    if (row && !row.hidden && performance.now() - scrolledAt > HOLD_MS) list.scrollTop = row.offsetTop - (list.clientHeight - row.offsetHeight) / 2;
  }

  return {
    panel,
    setLines: (next, id, text) => {
      segments = next;
      note = text;
      if (id !== video) loadBookmarks(id);
      build();
    },
    toggleBookmark,
    toggle,
    setCurrent,
    rowIndex: node => {
      const row = node instanceof Element ? node.closest('li') : null;
      const index = row ? rows.indexOf(row) : -1;
      return index < 0 ? null : index;
    },
  };
}
