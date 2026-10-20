import type { Segment } from './group.ts';
import { call } from './rpc.ts';
import { getStatuses, onStatusChange, type Status, STATUSES, WORD_CSS } from './status.ts';
import { installFurigana } from './furigana.ts';
import { installPitchColors } from './pitch-colors.ts';
import { watchActive } from './site.ts';

const JAPANESE = /[぀-ヿ一-鿿]/;
// The YouTube caption window is hidden; src/subtitles.ts shows its text in an overlay.
const SKIP = 'script, style, noscript, textarea, input, select, svg, .ml-word, .ytp-caption-window-container';
const BATCH = 100;
const STATUS_CLASSES = Object.values(STATUSES).map(s => s.className);

// Plain text nodes we inserted between word spans; the observer sees them as additions and must not re-parse them.
const created = new WeakSet<Node>();
const pending = new Set<Text>();
let timer: ReturnType<typeof setTimeout> | null = null;

const isText = (node: Node): node is Text => node.nodeType === Node.TEXT_NODE;

function wanted(node: Text): boolean {
  const parent = node.parentElement;
  return parent !== null && !created.has(node) && JAPANESE.test(node.data)
    && !parent.isContentEditable && !parent.closest(SKIP);
}

function collect(root: Node): void {
  if (isText(root)) {
    if (wanted(root)) pending.add(root);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) if (isText(node) && wanted(node)) pending.add(node);
}

function setSpanStatus(span: HTMLElement, status: Status): void {
  span.classList.remove(...STATUS_CLASSES);
  span.classList.add(STATUSES[status].className);
}

function render(segments: Segment[], statuses: Map<string, Status>): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (const { text, lemma, reading } of segments) {
    if (!lemma) {
      const node = document.createTextNode(text);
      created.add(node);
      fragment.append(node);
      continue;
    }
    const span = document.createElement('span');
    span.className = 'ml-word';
    span.dataset.mlLemma = lemma;
    if (reading) span.dataset.mlReading = reading;
    span.textContent = text;
    setSpanStatus(span, statuses.get(lemma) ?? 'unknown');
    fragment.append(span);
  }
  return fragment;
}

async function wrap(nodes: Text[]): Promise<void> {
  const texts = nodes.map(node => node.data);
  const parsed = await call({ type: 'parse', texts });
  const lemmas = [...new Set(parsed.flat().flatMap(s => (s.lemma ? [s.lemma] : [])))];
  const statuses = await getStatuses(lemmas);
  nodes.forEach((node, i) => {
    const segments = parsed[i];
    // The page may have replaced or edited the node while the parse was in flight; the observer queued the new text.
    if (!segments || !node.isConnected || node.data !== texts[i] || !segments.some(s => s.lemma)) return;
    node.replaceWith(render(segments, statuses));
  });
}

async function flush(): Promise<void> {
  const nodes = [...pending];
  pending.clear();
  for (let i = 0; i < nodes.length; i += BATCH) {
    await wrap(nodes.slice(i, i + BATCH)).catch(error => console.warn('minerr parse failed', error));
  }
  timer = null;
  if (pending.size) schedule();
}

function schedule(): void {
  timer ??= setTimeout(flush, 50);
}

new MutationObserver(records => {
  for (const record of records) {
    if (record.type === 'characterData') {
      created.delete(record.target);
      collect(record.target);
    } else {
      record.addedNodes.forEach(collect);
    }
  }
  if (pending.size) schedule();
}).observe(document.body, { childList: true, subtree: true, characterData: true });

onStatusChange(changed => {
  for (const span of document.querySelectorAll<HTMLElement>('.ml-word')) {
    const status = changed.get(span.dataset.mlLemma ?? '');
    if (status) setSpanStatus(span, status);
  }
});

document.head.append(Object.assign(document.createElement('style'), { textContent: WORD_CSS }));
watchActive(active => document.documentElement.toggleAttribute('data-minerr-off', !active));
installFurigana();
installPitchColors();
collect(document.body);
schedule();
