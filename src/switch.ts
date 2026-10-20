// On/off settings that every tab follows. A missing key means on.
function flag(key: string) {
  const stored = (value: unknown): boolean => (typeof value === 'boolean' ? value : true);
  return {
    get: async (): Promise<boolean> => stored((await chrome.storage.local.get({ [key]: true }))[key]),
    set: (on: boolean): Promise<void> => chrome.storage.local.set({ [key]: on }),
    onChange(listener: (on: boolean) => void): void {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && key in changes) listener(stored(changes[key]?.newValue));
      });
    },
  };
}

// Minerr on or off. When off, words keep their spans but lose underlines and the popup, so turning it on again is instant.
export const { get: isEnabled, set: setEnabled, onChange: onEnabledChange } = flag('enabled');

// The soft highlight on i+1 sentences (src/iplusone.ts). It shows only while Minerr is on.
export const iPlusOne = flag('iPlusOne');
