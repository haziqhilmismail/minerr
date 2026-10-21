// Colors the words on a page by their pitch pattern (Migaku "pitch coloring"), from the pitch accent dictionaries.
import { toHiragana } from '../text/group.ts';
import { PITCH } from '../dictionary/meta.ts';
import { call } from '../shared/rpc.ts';
import { isBoolean, setting } from '../shared/settings.ts';

export const pitchColors = setting('pitchColors', isBoolean, false);

const BATCH = 200;
const STYLE = Object.entries(PITCH)
  .map(([pattern, { color }]) => `:root[data-ml-pitch-colors]:not([data-minerr-off]) .ml-word[data-ml-pitch="${pattern}"] { color: ${color}; }`).join('\n');

// Each word span gets data-ml-pitch: a pattern of PITCH, or "none" when no dictionary has its pitch accent.
export function installPitchColors(): void {
  document.head.append(Object.assign(document.createElement('style'), { textContent: STYLE }));
  const pending = new Set<HTMLElement>();
  let shown = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function flush(): Promise<void> {
    const spans = [...pending].filter(span => span.isConnected && !span.dataset.mlPitch && span.dataset.mlLemma);
    pending.clear();
    for (let i = 0; i < spans.length; i += BATCH) {
      const batch = spans.slice(i, i + BATCH);
      const words = batch.map(span => ({ lemma: span.dataset.mlLemma ?? '', reading: span.dataset.mlReading ?? toHiragana(span.textContent ?? '') }));
      const patterns = await call({ type: 'pitch', words }).catch((error: unknown) => {
        console.warn('minerr pitch lookup failed', error);
        return [];
      });
      batch.forEach((span, j) => { span.dataset.mlPitch = patterns[j] ?? 'none'; });
    }
    timer = null;
    // Words that came during the lookups.
    if (pending.size) timer = setTimeout(flush, 100);
  }

  const collect = (node: Node) => {
    if (!shown || !(node instanceof HTMLElement)) return;
    if (node.matches('.ml-word')) pending.add(node);
    for (const span of node.querySelectorAll<HTMLElement>('.ml-word')) pending.add(span);
    if (pending.size) timer ??= setTimeout(flush, 100);
  };

  new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(collect)))
    .observe(document.body, { childList: true, subtree: true });

  pitchColors.watch(value => {
    shown = value;
    document.documentElement.toggleAttribute('data-ml-pitch-colors', shown);
    collect(document.body);
  });
}
