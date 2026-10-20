// Highlights the sentence of the word under the mouse, or of the word of the open popup, with the CSS Custom Highlight API.
import { sentenceBounds } from './sentence.ts';
import { sentenceText, wordRange } from './sentence-text.ts';
import { isBoolean, setting } from './settings.ts';
import { watchActive } from './site.ts';

export const sentenceHighlight = setting('sentenceHighlight', isBoolean, false);

const NAME = 'minerr-sentence';
const STYLE = `
  ::highlight(${NAME}) { background-color: rgba(96, 128, 255, 0.16); }
  .minerr-subs-line::highlight(${NAME}), .minerr-subs-line *::highlight(${NAME}) { background-color: rgba(120, 150, 255, 0.35); }
`;

// The range of the sentence of span.
function sentenceRange(span: HTMLElement): Range | null {
  const { nodes, starts, text, from: at } = sentenceText(wordRange(span, span));
  if (!nodes.length) return null;
  const [start, end] = sentenceBounds(text, at);
  // The node of offset: an end point stays at the end of the node before, not at the start of the next word.
  const point = (offset: number, isEnd: boolean): [Text, number] | null => {
    const i = Math.max(0, starts.findLastIndex(nodeStart => (isEnd ? nodeStart < offset : nodeStart <= offset)));
    const node = nodes[i];
    return node ? [node, offset - (starts[i] ?? 0)] : null;
  };
  const [from, to] = [point(start, false), point(end, true)];
  if (!from || !to) return null;
  const range = new Range();
  range.setStart(...from);
  range.setEnd(...to);
  return range;
}

const highlight = new Highlight();
let hovered: HTMLElement | null = null;
let active: HTMLElement | null = null;
let shown = false;

function show(): void {
  highlight.clear();
  const span = hovered ?? active;
  const range = shown && span?.isConnected ? sentenceRange(span) : null;
  if (range) highlight.add(range);
}

// The word of the open popup: its sentence stays highlighted while the mouse is on the popup.
export function setPopupWord(span: HTMLElement | null): void {
  active = span;
  show();
}

export function installSentenceHover(): void {
  document.head.append(Object.assign(document.createElement('style'), { textContent: STYLE }));
  CSS.highlights.set(NAME, highlight);
  document.addEventListener('mouseover', event => {
    const span = event.target instanceof Element ? event.target.closest<HTMLElement>('.ml-word') : null;
    if (span === hovered) return;
    hovered = span;
    show();
  });
  let on = false;
  let wanted = true;
  const update = () => { shown = on && wanted; show(); };
  sentenceHighlight.watch(value => { wanted = value; update(); });
  watchActive(value => { on = value; update(); });
}
