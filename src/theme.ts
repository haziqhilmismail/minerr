// The color theme of the extension pages and the word popup. The Anki card follows the night mode of Anki instead.
export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

const KEY = 'theme';

export const isTheme = (value: unknown): value is Theme => THEMES.some(theme => theme === value);
const storedTheme = (value: unknown): Theme => (isTheme(value) ? value : 'system');

export const getTheme = async (): Promise<Theme> => storedTheme((await chrome.storage.local.get(KEY))[KEY]);
export const setTheme = (theme: Theme): Promise<void> => chrome.storage.local.set({ [KEY]: theme });

export const resolveTheme = (theme: Theme, systemDark: boolean): 'light' | 'dark' =>
  theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;

// Keeps data-theme="light" or "dark" on root, live: the CSS of the surface reads that attribute.
// Call it once per extension page, or with the root element of a shadow tree.
export function applyTheme(root: HTMLElement = document.documentElement): void {
  const media = matchMedia('(prefers-color-scheme: dark)');
  let theme: Theme = 'system';
  const show = () => { root.dataset.theme = resolveTheme(theme, media.matches); };
  show();
  media.addEventListener('change', show);
  getTheme().then(value => { theme = value; show(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !(KEY in changes)) return;
    theme = storedTheme(changes[KEY]?.newValue);
    show();
  });
}
