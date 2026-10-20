// The video part of the options page: the table of the overlay keys.
import { byId } from './dom.ts';
import { keyLabel, VIDEO_KEYS } from './videokeys.ts';

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
