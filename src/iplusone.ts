// Highlights the i+1 sentences (one unknown word) with the CSS Custom Highlight API, so the page DOM stays as it is.
import { blockOf } from './dom.ts';
import { iPlusOneSentences, type Piece } from './sentence.ts';
import { type Status, STATUS_NAMES, STATUSES } from './status.ts';
import { iPlusOne } from './settings.ts';
import { watchActive } from './site.ts';

const NAME = 'minerr-i1';
// A translucent yellow, like a highlighter pen: pale on a light page, olive on a dark page.
// The subtitle overlay is a dark box over moving video, so it gets a stronger yellow.
const STYLE = `
  ::highlight(${NAME}) { background-color: rgba(250, 204, 21, 0.3); }
  .minerr-subs-line::highlight(${NAME}), .minerr-subs-line *::highlight(${NAME}) { background-color: rgba(250, 204, 21, 0.5); }
`;
const DELAY_MS = 150;

const highlight = new Highlight();
let shown = false;
let timer: ReturnType<typeof setTimeout> | null = null;

export const statusOf = (span: Element): Status | null => STATUS_NAMES.find(status => span.classList.contains(STATUSES[status].className)) ?? null;

function ranges(block: Element, cache: Map<Element, Element>): Range[] {
  const pieces: Piece[] = [];
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!(node instanceof Text) || !parent) continue;
    // The text of a nested block is a sentence of that block; here it only ends the sentence before it.
    if (blockOf(parent, cache) !== block) {
      if (pieces.at(-1)?.text !== '\n') {
        pieces.push({ text: '\n', status: null });
        nodes.push(node);
      }
      continue;
    }
    // The parts after the first of a word that crosses nodes do not count again.
    pieces.push({ text: node.data, status: parent.matches('.ml-word:not([data-ml-cont])') ? statusOf(parent) : null });
    nodes.push(node);
  }
  return iPlusOneSentences(pieces).flatMap(({ start, end }) => {
    const startNode = nodes[start.piece];
    const endNode = nodes[end.piece];
    if (!startNode || !endNode) return [];
    const range = new Range();
    range.setStart(startNode, start.offset);
    range.setEnd(endNode, end.offset);
    return [range];
  });
}

// Every i+1 sentence of the document.
export function iPlusOneRanges(): Range[] {
  const cache = new Map<Element, Element>();
  const blocks = new Set<Element>();
  for (const span of document.querySelectorAll('.ml-word')) blocks.add(blockOf(span.parentElement ?? span, cache));
  return [...blocks].flatMap(block => ranges(block, cache));
}

// Recomputes every i+1 sentence of the document. Exported so a test can measure it.
export function refresh(): void {
  timer = null;
  highlight.clear();
  if (!shown) return;
  for (const range of iPlusOneRanges()) highlight.add(range);
}

function schedule(): void {
  if (shown) timer ??= setTimeout(refresh, DELAY_MS);
}

const isWord = (node: Node) => node instanceof Element && node.classList.contains('ml-word');
const hasWords = (node: Node) => isWord(node) || (node instanceof Element && node.querySelector('.ml-word') !== null);

// Words appear when page.ts wraps text, and change status through their class; other page changes do not matter.
new MutationObserver(records => {
  if (records.some(record => record.type === 'attributes' ? isWord(record.target)
    : [...record.addedNodes, ...record.removedNodes].some(hasWords))) schedule();
}).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

let enabled = false;
let wanted = false;
function update(): void {
  shown = enabled && wanted;
  if (shown) {
    CSS.highlights.set(NAME, highlight);
    refresh();
  } else {
    CSS.highlights.delete(NAME);
    highlight.clear();
  }
}

document.head.append(Object.assign(document.createElement('style'), { textContent: STYLE }));
wanted = await iPlusOne.get();
watchActive(on => { enabled = on; update(); });
iPlusOne.onChange(on => { wanted = on; update(); });
