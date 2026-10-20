// The one definition of word statuses. Storage holds one key per lemma; a missing key means unknown.
// color is the status color on every surface; underline is the thickness of the colored underline on page words (null: none).
export const STATUSES = {
  unknown: { hotkey: '1', label: 'Unknown', className: 'ml-unknown', color: '#e5383b', underline: 'max(2px, 0.12em)' },
  learning: { hotkey: '2', label: 'Learning', className: 'ml-learning', color: '#f59f00', underline: 'max(2px, 0.12em)' },
  known: { hotkey: '3', label: 'Known', className: 'ml-known', color: '#2f9e44', underline: 'max(1px, 0.05em)' },
  ignored: { hotkey: '4', label: 'Ignored', className: 'ml-ignored', color: '#8a8f98', underline: null },
};

// currentColor keeps the hover highlight visible on light text over video and on dark text over a light page.
export const WORD_CSS = [
  '.ml-word { border-radius: 2px; cursor: pointer; text-underline-offset: 0.2em; text-decoration-skip-ink: none; }',
  '.ml-word:hover, .ml-word[data-ml-active] { background-color: color-mix(in srgb, currentColor 16%, transparent); }',
  ...Object.values(STATUSES).filter(s => s.underline)
    .map(s => `.${s.className} { text-decoration: underline ${s.underline} ${s.color}; }`),
].join('\n');

const PREFIX = 'w:';
const wordKey = lemma => PREFIX + lemma;
const lemmaOfKey = key => (key.startsWith(PREFIX) ? key.slice(PREFIX.length) : null);

export function setStatus(lemma, status) {
  return status === 'unknown'
    ? chrome.storage.local.remove(wordKey(lemma))
    : chrome.storage.local.set({ [wordKey(lemma)]: status });
}

// Calls listener with a Map of lemma -> new status for every word whose status changed in any tab.
export function onStatusChange(listener) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const changed = new Map();
    for (const [key, { newValue }] of Object.entries(changes)) {
      const lemma = lemmaOfKey(key);
      if (lemma !== null) changed.set(lemma, newValue ?? 'unknown');
    }
    if (changed.size) listener(changed);
  });
}

export function setStatuses(lemmas, status) {
  return chrome.storage.local.set(Object.fromEntries(lemmas.map(lemma => [wordKey(lemma), status])));
}

export async function getStatuses(lemmas) {
  const stored = await chrome.storage.local.get(lemmas.map(wordKey));
  return new Map(lemmas.map(lemma => [lemma, stored[wordKey(lemma)] ?? 'unknown']));
}
