// Highlights the i+1 sentences (one unknown word) with the CSS Custom Highlight API, so the page DOM stays as it is.
import { blockOf } from '../shared/dom.ts';
import { iPlusOneSentences, type Piece } from '../text/sentence.ts';
import { statusOf } from '../status/status.ts';
import { iPlusOne } from '../shared/settings.ts';
import { watchActive } from './site.ts';
import { I_PLUS_ONE } from '../shared/design-tokens.ts';

const NAME = 'minerr-i1';
// A translucent yellow, like a highlighter pen: pale on a light page, olive on a dark page.
// The subtitle overlay is a dark box over moving video, so it gets a stronger yellow.
const STYLE = `
  ::highlight(${NAME}) { background-color: ${I_PLUS_ONE}; }
  .minerr-subs-line::highlight(${NAME}), .minerr-subs-line *::highlight(${NAME}) { background-color: rgba(250, 204, 21, 0.5); }
`;
const DELAY_MS = 150;

const highlight = new Highlight();
let shown = false;
let timer: ReturnType<typeof setTimeout> | null = null;

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

const byBlock = new Map<Element, Range[]>();
const changed = new Set<Element>();
// A pass over one huge block (a novel in one <div>) takes long, so the next pass waits this many times as long.
const IDLE_PER_PASS = 10;
let delay = DELAY_MS;

function highlightBlock(block: Element, cache: Map<Element, Element>): void {
  for (const range of byBlock.get(block) ?? []) highlight.delete(range);
  const next = block.isConnected ? ranges(block, cache) : [];
  if (next.length) byBlock.set(block, next);
  else byBlock.delete(block);
  for (const range of next) highlight.add(range);
}

function wordBlocks(cache: Map<Element, Element>): Set<Element> {
  const blocks = new Set<Element>();
  for (const span of document.querySelectorAll('.ml-word')) blocks.add(blockOf(span.parentElement ?? span, cache));
  return blocks;
}

function refreshChanged(): void {
  timer = null;
  if (!shown) return;
  const start = performance.now();
  const cache = new Map<Element, Element>();
  for (const block of byBlock.keys()) if (!block.isConnected) changed.add(block);
  for (const block of changed) highlightBlock(block, cache);
  changed.clear();
  delay = Math.max(DELAY_MS, IDLE_PER_PASS * (performance.now() - start));
}

// Recomputes every i+1 sentence of the document. Exported so a test can measure it.
export function refresh(): void {
  if (timer) clearTimeout(timer);
  highlight.clear();
  byBlock.clear();
  for (const block of wordBlocks(new Map())) changed.add(block);
  refreshChanged();
}

const isWord = (node: Node) => node instanceof Element && node.classList.contains('ml-word');
const hasWords = (node: Node) => isWord(node) || (node instanceof Element && node.querySelector('.ml-word') !== null);

// Words appear when page.ts wraps text, and change status through their class; other page changes do not matter.
new MutationObserver(records => {
  if (!shown) return;
  const cache = new Map<Element, Element>();
  for (const record of records) {
    const words = record.type === 'attributes' ? isWord(record.target) : [...record.addedNodes, ...record.removedNodes].some(hasWords);
    if (words && record.target instanceof Element) changed.add(blockOf(record.target, cache));
  }
  if (changed.size) timer ??= setTimeout(refreshChanged, delay);
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
watchActive(active => { enabled = active !== 'off'; update(); });
iPlusOne.onChange(on => { wanted = on; update(); });
