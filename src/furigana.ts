// The reading of words with kanji over the word. The reading is a CSS pseudo-element, so the text of the page stays as it is
// for the sentence of a card. An inline-block word with top padding makes its line taller, so the reading never covers
// the line above.
import { setting } from './settings.ts';
import { watchActive } from './site.ts';

export const FURIGANA_MODES = ['off', 'unknown', 'all', 'hover'] as const;
export type FuriganaMode = (typeof FURIGANA_MODES)[number];

const isFuriganaMode = (value: unknown): value is FuriganaMode => FURIGANA_MODES.some(mode => mode === value);
export const furiganaMode = setting('furigana', isFuriganaMode, 'off');

const SHOWN = ':root[data-ml-furigana="all"] .ml-word[data-ml-reading], :root[data-ml-furigana="unknown"] .ml-word.ml-unknown[data-ml-reading]';
const HOVERED = ':root[data-ml-furigana="hover"] .ml-word[data-ml-reading]:is(:hover, [data-ml-active])';
const STYLE = `
  ${SHOWN} { display: inline-block; position: relative; padding-top: 0.6em; text-indent: 0; }
  ${SHOWN.replaceAll('[data-ml-reading]', '[data-ml-reading]::before')} {
    content: attr(data-ml-reading); position: absolute; top: 0; left: 50%; transform: translateX(-50%);
    font-size: 0.5em; font-weight: normal; line-height: 1.1; white-space: nowrap; pointer-events: none; }
  ${HOVERED} { position: relative; }
  ${HOVERED}::before { content: attr(data-ml-reading); position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%);
    padding: 0 0.25em; border-radius: 3px; background: Canvas; color: CanvasText; font-size: 0.6em; font-weight: normal;
    line-height: 1.3; white-space: nowrap; pointer-events: none; }
`;

// Keeps data-ml-furigana on the root while Minerr shows on the page, for the CSS above.
export function installFurigana(): void {
  document.head.append(Object.assign(document.createElement('style'), { textContent: STYLE }));
  let active = false;
  let mode: FuriganaMode = 'off';
  const show = () => {
    if (active && mode !== 'off') document.documentElement.dataset.mlFurigana = mode;
    else delete document.documentElement.dataset.mlFurigana;
  };
  furiganaMode.watch(value => { mode = value; show(); });
  watchActive(value => { active = value; show(); });
}
