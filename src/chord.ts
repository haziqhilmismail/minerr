// Key names and the rules of the key tables of the page and the popup.

export const isEditable = (target: EventTarget | null) => target instanceof HTMLElement
  && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

// The name of the key of event: "alt+shift+d", "alt+s", "n", "1", "Escape". Shift counts only with Alt, as Shift is the
// popup key. With Alt, the letter comes from the physical key, because Alt changes the character on macOS (Alt+S is ß).
export function chord(event: Pick<KeyboardEvent, 'key' | 'code' | 'altKey' | 'shiftKey'>): string {
  const letter = /^Key([A-Z])$/.exec(event.code)?.[1];
  const name = event.altKey && letter ? letter.toLowerCase() : event.key.length === 1 ? event.key.toLowerCase() : event.key;
  return `${event.altKey ? 'alt+' : ''}${event.altKey && event.shiftKey ? 'shift+' : ''}${name}`;
}

// What a status key (1-4) changes: the words of a text selection, else the word of the open popup,
// else the one unknown word of the subtitle line. null: the page gets the key.
export type StatusTarget = 'selection' | 'popup' | 'line' | null;

export function statusTarget({ selectedWords, popupOpen, lineUnknowns }: { selectedWords: number; popupOpen: boolean; lineUnknowns: number }): StatusTarget {
  if (selectedWords > 0) return 'selection';
  if (popupOpen) return 'popup';
  return lineUnknowns === 1 ? 'line' : null;
}
