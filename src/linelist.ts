// The subtitle browser: a side panel over the video with every timed line. A click on a line goes to it.
// The rows are page text, so page.ts underlines their words and the popup works on them.
import type { SubtitleSegment } from './captions.ts';
import { wordStatuses } from './overlay.ts';
import { isIPlusOne } from './sentence.ts';

const STYLE = `
  .minerr-lines { position: absolute; top: 8px; right: 8px; bottom: 56px; display: flex; flex-direction: column;
    width: 40cqw; border-radius: 10px; background: rgba(16, 16, 22, 0.92); color: #ececf1; pointer-events: auto;
    font: 15px/1.5 "Hiragino Sans", "Yu Gothic UI", "Meiryo", "Noto Sans JP", system-ui, sans-serif; text-align: left; }
  .minerr-lines[hidden] { display: none; }
  /* The line moves to the middle of the part that the panel leaves free. */
  .minerr-subs:has(> .minerr-lines:not([hidden])) .minerr-subs-stack { left: calc(30cqw - 4px); max-width: calc(58cqw - 16px); }
  .minerr-lines-bar { display: flex; flex-wrap: wrap; gap: 4px; padding: 8px; border-bottom: 1px solid rgba(255, 255, 255, 0.14); }
  .minerr-lines button { padding: 2px 8px; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 6px; background: transparent;
    color: inherit; font: 600 12px/1.6 system-ui, sans-serif; cursor: pointer; }
  .minerr-lines button[aria-pressed="true"] { background: #ececf1; color: #16161c; }
  .minerr-lines ol { flex: 1; margin: 0; padding: 4px 0; overflow: auto; overscroll-behavior: contain; list-style: none; }
  .minerr-lines li { display: flex; gap: 8px; align-items: baseline; padding: 4px 10px; cursor: pointer; }
  .minerr-lines li[hidden] { display: none; }
  .minerr-lines li:hover { background: rgba(255, 255, 255, 0.07); }
  .minerr-lines li[aria-current="true"] { background: rgba(124, 147, 242, 0.28); }
  .minerr-lines time { flex: none; color: #a3a5b3; font: 12px/1.5 ui-monospace, monospace; }
  .minerr-lines .text { flex: 1; white-space: pre-line; }
  .minerr-lines .mark { flex: none; padding: 0 4px; border: 0; color: #6b6e7c; font-size: 14px; }
  .minerr-lines li[data-bookmark] .mark { color: #f5c400; }
  .minerr-lines-empty { padding: 12px; color: #a3a5b3; }
`;

// The filters of the list. 'iPlusOne' lines have exactly one unknown word; 'learning' lines have a word in learning.
export const LINE_FILTERS = {
  all: { label: 'All' },
  iPlusOne: { label: '1 unknown word' },
  learning: { label: 'Learning' },
  bookmarks: { label: 'Bookmarks' },
} as const;
export type LineFilter = keyof typeof LINE_FILTERS;

const FILTER_NAMES = Object.keys(LINE_FILTERS).filter((name): name is LineFilter => Object.hasOwn(LINE_FILTERS, name));

const minutes = (time: number) => `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, '0')}`;

export interface LineList {
  panel: HTMLElement;
  // bookmarks holds the start times of the bookmarked lines.
  setLines: (segments: SubtitleSegment[], bookmarks: Set<number>) => void;
  setBookmarks: (bookmarks: Set<number>) => void;
  toggle: () => void;
  setCurrent: (index: number) => void;
  // The index of the line of a row that holds node, or null.
  rowIndex: (node: Node) => number | null;
}

export function createLineList(onSeek: (index: number) => void, onBookmark: (index: number) => void): LineList {
  document.head.append(Object.assign(document.createElement('style'), { textContent: STYLE }));
  const panel = Object.assign(document.createElement('div'), { className: 'minerr-lines', hidden: true });
  const list = document.createElement('ol');
  const empty = Object.assign(document.createElement('p'), { className: 'minerr-lines-empty', hidden: true, textContent: 'No line matches the filter.' });
  let filter: LineFilter = 'all';
  let current = -1;
  let rows: HTMLLIElement[] = [];
  let marks = new Set<number>();
  let starts: number[] = [];

  const filterButtons = FILTER_NAMES.map(name => {
    const button = Object.assign(document.createElement('button'), { type: 'button', textContent: LINE_FILTERS[name].label });
    button.addEventListener('click', () => {
      filter = name;
      apply();
    });
    return [name, button] as const;
  });
  const bar = Object.assign(document.createElement('div'), { className: 'minerr-lines-bar' });
  bar.append(...filterButtons.map(([, button]) => button));
  panel.append(bar, list, empty);

  const matches = (row: HTMLLIElement, index: number): boolean => {
    if (filter === 'bookmarks') return marks.has(starts[index] ?? -1);
    if (filter === 'all') return true;
    const statuses = wordStatuses(row);
    return filter === 'iPlusOne' ? isIPlusOne(statuses) : statuses.includes('learning');
  };

  function apply(): void {
    for (const [name, button] of filterButtons) button.setAttribute('aria-pressed', String(name === filter));
    rows.forEach((row, i) => {
      row.hidden = !matches(row, i);
      row.toggleAttribute('data-bookmark', marks.has(starts[i] ?? -1));
    });
    empty.hidden = rows.some(row => !row.hidden);
  }

  // A status change or the parse of page.ts changes the classes of the words, and so the filters.
  let pending = 0;
  new MutationObserver(() => {
    if (filter === 'all' || filter === 'bookmarks' || pending) return;
    pending = requestAnimationFrame(() => {
      pending = 0;
      apply();
    });
  }).observe(list, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });

  let segments: SubtitleSegment[] = [];
  // The rows exist only while the panel is open: page.ts parses them, and the i+1 highlight would count hidden rows.
  function build(): void {
    starts = segments.map(segment => segment.start);
    rows = panel.hidden ? [] : segments.map((segment, index) => {
      const row = document.createElement('li');
      const mark = Object.assign(document.createElement('button'), { type: 'button', className: 'mark', textContent: '★', title: 'Bookmark (B)' });
      mark.addEventListener('click', event => {
        event.stopPropagation();
        onBookmark(index);
      });
      row.append(Object.assign(document.createElement('time'), { textContent: minutes(segment.start) }),
        Object.assign(document.createElement('span'), { className: 'text', textContent: segment.text }), mark);
      row.addEventListener('click', event => {
        if (!(event.target instanceof Element && event.target.closest('.ml-word'))) onSeek(index);
      });
      return row;
    });
    list.replaceChildren(...rows);
    current = -1;
    apply();
  }

  function setLines(next: SubtitleSegment[], bookmarks: Set<number>): void {
    segments = next;
    marks = bookmarks;
    build();
  }

  function setBookmarks(bookmarks: Set<number>): void {
    marks = bookmarks;
    apply();
  }

  function toggle(): void {
    panel.hidden = !panel.hidden;
    build();
  }

  function setCurrent(index: number): void {
    if (index === current) return;
    rows[current]?.removeAttribute('aria-current');
    current = index;
    const row = rows[index];
    row?.setAttribute('aria-current', 'true');
    if (row && !panel.hidden) row.scrollIntoView({ block: 'nearest' });
  }

  const rowIndex = (node: Node): number | null => {
    const row = node instanceof Element ? node.closest('li') : null;
    const index = row ? rows.indexOf(row) : -1;
    return index < 0 ? null : index;
  };

  return { panel, setLines, setBookmarks, toggle, setCurrent, rowIndex };
}
