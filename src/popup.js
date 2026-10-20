import { definitionHtml, escapeHtml } from './anki.js';
import { call } from './rpc.js';
import { sentenceAround } from './sentence.js';
import { getStatuses, onStatusChange, setStatus, STATUSES } from './status.js';
import { isEnabled, onEnabledChange, setEnabled } from './switch.js';
import { TAG_CSS, tagClass } from './tags.js';

const POWER_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 3v8"/><path d="M6.3 6.8a8 8 0 1 0 11.4 0"/></svg>';

const STYLE = `
  .popup {
    --bg: #ffffff; --raised: #f1f2f6; --text: #1c1d24; --muted: #646775; --line: #e1e2ea;
    --accent: #2c4bb8; --on-accent: #ffffff; --ok: #1d7a36; --error: #c22a2a;
    position: fixed; z-index: 2147483647; display: flex; flex-direction: column; box-sizing: border-box;
    width: 380px; max-width: calc(100vw - 8px); max-height: min(60vh, 480px); overflow: hidden;
    border: 1px solid var(--line); border-top: 3px solid var(--status, var(--line)); border-radius: 10px;
    background: var(--bg); color: var(--text); color-scheme: light; text-align: left;
    font: 14px/1.5 "Hiragino Sans", "Yu Gothic UI", "Meiryo", "Noto Sans JP", system-ui, sans-serif;
    box-shadow: 0 14px 36px rgba(20, 24, 50, .2), 0 2px 6px rgba(20, 24, 50, .08);
  }
  @media (prefers-color-scheme: dark) {
    .popup {
      --bg: #1f2027; --raised: #2b2c35; --text: #ecedf2; --muted: #a3a5b3; --line: #393a46;
      --accent: #7c93f2; --on-accent: #10173a; --ok: #74d68f; --error: #ff8f8f;
      color-scheme: dark; box-shadow: 0 14px 36px rgba(0, 0, 0, .55);
    }
  }
  .popup[hidden] { display: none; }
  header { padding: 12px 16px; border-bottom: 1px solid var(--line); }
  .title { display: flex; flex-wrap: wrap; align-items: baseline; column-gap: 10px; row-gap: 2px; }
  .title .tags { font-size: 15px; }
  .lemma { font-size: 28px; font-weight: 700; line-height: 1.25; }
  header { position: relative; }
  .title { padding-right: 64px; }
  .corner { position: absolute; top: 8px; right: 8px; display: flex; gap: 2px; }
  .corner button { width: 28px; height: 28px; padding: 0; border: 0; border-radius: 6px; background: transparent;
    color: var(--muted); font: inherit; font-size: 16px; line-height: 28px; cursor: pointer; }
  .corner svg { vertical-align: -3px; }
  .corner button:hover { background: var(--raised); color: var(--text); }
  .reading { font-size: 16px; color: var(--muted); }
  .surface { font-size: 12px; color: var(--muted); }
  .statuses { display: grid; grid-template-columns: repeat(4, 1fr); gap: 2px; margin-top: 10px; padding: 3px;
    border-radius: 8px; background: var(--raised); }
  button { font: inherit; color: inherit; cursor: pointer; }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .statuses button { padding: 5px 2px; border: 0; border-radius: 6px; background: none; color: var(--muted);
    font-size: 12px; white-space: nowrap; }
  .statuses button:hover { color: var(--text); }
  .statuses button[aria-pressed="true"] { background: var(--bg); color: var(--text); font-weight: 700;
    box-shadow: 0 0 0 1px var(--line), 0 1px 3px rgba(0, 0, 0, .12); }
  .dot { display: inline-block; width: 8px; height: 8px; margin-right: 5px; border-radius: 50%; vertical-align: 1px; }
  kbd { display: inline-block; min-width: 16px; box-sizing: border-box; padding: 0 3px; border: 1px solid currentColor;
    border-radius: 4px; font: 600 10px/14px system-ui, sans-serif; text-align: center; opacity: .7; }
  .definitions { flex: 1 1 auto; min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 12px 16px 4px; }
  ol { margin: 0; padding-left: 22px; }
  li { margin-bottom: 12px; white-space: pre-line; }
  li::marker { color: var(--muted); font-size: 12px; }
  .group { margin: 4px 0 8px; padding-top: 10px; border-top: 1px solid var(--line); }
  .group .word { font-size: 16px; font-weight: 700; }
  .group .reading { margin: 0 8px 0 6px; font-size: 14px; }
  .dict { width: fit-content; margin-top: 4px; padding: 0 7px; border-radius: 4px; background: var(--raised);
    color: var(--muted); font-size: 11px; line-height: 18px; }
  ${TAG_CSS}
  .empty { margin: 0 0 8px; color: var(--muted); }
  footer { padding: 10px 16px 12px; border-top: 1px solid var(--line); }
  .add { width: 100%; padding: 8px 12px; border: 0; border-radius: 8px; background: var(--accent); color: var(--on-accent);
    font-weight: 700; }
  .add:hover { filter: brightness(1.08); }
  .add:disabled { cursor: progress; opacity: .65; filter: none; }
  .message { margin-top: 8px; font-size: 12px; font-weight: 600; color: var(--ok); }
  .message:empty { display: none; }
  .message.error { color: var(--error); }
`;

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function blockAncestor(node) {
  let element = node.parentElement;
  while (element.parentElement && /^(inline|contents)/.test(getComputedStyle(element).display)) {
    element = element.parentElement;
  }
  return element;
}

// The sentence around the word inside its nearest block ancestor, with the word in <b>.
function sentenceHtml(span) {
  const block = blockAncestor(span);
  const range = document.createRange();
  range.selectNodeContents(block);
  range.setEndBefore(span);
  const before = range.toString();
  range.selectNodeContents(block);
  range.setStartAfter(span);
  const { start, word, end } = sentenceAround(before, span.textContent, range.toString());
  return `${escapeHtml(start)}<b>${escapeHtml(word)}</b>${escapeHtml(end)}`;
}

const host = document.createElement('minerr-popup');
host.style.cssText = 'all: initial; position: fixed; top: 0; left: 0; z-index: 2147483647;';
const shadow = host.attachShadow({ mode: 'open' });
const box = el('div', { className: 'popup', hidden: true });
shadow.append(el('style', { textContent: STYLE }), box);

let current = null;
let message = null;
let addButton = null;
const statusButtons = new Map();

function showMessage(text, isError = false) {
  message.textContent = text;
  message.className = isError ? 'message error' : 'message';
}

function markStatus(status) {
  for (const [name, button] of statusButtons) button.setAttribute('aria-pressed', String(name === status));
  box.style.setProperty('--status', STATUSES[status].color);
}

// Keeps the word highlighted while the mouse is on the popup, so the user sees which word it belongs to.
function markActive(span) {
  document.querySelector('.ml-word[data-ml-active]')?.removeAttribute('data-ml-active');
  span?.setAttribute('data-ml-active', '');
}

const addLabel = () => ['Add to Anki ', el('kbd', { textContent: 'A' })];

function position(span) {
  const rect = span.getBoundingClientRect();
  // Fit the popup on the roomier side of the word so it never covers the word; the definitions scroll instead.
  box.style.maxHeight = `min(60vh, 480px, ${Math.max(rect.top, innerHeight - rect.bottom) - 12}px)`;
  const below = rect.bottom + 6;
  const top = below + box.offsetHeight > innerHeight ? Math.max(4, rect.top - box.offsetHeight - 6) : below;
  box.style.top = `${top}px`;
  box.style.left = `${Math.max(4, Math.min(rect.left, innerWidth - box.offsetWidth - 4))}px`;
}

// Each chip is followed by a space, so the chips wrap like words.
const chips = tags => tags.flatMap(({ name, category, notes }) => [el('span', { className: tagClass(category), title: notes, textContent: name }), ' ']);

// One dictionary label closes each run of senses from the same dictionary.
const senseList = senses => el('ol', {}, ...senses.map((sense, i) => el('li', {}, ...chips(sense.tags), sense.glossary.join('\n'),
  sense.dict === senses[i + 1]?.dict ? '' : el('div', { className: 'dict', textContent: sense.dict }))));

function render(view) {
  const { lemma, groups } = view;
  const [first, ...others] = groups;
  const reading = first?.reading ?? '';
  const surface = view.span.textContent;
  statusButtons.clear();
  const statusRow = el('div', { className: 'statuses', role: 'group', ariaLabel: 'Word status' },
    ...Object.entries(STATUSES).map(([status, { hotkey, label, color }]) => {
      const dot = el('span', { className: 'dot' });
      dot.style.background = color;
      const button = el('button', { onclick: () => setStatus(lemma, status) }, dot, `${label} `, el('kbd', { textContent: hotkey }));
      statusButtons.set(status, button);
      return button;
    }));
  // Other readings or spellings of the lemma follow the first group, each under its own heading.
  const definitions = first
    ? [senseList(first.senses), ...others.flatMap(group => [
      el('div', { className: 'group' },
        el('span', { className: 'word', textContent: group.expression }),
        el('span', { className: 'reading', textContent: group.reading }),
        ...chips(group.termTags)),
      senseList(group.senses),
    ])]
    : [el('p', { className: 'empty', textContent: 'No dictionary entry. Import a dictionary in the options page.' })];
  addButton = el('button', { className: 'add', onclick: addCard }, ...addLabel());
  message = el('div', { className: 'message', role: 'status' });
  box.replaceChildren(
    el('header', {},
      el('div', { className: 'title' },
        el('span', { className: 'lemma', textContent: lemma }),
        reading !== lemma ? el('span', { className: 'reading', textContent: reading }) : '',
        first?.termTags.length ? el('span', { className: 'tags' }, ...chips(first.termTags)) : ''),
      surface !== lemma ? el('div', { className: 'surface', textContent: `On the page: ${surface}` }) : '',
      statusRow,
      el('div', { className: 'corner' },
        el('button', { className: 'off', innerHTML: POWER_ICON, title: 'Turn Minerr off in all tabs (Alt+Shift+M turns it on)', ariaLabel: 'Turn Minerr off', onclick: () => setEnabled(false) }),
        el('button', { className: 'close', textContent: '✕', title: 'Close (Esc)', ariaLabel: 'Close', onclick: close }))),
    el('div', { className: 'definitions' }, ...definitions),
    el('footer', {}, addButton, message),
  );
  markStatus(view.status);
}

async function open(span) {
  const view = { span, lemma: span.dataset.mlLemma, status: 'unknown', groups: [] };
  current = view;
  let groups;
  try {
    [groups, view.status] = await Promise.all([
      call({ type: 'lookup', lemma: view.lemma }),
      getStatuses([view.lemma]).then(statuses => statuses.get(view.lemma)),
    ]);
  } catch (error) {
    groups = [];
    console.warn('minerr lookup failed', error);
  }
  if (current !== view) return;
  view.groups = groups;
  (document.fullscreenElement ?? document.documentElement).append(host);
  render(view);
  box.hidden = false;
  position(span);
  markActive(span);
}

function close() {
  current = null;
  box.hidden = true;
  markActive(null);
}

const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));

async function addCard() {
  const view = current;
  const button = addButton;
  if (!view || button.disabled) return;
  const card = {
    word: view.lemma,
    reading: view.groups[0]?.reading ?? '',
    sentence: sentenceHtml(view.span),
    definition: definitionHtml(view.groups[0]),
  };
  button.disabled = true;
  button.replaceChildren('Adding to Anki…');
  host.style.visibility = 'hidden';
  await nextFrame();
  await nextFrame();
  try {
    await call({ type: 'addCard', card });
    if (current === view) showMessage('Added to Anki.');
  } catch (error) {
    if (current === view) showMessage(error.message, true);
  } finally {
    host.style.visibility = '';
    button.disabled = false;
    button.replaceChildren(...addLabel());
  }
}

const isEditable = target => target instanceof HTMLElement
  && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

const HOTKEYS = {
  ...Object.fromEntries(Object.entries(STATUSES).map(([status, { hotkey }]) => [hotkey, () => setStatus(current.lemma, status)])),
  a: addCard,
  Escape: close,
};

let enabled = true;
isEnabled().then(value => { enabled = value; });
onEnabledChange(value => {
  enabled = value;
  if (!enabled) close();
});

document.addEventListener('mouseover', event => {
  const span = event.target.closest?.('.ml-word');
  if (enabled && span && span !== current?.span) open(span);
});

document.addEventListener('mousedown', event => {
  if (current && event.target !== host && !event.target.closest?.('.ml-word')) close();
});

// Capture on window so page shortcuts (YouTube uses 1-4 to seek) do not also fire.
window.addEventListener('keydown', event => {
  if (!current || box.hidden || event.ctrlKey || event.metaKey || event.altKey || isEditable(event.target)) return;
  const action = HOTKEYS[event.key.length === 1 ? event.key.toLowerCase() : event.key];
  if (!action) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  action();
}, true);

onStatusChange(changed => {
  if (current && changed.has(current.lemma)) markStatus(changed.get(current.lemma));
});
