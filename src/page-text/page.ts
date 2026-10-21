import { blockOf, isInline } from '../shared/dom.ts';
import { JAPANESE, splitSegments } from '../text/group.ts';
import { installSentenceHover } from './sentence-hover.ts';
import { onStatusChange, WORD_CSS } from '../status/status.ts';
import { parseWords, recolor, RUBY_TEXT, wordFragment } from '../text/word-spans.ts';
import { installFurigana } from './furigana.ts';
import { installPitchColors } from './pitch-colors.ts';
import { wordJoins } from '../shared/settings.ts';
import { VIDEO, watchActive } from './site.ts';

// The YouTube caption window is hidden; src/video/youtube/youtube-overlay.ts shows its text in an overlay.
const SKIP = `script, style, noscript, textarea, input, select, svg, .ml-word, .ytp-caption-window-container, ${RUBY_TEXT}`;
const BATCH = 100;

// Plain text nodes we inserted between word spans; the observer sees them as additions and must not re-parse them.
const created = new WeakSet<Node>();
// The page text is off until the user turns it on for the site; the text of the subtitle overlay is always read.
let pageOn = false;
let started = false;
// The first walk of the page finds its nodes in page order. The observer finds nodes in any order, so only they get sorted.
let ordered: Text[] = [];
const pending = new Set<Text>();
// A task that runs longer than this gives the page a turn, so a big page does not freeze while Minerr reads it.
const TASK_MS = 20;
const nextTask = () => new Promise(resolve => setTimeout(resolve));
let timer: ReturnType<typeof setTimeout> | null = null;

const isText = (node: Node): node is Text => node.nodeType === Node.TEXT_NODE;

function wanted(node: Text): boolean {
  const parent = node.parentElement;
  return parent !== null && !created.has(node) && JAPANESE.test(node.data)
    && !parent.isContentEditable && !parent.closest(SKIP) && (pageOn || parent.closest(VIDEO) !== null);
}

function collect(root: Node, keep: (node: Text) => void = node => pending.add(node)): void {
  if (isText(root)) {
    if (wanted(root)) keep(root);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) if (isText(node) && wanted(node)) keep(node);
}

// True if text node b follows text node a in the text flow: no other text (ruby annotation aside), no line break,
// image, or button, and no block between them.
const BREAKS = /^(BR|IMG|BUTTON)$/;
function follows(a: Text, b: Text, cache: Map<Element, Element>): boolean {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  walker.currentNode = a;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node === b) return a.parentElement !== null && b.parentElement !== null && blockOf(a.parentElement, cache) === blockOf(b.parentElement, cache);
    if (node instanceof Element ? BREAKS.test(node.tagName) || !(isInline(node) || node.closest(RUBY_TEXT)) : !node.parentElement?.closest(RUBY_TEXT)) return false;
  }
  return false;
}

// Nodes in page order, cut into runs of text that reads as one: <ruby>暖<rt>あたた</rt></ruby>かくて is one run.
async function runsOf(sorted: Text[], cache: Map<Element, Element>): Promise<Text[][]> {
  const runs: Text[][] = [];
  let since = performance.now();
  for (const node of sorted) {
    const run = runs.at(-1);
    const last = run?.at(-1);
    if (run && last && follows(last, node, cache)) run.push(node);
    else runs.push([node]);
    if (performance.now() - since > TASK_MS) {
      await nextTask();
      since = performance.now();
    }
  }
  return runs;
}

const inPageOrder = (nodes: Text[]) => nodes.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));

// Parses each run as one text, so a word that crosses nodes is one word, and puts the parts of the segments into the nodes.
async function wrap(runs: Text[][]): Promise<void> {
  const texts = runs.map(run => run.map(node => node.data));
  const { parsed, statuses } = await parseWords(texts.map(parts => parts.join('')));
  runs.forEach((run, i) => {
    const segments = parsed[i];
    if (!segments) return;
    // The page may have replaced or edited a node while the parse was in flight; the observer queued the new text,
    // and the other nodes of the run go again with it.
    if (run.some((node, j) => !node.isConnected || node.data !== texts[i]?.[j] || !wanted(node))) {
      for (const node of run) if (node.isConnected && wanted(node)) pending.add(node);
      schedule();
      return;
    }
    const parts = splitSegments(segments, run.map(node => node.data.length));
    run.forEach((node, j) => {
      const own = parts[j] ?? [];
      if (own.some(s => s.lemma)) node.replaceWith(wordFragment(own, statuses, node.parentElement?.closest('ruby') != null, text => created.add(text)));
    });
  });
}

// True for a node whose block is on the screen or within one screen of it.
function nearViewport(cache: Map<Element, Element>): (node: Text) => boolean {
  const rects = new Map<Element, DOMRect>();
  return node => {
    const parent = node.parentElement;
    if (!parent) return false;
    const block = blockOf(parent, cache);
    const rect = rects.get(block) ?? block.getBoundingClientRect();
    rects.set(block, rect);
    return rect.bottom >= -innerHeight && rect.top <= 2 * innerHeight;
  };
}

const nearFirst = <T>(items: T[], near: (item: T) => boolean): T[] => [...items.filter(near), ...items.filter(item => !near(item))];

// Parses the runs in batches. at is the scroll position of the last order; after a scroll, the runs near the viewport go first.
// The rects are read after a scroll only, because a read after each batch forced a layout of the page after each batch.
// ponytail: scrollY sees the window only, so a page that scrolls inside an element keeps page order; a scroll listener on
// document in the capture phase would see the inner scroll too.
async function wrapAll(runs: Text[][], cache: Map<Element, Element>, at: number): Promise<void> {
  let left = runs;
  while (left.length) {
    if (scrollY !== at) {
      at = scrollY;
      const near = nearViewport(cache);
      left = nearFirst(left, run => run.some(near));
    }
    await wrap(left.slice(0, BATCH)).catch(error => console.warn('minerr parse failed', error));
    left = left.slice(BATCH);
  }
}

async function flush(): Promise<void> {
  const lists = [ordered, inPageOrder([...pending])];
  ordered = [];
  pending.clear();
  const cache = new Map<Element, Element>();
  const at = scrollY;
  const near = nearViewport(cache);
  // The nodes near the viewport go first, as lists of their own, so their words show before the runs of the rest are cut.
  // A run never crosses blocks (follows), so a cut by block keeps every run whole.
  const parts = [...lists.map(list => list.filter(near)), ...lists.map(list => list.filter(node => !near(node)))];
  for (const list of parts) await wrapAll(await runsOf(list, cache), cache, at);
  timer = null;
  if (pending.size || ordered.length) schedule();
}

// The observer waits this long for the burst of a page change to end; the first walk of a page has its nodes already.
const BURST_MS = 50;
function schedule(delay = BURST_MS): void {
  timer ??= setTimeout(flush, delay);
}

// Gives root its text back: each word span becomes text, and the text nodes that we made merge again, so a word that the
// next parse joins is in one node. Only our nodes merge. No normalize(): it would merge or delete text nodes that the page
// owns, and frameworks such as Vue keep empty text nodes as anchors. keep: the nodes that stay as they are.
function unwrap(root: Element, keep: (node: Node) => boolean = () => false): void {
  const ours = new Set<Text>();
  for (const span of root.querySelectorAll('.ml-word')) {
    if (keep(span)) continue;
    const text = document.createTextNode(span.textContent ?? '');
    span.replaceWith(text);
    ours.add(text);
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) if (isText(node) && created.has(node) && !keep(node)) ours.add(node);
  for (const node of ours) {
    for (let next = node.nextSibling; node.isConnected && next instanceof Text && ours.has(next); next = node.nextSibling) {
      node.appendData(next.data);
      next.remove();
    }
    // The text is page text again, for the next parse.
    created.delete(node);
  }
}

const inVideo = (node: Node) => node.parentElement?.closest(VIDEO) != null;

// Parses again the blocks with the text of a word override that the user added or removed, so the page shows the change.
function reparse(texts: string[]): void {
  const cache = new Map<Element, Element>();
  const blocks = new Map<Element, boolean>();
  for (const span of document.querySelectorAll('.ml-word')) {
    const block = blockOf(span, cache);
    if (!blocks.has(block)) blocks.set(block, texts.some(text => block.textContent?.includes(text)));
  }
  for (const [block, changed] of blocks) {
    if (!changed) continue;
    unwrap(block);
    collect(block);
  }
  schedule();
}

let joins: string[] | null = null;
wordJoins.watch(next => {
  const before = joins;
  joins = next;
  if (before) reparse([...next.filter(word => !before.includes(word)), ...before.filter(word => !next.includes(word))]);
});

new MutationObserver(records => {
  for (const record of records) {
    if (record.type === 'characterData') {
      created.delete(record.target);
      collect(record.target);
    } else {
      record.addedNodes.forEach(node => collect(node));
    }
  }
  if (pending.size) schedule();
}).observe(document.body, { childList: true, subtree: true, characterData: true });

onStatusChange(changed => recolor(document, changed));

document.head.append(Object.assign(document.createElement('style'), { textContent: WORD_CSS }));
watchActive(active => {
  document.documentElement.toggleAttribute('data-minerr-off', active === 'off');
  const was = pageOn;
  pageOn = active === 'on';
  // The first call also reads an overlay that was on the page before this module.
  if (!started || (pageOn && !was)) {
    started = true;
    collect(document.body, node => ordered.push(node));
    schedule(0);
  }
  // When the page text goes off, no word spans stay outside the subtitle overlay.
  if (active === 'video') unwrap(document.body, inVideo);
});
installFurigana();
installPitchColors();
installSentenceHover();
