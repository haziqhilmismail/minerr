// Minerr on or off in every tab. When off, words keep their spans but lose underlines and the popup, so turning it on again is instant.
const KEY = 'enabled';

export const isEnabled = async () => (await chrome.storage.local.get({ [KEY]: true }))[KEY];
export const setEnabled = enabled => chrome.storage.local.set({ [KEY]: enabled });

export function onEnabledChange(listener) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && KEY in changes) listener(changes[KEY].newValue ?? true);
  });
}
