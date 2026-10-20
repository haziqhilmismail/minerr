import { setting } from './settings.ts';

// When plain hover opens the word popup. Shift + hover opens it at once in every mode.
export const HOVER_MODES = ['hover', 'unknown', 'shift'] as const;
export type HoverMode = (typeof HOVER_MODES)[number];

const isHoverMode = (value: unknown): value is HoverMode => HOVER_MODES.some(mode => mode === value);
export const hoverMode = setting('hoverMode', isHoverMode, 'hover');

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
