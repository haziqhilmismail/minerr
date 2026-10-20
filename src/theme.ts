import { setting } from './settings.ts';

// The color theme of the extension pages and the word popup. The Anki card follows the night mode of Anki instead.
export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

const isTheme = (value: unknown): value is Theme => THEMES.some(theme => theme === value);
export const theme = setting('theme', isTheme, 'system');

export const resolveTheme = (theme: Theme, systemDark: boolean): 'light' | 'dark' =>
  theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;

// Keeps data-theme="light" or "dark" on root, live: the CSS of the surface reads that attribute.
// Call it once per extension page, or with the root element of a shadow tree.
export function applyTheme(root: HTMLElement = document.documentElement): void {
  const media = matchMedia('(prefers-color-scheme: dark)');
  let chosen: Theme = 'system';
  const show = () => { root.dataset.theme = resolveTheme(chosen, media.matches); };
  show();
  media.addEventListener('change', show);
  theme.watch(value => { chosen = value; show(); });
}
