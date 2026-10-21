// The keys of a page and of the open popup. One table, so a key has one meaning at a time.
import { chord, focused, isEditable, isField, type PageCommand } from './chord.ts';
import { toast } from './popup-view.ts';
import { call, messageOf, serve } from '../shared/rpc.ts';
import { sentenceHighlight } from '../page-text/sentence-hover.ts';
import { wordJoins } from '../shared/settings.ts';
import { isMinerrPage, siteOf, toggleSiteOf, watchActive } from '../page-text/site.ts';
import { setStatus, setStatuses, type Status, STATUS_NAMES, STATUSES, type WordId } from '../status/status.ts';
import { sameWord, wordOf } from '../text/word-spans.ts';

// What the keys can do with the popup. popup.ts gives it to installKeys.
export interface PopupKeys {
  isOpen: () => boolean;
  // A card form is open: only Esc works, to close it.
  isEditing: () => boolean;
  // The word that a status key changes: the word of a popup that a key opened, else the word under the mouse (with a popup
  // or not), else the word of the popup under the mouse. shown: an open popup shows the word. null: the mouse is on no word.
  pointed: () => { word: WordId; shown: boolean } | null;
  addCard: () => void;
  // Opens the card form of the top popup.
  editCard: () => void;
  // Closes the card form, else the top popup.
  close: () => void;
  // The word span of the first popup, if it is open.
  firstSpan: () => HTMLElement | null;
  openWord: (span: HTMLElement) => Promise<void>;
  // Looks up the selected text. False if no text is selected.
  lookupSelection: () => boolean;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

// The word spans of the page that the text selection touches.
function selectedWords(): HTMLElement[] {
  const selection = getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return [];
  const range = selection.getRangeAt(0);
  const common = range.commonAncestorContainer;
  const scope = common instanceof Element ? common : common.parentElement;
  const inside = scope?.closest<HTMLElement>('.ml-word');
  const words = inside ? [inside] : [...(scope?.querySelectorAll<HTMLElement>('.ml-word') ?? [])];
  return words.filter(span => range.intersectsNode(span));
}

// The unknown words of the subtitle lines that show now, on YouTube and in the player.
const lineUnknowns = () => [...document.querySelectorAll<HTMLElement>('.minerr-subs-line:not([hidden]) .ml-word.ml-unknown:not([data-ml-cont])')];

async function markSelection(spans: HTMLElement[], status: Status): Promise<void> {
  const words = spans.map(wordOf);
  await setStatuses(words, status);
  toast(`Marked ${plural(new Set(words.map(word => word.key)).size, 'word')} as ${STATUSES[status].label.toLowerCase()}.`);
}

// A word with no popup shows no status buttons, so a toast tells the change.
async function markWord(word: WordId, status: Status): Promise<void> {
  await setStatus(word, status);
  toast(`Marked ${word.key} as ${STATUSES[status].label.toLowerCase()}.`);
}

async function toggleSentenceHighlight(): Promise<void> {
  const on = !(await sentenceHighlight.get());
  await sentenceHighlight.set(on);
  toast(on ? 'Sentence highlight on.' : 'Sentence highlight off.');
}

async function toggleSite(): Promise<void> {
  const host = location.hostname;
  const site = siteOf(host);
  if (isMinerrPage(location)) {
    toast('Minerr page text is always on in the pages of Minerr.');
    return;
  }
  const on = await toggleSiteOf(host);
  // The key can change (chrome://extensions/shortcuts), so the message names the toolbar menu, as the toolbar menu shows the key.
  toast(on ? `Minerr page text on for ${site}.` : `Minerr page text off for ${site}. Video subtitles stay on. Turn the page text on again in the Minerr toolbar menu.`);
}

// Alt+J: the text is one word from now on, or no longer one word. Only a dictionary word, so that its popup has an entry.
async function toggleWordJoin(text: string): Promise<void> {
  const joins = await wordJoins.get();
  if (joins.includes(text)) {
    await wordJoins.set(joins.filter(word => word !== text));
    toast(`${text} is no longer one word.`);
    return;
  }
  const found = await call({ type: 'lookupText', text });
  if (found?.length !== text.length) {
    toast(`No dictionary entry for ${text.slice(0, 10)}. Select one whole word in its dictionary form.`);
    return;
  }
  await wordJoins.set([...joins, text]);
  toast(`${text} is one word now.`);
}

// A key starts work that ends later; an error of it shows as a toast.
const report = (work: Promise<void>) => { work.catch((error: unknown) => toast(messageOf(error))); };

export function installKeys(popup: PopupKeys): void {
  let active = false;
  watchActive(value => { active = value !== 'off'; });

  // A status key changes the words of a text selection, else the word that the user points at. Else the page gets the key,
  // so a status key on YouTube seeks when the mouse is on no word.
  const statusKey = (status: Status) => () => {
    const selected = selectedWords();
    if (selected.length) {
      report(markSelection(selected, status));
      return true;
    }
    const target = popup.pointed();
    if (target) report(target.shown ? setStatus(target.word, status) : markWord(target.word, status));
    return target !== null;
  };
  // Opens the popup of the next unknown word of the subtitle line, after the word of the open popup.
  const nextUnknown = () => {
    const unknowns = lineUnknowns();
    if (!unknowns.length) return false;
    const current = popup.firstSpan();
    const next = unknowns[(unknowns.findIndex(span => sameWord(span, current)) + 1) % unknowns.length];
    if (!next) return false;
    popup.openWord(next);
    return true;
  };
  const whenOpen = (action: () => void) => () => {
    if (!popup.isOpen()) return false;
    action();
    return true;
  };
  // Each binding returns false when it does not apply now, so the page gets the key.
  const bindings: Record<string, (event: KeyboardEvent) => boolean> = {
    ...Object.fromEntries(STATUS_NAMES.map(status => [STATUSES[status].hotkey, statusKey(status)])),
    a: whenOpen(popup.addCard),
    e: whenOpen(popup.editCard),
    // Shift+N is the next video on YouTube; only a popup that Shift opened takes it.
    n: event => (!event.shiftKey || popup.isOpen()) && nextUnknown(),
    Escape: whenOpen(popup.close),
    'alt+shift+s': () => {
      report(toggleSentenceHighlight());
      return true;
    },
  };

  // Capture on window so page shortcuts (YouTube uses 1-4 to seek) do not also fire.
  window.addEventListener('keydown', event => {
    if (event.ctrlKey || event.metaKey || isEditable(event)) return;
    const name = chord(event);
    if (!active || (popup.isEditing() && name !== 'Escape') || !bindings[name]?.(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  // The browser shortcuts that the service worker sends to the tab. The frame with the focus takes them, as it takes the keys.
  const commands: Record<PageCommand, () => void> = {
    'lookup-selection': () => { popup.lookupSelection(); },
    'word-join': () => {
      const text = getSelection()?.toString().trim();
      if (text) report(toggleWordJoin(text));
    },
    'toggle-site': () => report(toggleSite()),
    'toggle-sentence-highlight': () => report(toggleSentenceHighlight()),
  };
  serve({
    command: ({ command }) => {
      // When Minerr is off, toggle-site still turns the page text of the site on or off.
      if ((!active && command !== 'toggle-site') || popup.isEditing() || isField(focused())) return;
      commands[command]();
    },
  }, target => target === undefined && document.hasFocus());
}
