// The video part of the options page: the table of the overlay keys and the video settings.
import { byId } from './dom.ts';
import type { Setting } from './settings.ts';
import { keyLabel, VIDEO_KEYS } from './videokeys.ts';
import { audioPadding, cleanSubs, gapMode, subEffect, subObscured } from './videosettings.ts';

// bindRadios of options.ts, which binds a radio group to a setting.
type BindRadios = <T extends string>(name: string, setting: Setting<T>) => Promise<void>;

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

// watch, so a key on a video page (W) also changes the box here.
function bindCheckbox(id: string, { watch, set }: Setting<boolean>): void {
  const box = byId(id, HTMLInputElement);
  watch(value => { box.checked = value; });
  box.addEventListener('change', () => set(box.checked));
}

export async function bindVideoOptions(bindRadios: BindRadios): Promise<void> {
  const padding = byId('audio-padding', HTMLInputElement);
  padding.value = String(await audioPadding.get());
  padding.addEventListener('change', () => {
    const value = Math.min(3000, Math.max(0, Math.round(padding.valueAsNumber) || 0));
    padding.value = String(value);
    audioPadding.set(value);
  });
  bindCheckbox('sub-obscured', subObscured);
  bindCheckbox('clean-subs', cleanSubs);
  await Promise.all([bindRadios('subEffect', subEffect), bindRadios('gapMode', gapMode)]);
}
