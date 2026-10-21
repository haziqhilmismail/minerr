// The word spans of parsed text. A word that crosses text nodes (<b>食</b>べた) is one span per part; the parts share
// data-ml-word, and each part after the first has data-ml-cont, so counts take the word one time.
// data-ml-lemma is the dictionary form for lookups. data-ml-key is the status key (src/text/entry.ts) when it is not the lemma,
// and data-ml-headword and data-ml-headword-reading name the dictionary entry.
import type { NodeSegment, Segment } from './group.ts';
import { call } from '../shared/rpc.ts';
import { getStatuses, type Status, STATUSES, type WordId } from '../status/status.ts';

const STATUS_CLASSES = Object.values(STATUSES).map(s => s.className);

// Ruby annotation text is not page text for parse, sentences, or counts.
export const RUBY_TEXT = 'rt, rp';

export function setSpanStatus(span: HTMLElement, status: Status): void {
  span.classList.remove(...STATUS_CLASSES);
  span.classList.add(STATUSES[status].className);
}

// The status key of a word: the key of its dictionary entry, or else its lemma.
export const segmentWord = ({ lemma = '', entry }: Segment): WordId => entry ?? { key: lemma };

// The word of a span, as wordFragment wrote it.
export const wordOf = (span: HTMLElement): WordId => ({ key: span.dataset.mlKey ?? span.dataset.mlLemma ?? '' });

// Parses texts, and reads the statuses of their words.
export async function parseWords(texts: string[]): Promise<{ parsed: Segment[][]; statuses: Map<string, Status> }> {
  const parsed = await call({ type: 'parse', texts });
  const statuses = await getStatuses(parsed.flat().flatMap(segment => (segment.lemma ? [segmentWord(segment)] : [])));
  return { parsed, statuses };
}

// Gives the word spans under root the status that changed for their key.
export function recolor(root: ParentNode, changed: Map<string, Status>): void {
  for (const span of root.querySelectorAll<HTMLElement>('.ml-word')) {
    const status = changed.get(wordOf(span).key);
    if (status) setSpanStatus(span, status);
  }
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
  for (const segment of segments) {
    const { text, lemma, reading, entry, part } = segment;
    if (!lemma) {
      const node = document.createTextNode(text);
      plain(node);
      fragment.append(node);
      continue;
    }
    const span = document.createElement('span');
    span.className = 'ml-word';
    span.dataset.mlLemma = lemma;
    const word = segmentWord(segment);
    if (word.key !== lemma) span.dataset.mlKey = word.key;
    if (entry) Object.assign(span.dataset, { mlHeadword: entry.headword, mlHeadwordReading: entry.reading });
    if (reading && !inRuby) span.dataset.mlReading = reading;
    if (part === 'first') words++;
    if (part) span.dataset.mlWord = String(words);
    if (part === 'rest') span.dataset.mlCont = '';
    span.textContent = text;
    setSpanStatus(span, statuses.get(word.key) ?? 'unknown');
    fragment.append(span);
  }
  return fragment;
}
