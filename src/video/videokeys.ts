// The keys of the subtitle overlay, from Migaku's defaults. A is also the add key of the popup: with a popup open, the popup gets it.
// The up and down arrows stay with the video player, which changes the volume with them (user choice, 2026-10-22).
// timed: the key needs lines with times, so it does nothing on mirrored captions.
// set: the key works only in that key set. The keys of the other set go to the page, so YouTube seeks with its arrows in the 'wasd' set.

export const KEY_SETS = ['wasd', 'arrows'] as const;
export type KeySet = (typeof KEY_SETS)[number];

const VIDEO_KEYS = [
  { action: 'next', key: 'd', set: 'wasd', label: 'Go to the next line', timed: true },
  { action: 'previous', key: 'a', set: 'wasd', label: 'Go to the previous line', timed: true },
  { action: 'next', key: 'ArrowRight', set: 'arrows', label: 'Go to the next line', timed: true },
  { action: 'previous', key: 'ArrowLeft', set: 'arrows', label: 'Go to the previous line', timed: true },
  { action: 'replay', key: 's', label: 'Play the current line again', timed: true },
  { action: 'back5', key: 'alt+a', label: 'Go back 5 seconds', timed: false },
  { action: 'forward5', key: 'alt+d', label: 'Go forward 5 seconds', timed: false },
  { action: 'copy', key: 'c', label: 'Copy the current line', timed: false },
  { action: 'combine', key: 'j', label: 'Join the next line to the current line, for one card with both', timed: true },
  { action: 'browser', key: 'g', label: 'Open or close the subtitle sidebar, a card for each line', timed: false },
  { action: 'bookmark', key: 'b', label: 'Bookmark the current line, or remove its bookmark', timed: true },
  { action: 'frameForward', key: '.', label: 'Go one frame forward (pauses the video)', timed: true },
  { action: 'frameBack', key: ',', label: 'Go one frame back (pauses the video)', timed: true },
  { action: 'offsetUp', key: 'alt+o', label: 'Show the subtitles 0.1 seconds later', timed: true },
  { action: 'offsetDown', key: 'alt+i', label: 'Show the subtitles 0.1 seconds earlier', timed: true },
  { action: 'bigger', key: 'alt+=', label: 'Make the subtitles larger', timed: false },
  { action: 'smaller', key: 'alt+-', label: 'Make the subtitles smaller', timed: false },
  { action: 'second', key: 'shift+w', label: 'Show or hide the second subtitle track', timed: true },
  { action: 'obscure', key: 'w', label: 'Blur or hide the subtitles until you hover them or pause, or show them again', timed: false },
] as const;

export type VideoKey = (typeof VIDEO_KEYS)[number];
export type VideoAction = VideoKey['action'];

// The fields of a KeyboardEvent that name its key.
export interface KeyPress {
  key: string;
  code: string;
  altKey: boolean;
  shiftKey: boolean;
}

const CODES: Record<string, string> = { Equal: '=', Minus: '-', Period: '.', Comma: ',' };

// The name of a key press as VIDEO_KEYS writes it: 'd', 'ArrowLeft', 'alt+o', 'shift+w'.
// With Alt, the key comes from the code, because Alt changes the character on some keyboards (Alt+O is ø on a Mac).
export function keyName({ key, code, altKey, shiftKey }: KeyPress): string {
  const base = altKey ? (code.startsWith('Key') ? code.slice(3).toLowerCase() : CODES[code] ?? key) : key.length === 1 ? key.toLowerCase() : key;
  const shift = shiftKey && (key.length > 1 || /[a-z]/i.test(key)) ? 'shift+' : '';
  return `${altKey ? 'alt+' : ''}${shift}${base}`;
}

export const keysOf = (set: KeySet): VideoKey[] => VIDEO_KEYS.filter(entry => !('set' in entry) || entry.set === set);

export const videoKey = (press: KeyPress, set: KeySet): VideoKey | null => {
  const name = keyName(press);
  return keysOf(set).find(entry => entry.key === name) ?? null;
};

const NAMES: Record<string, string> = { ArrowRight: '→', ArrowLeft: '←', ArrowDown: '↓', ArrowUp: '↑' };

// How the options page and the README write a key: 'Alt+O', '→', 'Shift+W'.
export const keyLabel = (key: string): string => key.split('+')
  .map(part => NAMES[part] ?? (part === 'alt' ? 'Alt' : part === 'shift' ? 'Shift' : part.toUpperCase())).join('+');
