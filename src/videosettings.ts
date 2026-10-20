// The settings of the subtitle overlay, for every video page.
import { isGapMode } from './playback.ts';
import { setting } from './settings.ts';

const isScale = (value: unknown): value is number => typeof value === 'number' && value >= 0.5 && value <= 3;

// The text size of the overlay, as a factor of the default size.
export const subScale = setting('subScale', isScale, 1);

const isPadding = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 3000;

// The audio before and after a line that the sentence audio of a card also gets, in ms.
export const audioPadding = setting('audioPadding', isPadding, 500);

const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';

// W turns the obscured subtitles on and off; the effect is blur or hide. Hover and a pause show the text.
export const SUB_EFFECTS = ['blur', 'hide'] as const;
export type SubEffect = (typeof SUB_EFFECTS)[number];
export const subEffect = setting('subEffect', (value: unknown): value is SubEffect => SUB_EFFECTS.some(e => e === value), 'blur');
export const subObscured = setting('subObscured', isBoolean, false);

// Remove bracketed text such as （笑） from the lines.
export const cleanSubs = setting('cleanSubs', isBoolean, false);

// How the video crosses a long part with no line.
export const gapMode = setting('gapMode', isGapMode, 'off');
