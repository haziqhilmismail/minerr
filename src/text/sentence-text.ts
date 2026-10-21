// The text around a range of the page, out to the ends of its sentence. The sentence highlight and the card sentence use it.
// The walk goes from the range outward and stops at a sentence end or a <br>, so a long block with many lines stays fast.
// Ruby text (rt, rp) is not part of the sentence.
import { blockOf } from '../shared/dom.ts';
import { RUBY_TEXT } from './word-spans.ts';

const END = /[。｡！!？?\n]/;
// A sentence end, its closing quotes, and one more character: the sentence after the range is complete.
const PAST_END = /[。｡！!？?\n][」』）)〉］\]]*[^」』）)〉］\]]/;
// ponytail: text with no sentence end gets cut at this many characters on each side of the range.
const MAX_SIDE = 1000;

export interface SentenceText {
  nodes: Text[];
  // The offset in text of each node.
  starts: number[];
  text: string;
  // The offsets in text of the start and the end of the range.
  from: number;
  to: number;
}

// Where the boundary point (container, offset) falls in the text of node: 0 if the point is before node, its length if after.
function cutAt(node: Text, container: Node, offset: number): number {
  if (node === container) return offset;
  const point = new Range();
  point.setStart(container, offset);
  return point.comparePoint(node, 0) > 0 ? 0 : node.length;
}

// The range from the first text of first to the last text of last. Text nodes as the containers keep the walk short.
export function wordRange(first: Element, last: Element): Range {
  const range = new Range();
  const start = document.createTreeWalker(first, NodeFilter.SHOW_TEXT).nextNode();
  const walker = document.createTreeWalker(last, NodeFilter.SHOW_TEXT);
  let end: Node | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) end = node;
  if (start) range.setStart(start, 0);
  else range.setStartBefore(first);
  if (end instanceof Text) range.setEnd(end, end.length);
  else range.setEndAfter(last);
  return range;
}

export function sentenceText(range: Range): SentenceText {
  const { startContainer, startOffset, endContainer, endOffset } = range;
  const element = startContainer instanceof Element ? startContainer : startContainer.parentElement ?? document.body;
  const walker = document.createTreeWalker(blockOf(element), NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: node => !(node instanceof Element) || node.tagName === 'BR' ? NodeFilter.FILTER_ACCEPT
      : node.matches(RUBY_TEXT) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP,
  });
  const before: Text[] = [];
  let length = 0;
  walker.currentNode = startContainer;
  for (let node = walker.previousNode(); node instanceof Text && length < MAX_SIDE; node = walker.previousNode()) {
    before.push(node);
    length += node.length;
    if (END.test(node.data)) break;
  }
  const nodes = [...before.reverse()];
  let after = '';
  const add = (node: Text) => {
    nodes.push(node);
    after += node.data.slice(cutAt(node, endContainer, endOffset));
  };
  if (startContainer instanceof Text) add(startContainer);
  walker.currentNode = startContainer;
  for (let node = walker.nextNode(); node instanceof Text && after.length < MAX_SIDE && !PAST_END.test(after); node = walker.nextNode()) add(node);
  const starts: number[] = [];
  let text = '';
  let from = 0;
  let to = 0;
  for (const node of nodes) {
    starts.push(text.length);
    const start = cutAt(node, startContainer, startOffset);
    from += start;
    to += Math.max(start, cutAt(node, endContainer, endOffset));
    text += node.data;
  }
  return { nodes, starts, text, from, to };
}
