import { call } from './rpc.js';
import { getStatuses, onStatusChange, STATUSES, WORD_CSS } from './status.js';
import { isEnabled, onEnabledChange } from './switch.js';

const JAPANESE = /[぀-ヿ一-鿿]/;
const SKIP = 'script, style, noscript, textarea, input, select, svg, .ml-word';
const BATCH = 100;
const STATUS_CLASSES = Object.values(STATUSES).map(s => s.className);

// Plain text nodes we inserted between word spans; the observer sees them as additions and must not re-parse them.
const created = new WeakSet();
const pending = new Set();
let timer = null;

function wanted(node) {
  const parent = node.parentElement;
  return Boolean(parent) && !created.has(node) && JAPANESE.test(node.data)
    && !parent.isContentEditable && !parent.closest(SKIP);
}

function collect(root) {
  if (root.nodeType === Node.TEXT_NODE) {
    if (wanted(root)) pending.add(root);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) if (wanted(node)) pending.add(node);
}

function setSpanStatus(span, status) {
  span.classList.remove(...STATUS_CLASSES);
  span.classList.add(STATUSES[status].className);
}

function render(segments, statuses) {
  const fragment = document.createDocumentFragment();
  for (const { text, lemma } of segments) {
    if (!lemma) {
      const node = document.createTextNode(text);
      created.add(node);
      fragment.append(node);
      continue;
    }
    const span = document.createElement('span');
    span.className = 'ml-word';
    span.dataset.mlLemma = lemma;
    span.textContent = text;
    setSpanStatus(span, statuses.get(lemma));
    fragment.append(span);
  }
  return fragment;
}

async function wrap(nodes) {
  const texts = nodes.map(node => node.data);
  const parsed = await call({ type: 'parse', texts });
  const lemmas = [...new Set(parsed.flat().filter(s => s.lemma).map(s => s.lemma))];
  const statuses = await getStatuses(lemmas);
  nodes.forEach((node, i) => {
    // The page may have replaced or edited the node while the parse was in flight; the observer queued the new text.
    if (!node.isConnected || node.data !== texts[i] || !parsed[i].some(s => s.lemma)) return;
    node.replaceWith(render(parsed[i], statuses));
  });
}

async function flush() {
  const nodes = [...pending];
  pending.clear();
  for (let i = 0; i < nodes.length; i += BATCH) {
    await wrap(nodes.slice(i, i + BATCH)).catch(error => console.warn('minerr parse failed', error));
  }
  timer = null;
  if (pending.size) schedule();
}

function schedule() {
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
  for (const span of document.querySelectorAll('.ml-word')) {
    const status = changed.get(span.dataset.mlLemma);
    if (status) setSpanStatus(span, status);
  }
});

document.head.append(Object.assign(document.createElement('style'), { textContent: WORD_CSS }));
const showEnabled = enabled => document.documentElement.toggleAttribute('data-minerr-off', !enabled);
isEnabled().then(showEnabled);
onEnabledChange(showEnabled);
collect(document.body);
schedule();
