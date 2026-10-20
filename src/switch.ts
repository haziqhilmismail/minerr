// Minerr on or off in every tab. When off, words keep their spans but lose underlines and the popup, so turning it on again is instant.
const KEY = 'enabled';

const storedEnabled = (value: unknown): boolean => (typeof value === 'boolean' ? value : true);

export const isEnabled = async (): Promise<boolean> => storedEnabled((await chrome.storage.local.get({ [KEY]: true }))[KEY]);
export const setEnabled = (enabled: boolean): Promise<void> => chrome.storage.local.set({ [KEY]: enabled });

export function onEnabledChange(listener: (enabled: boolean) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && KEY in changes) listener(storedEnabled(changes[KEY]?.newValue));
  });
}
