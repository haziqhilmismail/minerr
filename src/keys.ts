// The keys that work on a page without a popup. The keys of an open popup are in popup.ts.
import { chord, isEditable } from './chord.ts';
import { toast } from './popup-view.ts';
import { sentenceHighlight } from './sentence-hover.ts';
import { toggleSiteOf, watchActive } from './site.ts';

let active = false;
watchActive(value => { active = value; });

async function toggleSentenceHighlight(): Promise<void> {
  const on = !(await sentenceHighlight.get());
  await sentenceHighlight.set(on);
  toast(on ? 'Sentence highlight on.' : 'Sentence highlight off.');
}

// Each binding returns false when it does not apply now, so the page gets the key.
const BINDINGS: Record<string, () => boolean> = {
  'alt+shift+d': () => {
    const host = location.hostname;
    toggleSiteOf(host).then(on => toast(on ? `Minerr is on for ${host}.` : `Minerr is off for ${host}. Press Alt+Shift+D to turn it on.`));
    return true;
  },
  'alt+shift+s': () => {
    if (!active) return false;
    toggleSentenceHighlight();
    return true;
  },
};

// Capture on window so page shortcuts do not also fire.
window.addEventListener('keydown', event => {
  if (event.ctrlKey || event.metaKey || isEditable(event.target)) return;
  const binding = BINDINGS[chord(event)];
  if (!binding?.()) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);
