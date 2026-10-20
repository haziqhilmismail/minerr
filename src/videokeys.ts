// The keys of the subtitle overlay, from Migaku's defaults where they do not collide with the popup keys (1-4, A, Esc).
// timed: the key needs lines with times, so it does nothing on mirrored captions.

export const VIDEO_KEYS = [
  { action: 'next', keys: ['ArrowRight', 'd'], label: 'Go to the next line', timed: true },
  { action: 'previous', keys: ['ArrowLeft'], label: 'Go to the previous line', timed: true },
  { action: 'replay', keys: ['ArrowDown', 's'], label: 'Play the current line again', timed: true },
  { action: 'back5', keys: ['alt+a'], label: 'Go back 5 seconds', timed: false },
  { action: 'forward5', keys: ['alt+d'], label: 'Go forward 5 seconds', timed: false },
  { action: 'copy', keys: ['c'], label: 'Copy the current line', timed: false },
  { action: 'frameForward', keys: ['.'], label: 'Go one frame forward (pauses the video)', timed: true },
  { action: 'frameBack', keys: [','], label: 'Go one frame back (pauses the video)', timed: true },
  { action: 'offsetUp', keys: ['alt+o'], label: 'Show the subtitles 0.1 seconds later', timed: true },
  { action: 'offsetDown', keys: ['alt+i'], label: 'Show the subtitles 0.1 seconds earlier', timed: true },
  { action: 'bigger', keys: ['alt+='], label: 'Make the subtitles larger', timed: false },
  { action: 'smaller', keys: ['alt+-'], label: 'Make the subtitles smaller', timed: false },
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

export const videoKey = (press: KeyPress): VideoKey | null => {
  const name = keyName(press);
  return VIDEO_KEYS.find(entry => entry.keys.some(key => key === name)) ?? null;
};

const NAMES: Record<string, string> = { ArrowRight: '→', ArrowLeft: '←', ArrowDown: '↓', ArrowUp: '↑' };

// How the options page and the README write a key: 'Alt+O', '→', 'Shift+W'.
export const keyLabel = (key: string): string => key.split('+')
  .map(part => NAMES[part] ?? (part === 'alt' ? 'Alt' : part === 'shift' ? 'Shift' : part.toUpperCase())).join('+');
