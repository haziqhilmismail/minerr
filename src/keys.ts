// The keys of a page and of the open popup. One table, so a key has one meaning at a time.
import { chord, isEditable, statusTarget } from './chord.ts';
import { toast } from './popup-view.ts';
import { sentenceHighlight } from './sentence-hover.ts';
import { toggleSiteOf, watchActive } from './site.ts';
import { setStatuses, type Status, STATUS_NAMES, STATUSES } from './status.ts';

// What the keys can do with the popup. popup.ts gives it to installKeys.
export interface PopupKeys {
  isOpen: () => boolean;
  // The status of the word of the top popup.
  setStatus: (status: Status) => void;
  addCard: () => void;
  // Closes the top popup.
  close: () => void;
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

async function markSelection(spans: HTMLElement[], status: Status): Promise<void> {
  const lemmas = [...new Set(spans.flatMap(span => span.dataset.mlLemma ?? []))];
  await setStatuses(lemmas, status);
  toast(`Marked ${plural(lemmas.length, 'word')} as ${STATUSES[status].label.toLowerCase()}.`);
}

async function toggleSentenceHighlight(): Promise<void> {
  const on = !(await sentenceHighlight.get());
  await sentenceHighlight.set(on);
  toast(on ? 'Sentence highlight on.' : 'Sentence highlight off.');
}

async function toggleSite(): Promise<void> {
  const host = location.hostname;
  const on = await toggleSiteOf(host);
  toast(on ? `Minerr is on for ${host}.` : `Minerr is off for ${host}. Press Alt+Shift+D to turn it on.`);
}

export function installKeys(popup: PopupKeys): void {
  let active = false;
  watchActive(value => { active = value; });

  const statusKey = (status: Status) => () => {
    const selected = selectedWords();
    switch (statusTarget({ selectedWords: selected.length, popupOpen: popup.isOpen(), lineUnknowns: 0 })) {
      case 'selection': markSelection(selected, status); return true;
      case 'popup': popup.setStatus(status); return true;
      default: return false;
    }
  };
  const whenOpen = (action: () => void) => () => {
    if (!popup.isOpen()) return false;
    action();
    return true;
  };
  // Each binding returns false when it does not apply now, so the page gets the key.
  const bindings: Record<string, () => boolean> = {
    ...Object.fromEntries(STATUS_NAMES.map(status => [STATUSES[status].hotkey, statusKey(status)])),
    a: whenOpen(popup.addCard),
    Escape: whenOpen(popup.close),
    'alt+shift+s': () => {
      toggleSentenceHighlight();
      return true;
    },
    'alt+shift+d': () => {
      toggleSite();
      return true;
    },
  };

  // Capture on window so page shortcuts (YouTube uses 1-4 to seek) do not also fire.
  window.addEventListener('keydown', event => {
    if (event.ctrlKey || event.metaKey || isEditable(event.target)) return;
    const name = chord(event);
    // A site that is off still takes the key that turns it on.
    if ((!active && name !== 'alt+shift+d') || !bindings[name]?.()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
}
