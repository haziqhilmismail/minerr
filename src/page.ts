import { blockOf, isInline } from './dom.ts';
import { JAPANESE, splitSegments } from './group.ts';
import { installSentenceHover } from './sentence-hover.ts';
import { onStatusChange, WORD_CSS } from './status.ts';
import { parseWords, recolor, RUBY_TEXT, wordFragment } from './words.ts';
import { installFurigana } from './furigana.ts';
import { installPitchColors } from './pitch-colors.ts';
import { watchActive } from './site.ts';

// The YouTube caption window is hidden; src/subtitles.ts shows its text in an overlay.
const SKIP = `script, style, noscript, textarea, input, select, svg, .ml-word, .ytp-caption-window-container, ${RUBY_TEXT}`;
const BATCH = 100;

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

// The nodes in page order, cut into runs of text that reads as one: <ruby>暖<rt>あたた</rt></ruby>かくて is one run.
function runsOf(nodes: Text[]): Text[][] {
  const cache = new Map<Element, Element>();
  const sorted = [...nodes].sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  const runs: Text[][] = [];
  for (const node of sorted) {
    const run = runs.at(-1);
    const last = run?.at(-1);
    if (run && last && follows(last, node, cache)) run.push(node);
    else runs.push([node]);
  }
  return runs;
}

// Parses each run as one text, so a word that crosses nodes is one word, and puts the parts of the segments into the nodes.
async function wrap(runs: Text[][]): Promise<void> {
  const texts = runs.map(run => run.map(node => node.data));
  const { parsed, statuses } = await parseWords(texts.map(parts => parts.join('')));
  runs.forEach((run, i) => {
    const segments = parsed[i];
    if (!segments) return;
    // The page may have replaced or edited a node while the parse was in flight; the observer queued the new text,
    // and the other nodes of the run go again with it.
    if (run.some((node, j) => !node.isConnected || node.data !== texts[i]?.[j])) {
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

async function flush(): Promise<void> {
  const runs = runsOf([...pending]);
  pending.clear();
  for (let i = 0; i < runs.length; i += BATCH) {
    await wrap(runs.slice(i, i + BATCH)).catch(error => console.warn('minerr parse failed', error));
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

onStatusChange(changed => recolor(document, changed));

document.head.append(Object.assign(document.createElement('style'), { textContent: WORD_CSS }));
watchActive(active => document.documentElement.toggleAttribute('data-minerr-off', !active));
installFurigana();
installPitchColors();
installSentenceHover();
collect(document.body);
schedule();
