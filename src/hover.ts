// When plain hover opens the word popup. Shift + hover opens it at once in every mode.
export const HOVER_MODES = ['hover', 'unknown', 'shift'] as const;
export type HoverMode = (typeof HOVER_MODES)[number];

const KEY = 'hoverMode';

export const isHoverMode = (value: unknown): value is HoverMode => HOVER_MODES.some(mode => mode === value);
const storedHoverMode = (value: unknown): HoverMode => (isHoverMode(value) ? value : 'hover');

export const getHoverMode = async (): Promise<HoverMode> => storedHoverMode((await chrome.storage.local.get(KEY))[KEY]);
export const setHoverMode = (mode: HoverMode): Promise<void> => chrome.storage.local.set({ [KEY]: mode });

export function onHoverModeChange(listener: (mode: HoverMode) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && KEY in changes) listener(storedHoverMode(changes[KEY]?.newValue));
  });
}

export interface Hover {
  mode: HoverMode;
  shift: boolean;
  unknownWord: boolean;
  popupOpen: boolean;
  textSelected: boolean;
  buttonDown: boolean;
}

// The wait in ms before the popup opens on the word under the mouse: 0 opens it now, null does not open it.
// The wait lets the mouse cross words without a popup on each one; a shorter wait while a popup shows makes the next word quick.
export function hoverDelay({ mode, shift, unknownWord, popupOpen, textSelected, buttonDown }: Hover): number | null {
  if (textSelected || buttonDown) return null;
  if (shift) return 0;
  if (mode === 'shift' || (mode === 'unknown' && !unknownWord)) return null;
  return popupOpen ? 50 : 300;
}
