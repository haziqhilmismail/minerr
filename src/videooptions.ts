// The video part of the options page: the table of the overlay keys and the video settings.
import { byId } from './dom.ts';
import { keyLabel, VIDEO_KEYS } from './videokeys.ts';
import { audioPadding } from './videosettings.ts';

const cell = (...children: (Node | string)[]) => {
  const td = document.createElement('td');
  td.append(...children);
  return td;
};

byId('video-keys', HTMLElement).append(...VIDEO_KEYS.map(({ keys, label, timed }) => {
  const row = document.createElement('tr');
  const names = keys.flatMap((key, i) => [i ? ' or ' : '', Object.assign(document.createElement('kbd'), { textContent: keyLabel(key) })]);
  row.append(cell(...names), cell(label), cell(timed ? 'Needs subtitles with times' : ''));
  return row;
}));

const padding = byId('audio-padding', HTMLInputElement);
padding.value = String(await audioPadding.get());
padding.addEventListener('change', () => {
  const value = Math.min(3000, Math.max(0, Math.round(padding.valueAsNumber) || 0));
  padding.value = String(value);
  audioPadding.set(value);
});
