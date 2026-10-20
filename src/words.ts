// The word spans of parsed text. A word that crosses text nodes (<b>食</b>べた) is one span per part; the parts share
// data-ml-word, and each part after the first has data-ml-cont, so counts take the word one time.
import type { NodeSegment } from './group.ts';
import { type Status, STATUSES } from './status.ts';

const STATUS_CLASSES = Object.values(STATUSES).map(s => s.className);

// Ruby annotation text is not page text for parse, sentences, or counts.
export const RUBY_TEXT = 'rt, rp';

export function setSpanStatus(span: HTMLElement, status: Status): void {
  span.classList.remove(...STATUS_CLASSES);
  span.classList.add(STATUSES[status].className);
}

// All the parts of the word of span, in page order.
export function wordParts(span: HTMLElement): HTMLElement[] {
  const id = span.dataset.mlWord;
  const root = span.getRootNode();
  if (id === undefined || !(root instanceof Document || root instanceof ShadowRoot)) return [span];
  return [...root.querySelectorAll<HTMLElement>(`.ml-word[data-ml-word="${CSS.escape(id)}"]`)];
}

export const sameWord = (a: HTMLElement, b: HTMLElement | null | undefined) =>
  a === b || (a.dataset.mlWord !== undefined && a.dataset.mlWord === b?.dataset.mlWord);

// The text of the word of span, across its parts.
export const wordText = (span: HTMLElement) => wordParts(span).map(part => part.textContent).join('');

let words = 0;

// The segments of one text node as text nodes and word spans. plain gets each text node, so page.ts can tell its own nodes
// from new page text. A word in page ruby gets no reading: the page shows one.
export function wordFragment(segments: NodeSegment[], statuses: Map<string, Status>, inRuby: boolean, plain: (node: Text) => void = () => {}): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (const { text, lemma, reading, part } of segments) {
    if (!lemma) {
      const node = document.createTextNode(text);
      plain(node);
      fragment.append(node);
      continue;
    }
    const span = document.createElement('span');
    span.className = 'ml-word';
    span.dataset.mlLemma = lemma;
    if (reading && !inRuby) span.dataset.mlReading = reading;
    if (part === 'first') words++;
    if (part) span.dataset.mlWord = String(words);
    if (part === 'rest') span.dataset.mlCont = '';
    span.textContent = text;
    setSpanStatus(span, statuses.get(lemma) ?? 'unknown');
    fragment.append(span);
  }
  return fragment;
}
