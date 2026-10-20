import { setStatus, type Status, STATUS_NAMES, STATUSES, WORD_CSS, type WordId } from './status.ts';
import { minerrEnabled } from './settings.ts';
import { TAG_CSS, tagClass } from './tags.ts';
import { applyTheme } from './theme.ts';
import { PRIMARY_BUTTON, TOKENS } from './tokens.ts';
import { wordText } from './words.ts';
import { type Entry, entryStars, highs, morae, PITCH, pitchPattern } from './meta.ts';
import type { Sense, Tag } from './yomitan.ts';

const POWER_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 3v8"/><path d="M6.3 6.8a8 8 0 1 0 11.4 0"/></svg>';

const STYLE = `
  :host { ${TOKENS} }
  .popup {
    position: fixed; z-index: 2147483647; display: flex; flex-direction: column; box-sizing: border-box;
    width: 380px; max-width: calc(100vw - 8px); max-height: min(60vh, 480px); overflow: hidden;
    border: 1px solid var(--line); border-radius: var(--radius-m);
    background: var(--card); color: var(--text); color-scheme: light dark; text-align: left;
    font: 14px/1.5 var(--font-ui);
    box-shadow: inset 0 4px 0 var(--status, transparent), var(--shadow-3), var(--shadow-1);
  }
  .popup[data-theme="light"] { color-scheme: light; }
  .popup[data-theme="dark"] { color-scheme: dark; }
  header { position: relative; padding: 14px 16px 12px; border-bottom: 1px solid var(--line); }
  .title { display: flex; flex-wrap: wrap; align-items: baseline; column-gap: 10px; row-gap: 2px; padding-right: 72px; }
  .title .tags { font-size: 15px; }
  .lemma { font: 700 28px/1.25 var(--font-jp); }
  .corner { position: absolute; top: 8px; right: 8px; display: flex; gap: 4px; }
  .corner button { display: grid; place-items: center; width: 32px; height: 32px; padding: 0; border: 0; border-radius: 50%;
    background: transparent; color: var(--muted); font-size: 15px; }
  .corner button:hover { background: var(--raised); color: var(--text); }
  .reading { font: 16px/1.5 var(--font-jp); color: var(--muted); }
  .surface { font-size: 12px; color: var(--muted); }
  .statuses { display: grid; grid-template-columns: repeat(4, 1fr); gap: 2px; margin-top: 12px; padding: 3px;
    border-radius: var(--radius-pill); background: var(--raised); }
  button { font: inherit; color: inherit; cursor: pointer; }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .statuses button { min-height: 32px; padding: 4px 2px; border: 0; border-radius: var(--radius-pill); background: none;
    color: var(--muted); font-size: 12px; font-weight: 600; white-space: nowrap; }
  .statuses button:hover { color: var(--text); }
  .statuses button[aria-pressed="true"] { background: var(--card); color: var(--text); font-weight: 700; box-shadow: var(--shadow-1); }
  .dot { display: inline-block; width: 8px; height: 8px; margin-right: 5px; border-radius: 50%; vertical-align: 1px; }
  kbd { display: inline-block; min-width: 16px; box-sizing: border-box; padding: 0 3px; border: 1px solid currentColor;
    border-radius: 4px; font: 600 10px/14px var(--font-ui); text-align: center; opacity: .7; }
  .definitions { flex: 1 1 auto; min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 12px 16px 4px; }
  ol { margin: 0; padding-left: 22px; }
  li { margin-bottom: 12px; white-space: pre-line; }
  li::marker { color: var(--accent); font-size: 12px; font-weight: 700; }
  .group { margin: 4px 0 8px; padding-top: 10px; border-top: 1px solid var(--line); }
  .group .word { font: 700 16px/1.5 var(--font-jp); }
  .group .reading { margin: 0 8px 0 6px; font-size: 14px; }
  .dict { width: fit-content; margin-top: 4px; padding: 0 8px; border-radius: var(--radius-pill); background: var(--raised);
    color: var(--muted); font-size: 11px; line-height: 18px; }
  ${TAG_CSS}
  ${WORD_CSS}
  .empty { margin: 0 0 8px; color: var(--muted); }
  .meta { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 12px; margin-top: 4px; font-size: 12px; color: var(--muted); }
  .group .meta { margin: 2px 0 0; }
  .stars { color: var(--star); font-size: 13px; letter-spacing: 1px; }
  .freq b { color: var(--text); font-weight: 600; }
  .pitch { display: inline-flex; align-items: baseline; gap: 6px; }
  .morae { font-size: 14px; color: var(--text); }
  .mora { display: inline-block; padding-top: 1px; border-top: 1.5px solid transparent; }
  .mora.high { border-top-color: currentColor; }
  .mora.drop { border-right: 1.5px solid currentColor; }
  .pattern { font-weight: 600; }
  .toast { position: fixed; left: 50%; bottom: 56px; transform: translateX(-50%); z-index: 1; max-width: calc(100vw - 32px);
    padding: 8px 18px; border-radius: var(--radius-pill); background: color-mix(in srgb, var(--bg) 94%, transparent);
    color: var(--text); color-scheme: dark; text-align: center; font: 600 14px/1.5 var(--font-ui); box-shadow: var(--shadow-2); pointer-events: none; }
  .toast[hidden] { display: none; }
  footer { padding: 12px 16px 14px; border-top: 1px solid var(--line); }
  .actions { display: flex; gap: 8px; }
  .add, .edit { min-height: 36px; padding: 8px 16px; border: 0; border-radius: var(--radius-pill); font-weight: 700; }
  .add { flex: 1; }
  ${PRIMARY_BUTTON}
  .add:disabled { cursor: progress; opacity: .65; }
  .edit { background: var(--raised); }
  .edit:hover { background: var(--accent-soft); }
  .message { margin-top: 8px; font-size: 12px; font-weight: 600; color: var(--ok); }
  .message:empty { display: none; }
  .message.error { color: var(--error); }
`;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

const host = document.createElement('minerr-popup');
host.style.cssText = 'all: initial; position: fixed; top: 0; left: 0; z-index: 2147483647;';
const shadow = host.attachShadow({ mode: 'open' });
shadow.append(el('style', { textContent: STYLE }));

export const isPopup = (target: EventTarget | null) => target === host;

// A new popup box. showBox puts it on top of the other boxes; hideBox takes it out of the shadow root,
// so the shadow root holds only the boxes that show.
export function createBox(): HTMLDivElement {
  const box = el('div', { className: 'popup' });
  applyTheme(box);
  return box;
}

export const showBox = (box: HTMLDivElement) => shadow.append(box);
export const hideBox = (box: HTMLDivElement) => box.remove();

// The popup goes into the full screen element when there is one, so it shows over a full screen video.
export const mount = () => (document.fullscreenElement ?? document.documentElement).append(host);

const toastBox = el('div', { className: 'toast', role: 'status', hidden: true });
shadow.append(toastBox);
let toastTimer: ReturnType<typeof setTimeout> | undefined;

// A short message at the bottom of the window, for keys that change something without a popup.
export function toast(text: string): void {
  mount();
  toastBox.textContent = text;
  toastBox.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastBox.hidden = true; }, 1800);
}

// Hides the popup during the screenshot of a new card.
export const setPopupVisible = (visible: boolean) => { host.style.visibility = visible ? '' : 'hidden'; };

// What a popup belongs to: a word span (on the page or in a popup), or the text at the start of a selection (Alt+S).
export type Anchor = { kind: 'word'; span: HTMLElement } | { kind: 'text'; range: Range; text: string };

export const anchorText = (anchor: Anchor): string => (anchor.kind === 'word' ? wordText(anchor.span) : anchor.text);
export const anchorRect = (anchor: Anchor): DOMRect => (anchor.kind === 'word' ? anchor.span : anchor.range).getBoundingClientRect();

// The word that a popup shows.
export interface View {
  anchor: Anchor;
  // The dictionary form, for the lookup and the card.
  lemma: string;
  word: WordId;
  // The headword and reading of the dictionary entry of the word, when one entry fits.
  headword?: { text: string; reading: string } | undefined;
  status: Status;
  groups: Entry[];
  // The number of words on the page with this status key.
  count: number;
}

// A rendered popup: its box, its word, and the controls that the keys and the card code change later.
export interface Layer {
  box: HTMLDivElement;
  view: View;
  message: HTMLDivElement;
  addButton: HTMLButtonElement;
  statusButtons: Map<Status, HTMLButtonElement>;
}

export function showMessage({ message }: Layer, text: string, isError = false): void {
  message.textContent = text;
  message.className = isError ? 'message error' : 'message';
}

export function markStatus({ box, statusButtons }: Layer, status: Status): void {
  for (const [name, button] of statusButtons) button.setAttribute('aria-pressed', String(name === status));
  box.style.setProperty('--status', STATUSES[status].color);
}

export const addLabel = () => ['Add to Anki ', el('kbd', { textContent: 'A' })];

export function position(box: HTMLElement, rect: DOMRect): void {
  // Fit the popup on the roomier side of the word so it never covers the word; the definitions scroll instead.
  box.style.maxHeight = `min(60vh, 480px, ${Math.max(rect.top, innerHeight - rect.bottom) - 12}px)`;
  const below = rect.bottom + 6;
  const top = below + box.offsetHeight > innerHeight ? Math.max(4, rect.top - box.offsetHeight - 6) : below;
  box.style.top = `${top}px`;
  box.style.left = `${Math.max(4, Math.min(rect.left, innerWidth - box.offsetWidth - 4))}px`;
}

// Each chip is followed by a space, so the chips wrap like words.
const chips = (tags: Tag[]) => tags.flatMap(({ name, category, notes }) => [el('span', { className: tagClass(category), title: notes, textContent: name }), ' ']);

// One dictionary label closes each run of senses from the same dictionary.
const senseList = (senses: Sense[]) => el('ol', {}, ...senses.map((sense, i) => el('li', {}, ...chips(sense.tags), sense.glossary.join('\n'),
  sense.dict === senses[i + 1]?.dict ? '' : el('div', { className: 'dict', textContent: sense.dict }))));

const starText = (count: number) => '★'.repeat(count) + '☆'.repeat(5 - count);

// The reading in marked kana: a line over each high mora, and a line down after the mora where the pitch drops.
function pitchMarks(reading: string, position: number): HTMLElement {
  const kana = morae(reading);
  const high = highs(position, kana.length);
  const pattern = PITCH[pitchPattern(position, kana.length)];
  const label = el('span', { className: 'pattern', textContent: `${pattern.label} [${position}]` });
  label.style.color = pattern.color;
  return el('span', { className: 'pitch' },
    el('span', { className: 'morae' }, ...kana.map((mora, i) => el('span', {
      className: `mora${high[i] ? ' high' : ''}${i + 1 === position ? ' drop' : ''}`, textContent: mora,
    }))), label);
}

// The stars, the frequency in each dictionary, and the pitch accents of one entry.
function metaRow({ reading, frequencies, pitches }: Entry): HTMLElement | '' {
  const count = entryStars(frequencies);
  const items = [
    ...(count === null ? [] : [el('span', { className: 'stars', title: `Frequency: ${count} of 5 stars`, textContent: starText(count) })]),
    ...frequencies.map(({ dict, display }) => el('span', { className: 'freq' }, `${dict} `, el('b', { textContent: display }))),
    ...pitches.flatMap(({ dict, positions }) => positions.map(position => Object.assign(pitchMarks(reading, position), { title: dict }))),
  ];
  return items.length ? el('div', { className: 'meta' }, ...items) : '';
}

export interface Actions {
  addCard: () => void;
  editCard: () => void;
  close: () => void;
}

export function render(box: HTMLDivElement, view: View, { addCard, editCard, close }: Actions): Layer {
  const { lemma, word, groups } = view;
  const [first, ...others] = groups;
  const title = view.headword?.text ?? lemma;
  const reading = view.headword?.reading ?? first?.reading ?? '';
  const surface = anchorText(view.anchor);
  const notes = [
    ...(surface !== title ? [`On the page: ${surface}`] : []),
    ...(view.count ? [`Appears ${view.count} ${view.count === 1 ? 'time' : 'times'} on this page`] : []),
  ];
  const statusButtons = new Map<Status, HTMLButtonElement>();
  const statusRow = el('div', { className: 'statuses', role: 'group', ariaLabel: 'Word status' },
    ...STATUS_NAMES.map(status => {
      const { hotkey, label, color } = STATUSES[status];
      const dot = el('span', { className: 'dot' });
      dot.style.background = color;
      const button = el('button', { onclick: () => setStatus(word, status) }, dot, `${label} `, el('kbd', { textContent: hotkey }));
      statusButtons.set(status, button);
      return button;
    }));
  // Other readings or spellings of the lemma follow the first group, each under its own heading.
  const definitions = first
    ? [senseList(first.senses), ...others.flatMap(group => [
      el('div', { className: 'group' },
        el('span', { className: 'word', textContent: group.expression }),
        el('span', { className: 'reading', textContent: group.reading }),
        ...chips(group.termTags),
        metaRow(group)),
      senseList(group.senses),
    ])]
    : [el('p', { className: 'empty', textContent: 'No dictionary entry. Import a dictionary in the options page.' })];
  const addButton = el('button', { className: 'add primary', onclick: addCard }, ...addLabel());
  const editButton = el('button', { className: 'edit', title: 'Edit the card before Minerr sends it', onclick: editCard }, 'Edit ', el('kbd', { textContent: 'E' }));
  const message = el('div', { className: 'message', role: 'status' });
  box.replaceChildren(
    el('header', {},
      el('div', { className: 'title' },
        el('span', { className: 'lemma', textContent: title }),
        reading !== title ? el('span', { className: 'reading', textContent: reading }) : '',
        first?.termTags.length ? el('span', { className: 'tags' }, ...chips(first.termTags)) : ''),
      first ? metaRow(first) : '',
      notes.length ? el('div', { className: 'surface', textContent: notes.join(' · ') }) : '',
      statusRow,
      el('div', { className: 'corner' },
        el('button', { className: 'off', innerHTML: POWER_ICON, title: 'Turn Minerr off in all tabs. The Minerr toolbar menu turns it on.', ariaLabel: 'Turn Minerr off', onclick: () => minerrEnabled.set(false) }),
        el('button', { className: 'close', textContent: '✕', title: 'Close (Esc)', ariaLabel: 'Close', onclick: close }))),
    el('div', { className: 'definitions' }, ...definitions),
    el('footer', {}, el('div', { className: 'actions' }, addButton, editButton), message),
  );
  const layer = { box, view, message, addButton, statusButtons };
  markStatus(layer, view.status);
  return layer;
}
