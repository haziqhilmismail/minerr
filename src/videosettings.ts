// The settings of the subtitle overlay, for every video page.
import { isGapMode, isPlayMode } from './playback.ts';
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

// When the video pauses on its own; see PLAY_MODES.
export const playMode = setting('playMode', isPlayMode, 'normal');

// Pause while the mouse is on the subtitle line or the popup of a subtitle word is open, and play again after.
export const pauseOnHover = setting('pauseOnHover', isBoolean, true);

// Seconds after a pause of the play mode before the video plays again; 'off' waits for the user.
export const AUTO_RESUME = ['off', '3', '6', '10'] as const;
export type AutoResume = (typeof AUTO_RESUME)[number];
export const autoResume = setting('autoResume', (value: unknown): value is AutoResume => AUTO_RESUME.some(v => v === value), 'off');

// Open the popup of the first unknown word of the line when the play mode pauses.
export const autoLookup = setting('autoLookup', isBoolean, false);
