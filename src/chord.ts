// Key names for the key tables of the page and the popup.

export const isEditable = (target: EventTarget | null) => target instanceof HTMLElement
  && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

// The name of the key of event: "alt+shift+d", "alt+s", "n", "1", "Escape". Shift counts only with Alt, as Shift is the
// popup key. With Alt, the letter comes from the physical key, because Alt changes the character on macOS (Alt+S is ß).
export function chord(event: Pick<KeyboardEvent, 'key' | 'code' | 'altKey' | 'shiftKey'>): string {
  const letter = /^Key([A-Z])$/.exec(event.code)?.[1];
  const name = event.altKey && letter ? letter.toLowerCase() : event.key.length === 1 ? event.key.toLowerCase() : event.key;
  return `${event.altKey ? 'alt+' : ''}${event.altKey && event.shiftKey ? 'shift+' : ''}${name}`;
}
