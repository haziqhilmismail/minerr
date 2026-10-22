import { setStatus, type Status, STATUS_NAMES, STATUSES, WORD_CSS, type WordId } from '../status/status.ts';
import { minerrEnabled } from '../shared/settings.ts';
import { TAG_CSS, tagClass } from '../dictionary/tags.ts';
import { applyTheme } from '../shared/theme.ts';
import { GLASS, PRIMARY_BUTTON, tokensOn } from '../shared/design-tokens.ts';
import { wordText } from '../text/word-spans.ts';
import { type Entry, entryStars, highs, morae, PITCH, pitchPattern } from '../dictionary/meta.ts';
import type { Sense, Tag } from '../dictionary/yomitan.ts';

const POWER_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 3v8"/><path d="M6.3 6.8a8 8 0 1 0 11.4 0"/></svg>';

const STYLE = `
  ${tokensOn(':host')}
  .popup {
    position: fixed; z-index: 2147483647; display: flex; flex-direction: column; box-sizing: border-box;
    width: 380px; max-width: calc(100vw - 8px); max-height: min(60vh, 480px); overflow: hidden;
    border-radius: var(--radius-l); corner-shape: var(--corner);
    ${GLASS} color: var(--text); color-scheme: light dark; text-align: left;
    font: var(--text-body)/1.45 var(--font-ui); -webkit-font-smoothing: antialiased;
    box-shadow: inset 0 3px 0 var(--status, transparent), var(--edge), var(--shadow-3);
    transition: opacity var(--normal) var(--ease), translate var(--normal) var(--ease);
  }
  @starting-style { .popup { opacity: 0; translate: 0 4px; } }
  .popup[data-theme="light"] { color-scheme: light; }
  .popup[data-theme="dark"] { color-scheme: dark; }
  header { position: relative; padding: var(--space-4) var(--space-4) var(--space-3); border-bottom: 1px solid var(--separator); }
  .title { display: flex; flex-wrap: wrap; align-items: baseline; column-gap: var(--space-2); row-gap: 2px; padding-right: 72px; }
  .title .tags { font-size: var(--text-footnote); }
  .lemma { font: 700 var(--text-title1)/1.2 var(--font-jp); letter-spacing: .01em; }
  .corner { position: absolute; top: var(--space-2); right: var(--space-2); display: flex; gap: var(--space-1); }
  .corner button { display: grid; place-items: center; width: 32px; height: 32px; padding: 0; border: 0; border-radius: 50%;
    background: var(--raised); color: var(--muted); font-size: var(--text-footnote); }
  .corner button:hover { background: var(--line); color: var(--text); }
  .reading { font: var(--text-headline)/1.4 var(--font-jp); color: var(--muted); }
  .surface { margin-top: 2px; font-size: var(--text-caption); color: var(--muted); }
  .inflection { font: var(--text-caption)/1.5 var(--font-jp); color: var(--text); }
  .anki { display: block; margin-top: 2px; padding: 0; border: 0; background: none; color: var(--muted); font-size: var(--text-caption); text-align: left; }
  .anki.found { color: var(--ok); font-weight: 600; }
  .anki:hover { text-decoration: underline; }
  .anki[hidden] { display: none; }
  .statuses { display: grid; grid-template-columns: repeat(4, 1fr); gap: 2px; margin-top: var(--space-3); padding: 2px;
    border-radius: var(--radius-s); corner-shape: var(--corner); background: var(--raised); }
  button { font: inherit; color: inherit; cursor: pointer; user-select: none;
    transition: background-color var(--fast) var(--ease), color var(--fast) var(--ease), filter var(--fast) var(--ease), scale var(--fast) var(--ease); }
  button:active:not(:disabled) { scale: 0.97; }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .statuses button { min-height: 32px; padding: var(--space-1) 2px; border: 0; border-radius: calc(var(--radius-s) - 2px); corner-shape: var(--corner);
    background: none; color: var(--muted); font-size: var(--text-caption); font-weight: 600; white-space: nowrap; }
  .statuses button:hover { color: var(--text); }
  .statuses button[aria-pressed="true"] { background: var(--card); color: var(--text); box-shadow: var(--shadow-1); }
  .dot { display: inline-block; width: 8px; height: 8px; margin-right: 5px; border-radius: 50%; vertical-align: 1px; }
  kbd { display: inline-block; min-width: 16px; box-sizing: border-box; padding: 0 3px; border: 1px solid currentColor;
    border-radius: 4px; font: 600 11px/14px var(--font-ui); text-align: center; opacity: .6; }
  .definitions { flex: 1 1 auto; min-height: 0; overflow: auto; overscroll-behavior: contain; padding: var(--space-3) var(--space-4) var(--space-1); }
  ol { margin: 0; padding-left: 22px; }
  li { margin-bottom: var(--space-3); white-space: pre-line; }
  li::marker { color: var(--accent); font-size: var(--text-caption); font-weight: 700; }
  .group { margin: var(--space-1) 0 var(--space-2); padding-top: var(--space-3); border-top: 1px solid var(--separator); }
  .group .word { font: 700 var(--text-headline)/1.5 var(--font-jp); }
  .group .reading { margin: 0 var(--space-2) 0 6px; font-size: var(--text-body); }
  .dict { width: fit-content; margin-top: var(--space-1); padding: 0 var(--space-2); border-radius: var(--radius-xs); background: var(--raised);
    color: var(--muted); font-size: var(--text-caption); line-height: 20px; }
  ${TAG_CSS}
  .tag { font-family: var(--font-ui); }
  ${WORD_CSS}
  .empty { margin: 0 0 var(--space-2); color: var(--muted); }
  .meta { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px var(--space-3); margin-top: var(--space-1); font-size: var(--text-caption); color: var(--muted); }
  .group .meta { margin: 2px 0 0; }
  .stars { color: var(--star); font-size: var(--text-footnote); letter-spacing: 1px; }
  .freq b { color: var(--text); font-weight: 600; }
  .pitch { display: inline-flex; align-items: baseline; gap: 6px; }
  .morae { font-size: var(--text-footnote); color: var(--text); }
  .mora { display: inline-block; padding-top: 1px; border-top: 1.5px solid transparent; }
  .mora.high { border-top-color: currentColor; }
  .mora.drop { border-right: 1.5px solid currentColor; }
  .pattern { font-weight: 600; }
  .toast { position: fixed; left: 50%; bottom: 56px; transform: translateX(-50%); z-index: 1; max-width: calc(100vw - 32px);
    padding: var(--space-2) var(--space-4); border-radius: var(--radius-pill); color-scheme: dark;
    ${GLASS} color: var(--text);
    text-align: center; font: 600 var(--text-body)/1.45 var(--font-ui); box-shadow: var(--edge), var(--shadow-2); pointer-events: none;
    transition: opacity var(--normal) var(--ease), translate var(--normal) var(--ease); }
  @starting-style { .toast { opacity: 0; translate: 0 8px; } }
  .toast[hidden] { display: none; }
  footer { padding: var(--space-3) var(--space-4) var(--space-4); border-top: 1px solid var(--separator); }
  .actions { display: flex; gap: var(--space-2); }
  .add, .edit { min-height: 40px; padding: 0 var(--space-4); border: 0; border-radius: var(--radius-pill); font-weight: 600; }
  .add { flex: 1; }
  ${PRIMARY_BUTTON}
  .add:disabled { cursor: progress; opacity: .65; }
  .edit { background: var(--raised); }
  .edit:hover { background: var(--accent-soft); }
  .message { margin-top: var(--space-2); font-size: var(--text-footnote); font-weight: 600; color: var(--ok); }
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

// The popup goes into the full screen element when there is one, so it shows over a full screen video. It goes last,
// over the rest of the page, but only moves when it is not last: a move inserts the open boxes again, and they fade in again.
export function mount(): void {
  const parent = document.fullscreenElement ?? document.documentElement;
  if (parent.lastElementChild !== host) parent.append(host);
}

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
  // How the word on the page is built from its dictionary form, '' for a dictionary form.
  inflection: string;
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
  // How many notes Anki has of the word; hidden until Anki answers, and when Anki does not answer.
  ankiLine: HTMLButtonElement;
}

export function showMessage({ message }: Layer, text: string, isError = false): void {
  message.textContent = text;
  message.className = isError ? 'message error' : 'message';
}

export function markStatus({ box, statusButtons }: Layer, status: Status): void {
  for (const [name, button] of statusButtons) button.setAttribute('aria-pressed', String(name === status));
  box.style.setProperty('--status', STATUSES[status].color);
}

export function showAnkiCount({ ankiLine }: Layer, count: number): void {
  ankiLine.replaceChildren(count ? `In Anki: ${count} ${count === 1 ? 'note' : 'notes'} ` : 'Not in Anki ', el('kbd', { textContent: 'V' }));
  ankiLine.classList.toggle('found', count > 0);
  ankiLine.hidden = false;
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
  browseAnki: () => void;
  close: () => void;
}

export function render(box: HTMLDivElement, view: View, { addCard, editCard, browseAnki, close }: Actions): Layer {
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
  const ankiLine = el('button', { className: 'anki', hidden: true, title: 'Show the notes of the word in the Anki browser', onclick: browseAnki });
  box.replaceChildren(
    el('header', {},
      el('div', { className: 'title' },
        el('span', { className: 'lemma', textContent: title }),
        reading !== title ? el('span', { className: 'reading', textContent: reading }) : '',
        first?.termTags.length ? el('span', { className: 'tags' }, ...chips(first.termTags)) : ''),
      first ? metaRow(first) : '',
      notes.length ? el('div', { className: 'surface', textContent: notes.join(' · ') }) : '',
      ankiLine,
      view.inflection ? el('div', { className: 'inflection', textContent: `${title} → ${view.inflection}` }) : '',
      statusRow,
      el('div', { className: 'corner' },
        el('button', { className: 'off', innerHTML: POWER_ICON, title: 'Turn Minerr off in all tabs. The Minerr toolbar menu turns it on.', ariaLabel: 'Turn Minerr off', onclick: () => minerrEnabled.set(false) }),
        el('button', { className: 'close', textContent: '✕', title: 'Close (Esc)', ariaLabel: 'Close', onclick: close }))),
    el('div', { className: 'definitions' }, ...definitions),
    el('footer', {}, el('div', { className: 'actions' }, addButton, editButton), message),
  );
  const layer = { box, view, message, addButton, statusButtons, ankiLine };
  markStatus(layer, view.status);
  return layer;
}
