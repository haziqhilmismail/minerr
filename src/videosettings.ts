// The settings of the subtitle overlay, for every video page.
import { setting } from './settings.ts';

const isScale = (value: unknown): value is number => typeof value === 'number' && value >= 0.5 && value <= 3;

// The text size of the overlay, as a factor of the default size.
export const subScale = setting('subScale', isScale, 1);

const isPadding = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 3000;

// The audio before and after a line that the sentence audio of a card also gets, in ms.
export const audioPadding = setting('audioPadding', isPadding, 500);
