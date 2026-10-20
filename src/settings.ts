// A setting in chrome.storage.local that every tab follows. A missing or invalid value reads as the fallback.
export function setting<T>(key: string, isValue: (value: unknown) => value is T, fallback: T) {
  const stored = (value: unknown): T => (isValue(value) ? value : fallback);
  const get = async (): Promise<T> => stored((await chrome.storage.local.get(key))[key]);
  const onChange = (listener: (value: T) => void): void => {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && key in changes) listener(stored(changes[key]?.newValue));
    });
  };
  return {
    isValue,
    get,
    set: (value: T): Promise<void> => chrome.storage.local.set({ [key]: value }),
    onChange,
    // Calls the listener with the stored value, then again on each change.
    watch(listener: (value: T) => void): void {
      get().then(listener);
      onChange(listener);
    },
  };
}

export type Setting<T> = ReturnType<typeof setting<T>>;

const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';

// Minerr on or off. When off, words keep their spans but lose underlines and the popup, so turning it on again is instant.
export const minerrEnabled = setting('enabled', isBoolean, true);

// The soft highlight on i+1 sentences (src/iplusone.ts). It shows only while Minerr is on.
export const iPlusOne = setting('iPlusOne', isBoolean, true);
