import { type Status, STATUS_NAMES, STATUSES } from '../status/status.ts';
import { GLASS, tokensOn } from '../shared/design-tokens.ts';

// The statuses of the words in element, in text order. Words that page.ts did not parse yet have none.
export const wordStatuses = (element: Element): Status[] => [...element.querySelectorAll('.ml-word')]
  .flatMap(span => STATUS_NAMES.filter(status => span.classList.contains(STATUSES[status].className)));

// The large centered subtitle line over a video, on YouTube, on the player page, and on other sites.
// The layer fills its positioned parent as a size container, so the text size follows the video in every view mode.
// The layer is always dark: it sits over video.
const STYLE = `
  ${tokensOn('.minerr-subs')}
  .minerr-subs { color-scheme: dark;
    position: absolute; inset: 0; z-index: 60; container-type: size; pointer-events: none; --minerr-scale: 1; }
  /* The YouTube player sets user-select: none, and the user copies text from the subtitles. */
  .minerr-subs-stack, .minerr-lines { user-select: text; -webkit-user-select: text; }
  .minerr-subs-stack {
    position: absolute; left: 50%; bottom: max(64px, 11cqh); transform: translateX(-50%);
    display: flex; flex-direction: column; align-items: center; gap: 0.3em; width: max-content; max-width: 90cqw;
    font: 500 calc(clamp(20px, min(5.6cqh, 3.4cqw), 64px) * var(--minerr-scale))/1.45 var(--font-jp);
  }
  .minerr-subs-line, .minerr-subs-second {
    box-sizing: border-box; max-width: 100%; border-radius: 0.6em; corner-shape: var(--corner);
    background: var(--material-subs); backdrop-filter: var(--blur);
    color: var(--text); pointer-events: auto; text-align: center; white-space: pre-line; overflow-wrap: anywhere;
    text-shadow: 0 1px 2px rgb(0 0 0 / 50%); box-shadow: var(--edge), var(--shadow-2);
  }
  .minerr-subs-line { padding: 0.12em 0.6em 0.18em; }
  /* A caption window of the site with its text at one side: the lines start where that window starts, so a new word does
     not move them. --minerr-inset is the distance of the window from that side of the video. */
  .minerr-subs-stack[data-align] { transform: none; max-width: calc(98cqw - var(--minerr-inset)); }
  .minerr-subs-stack[data-align="left"] { left: var(--minerr-inset); align-items: flex-start; }
  .minerr-subs-stack[data-align="right"] { left: auto; right: var(--minerr-inset); align-items: flex-end; }
  .minerr-subs-stack[data-align="left"] > * { text-align: left; }
  .minerr-subs-stack[data-align="right"] > * { text-align: right; }
  .minerr-subs-second { padding: 0.12em 0.7em 0.16em; font: 400 0.72em/1.45 var(--font-ui); }
  /* The window of the YouTube captions at one side has two rows and the width of that window: a new row comes in at the
     bottom, and the top row slides up past the straight top edge. The rows that went stay in data-gone (no text of the
     line) until the slide ends. */
  .minerr-subs-stack[data-align] .minerr-subs-line { min-width: calc(var(--minerr-window, 0) * 1em + 1.2em); }
  .minerr-subs-stack[data-align] .minerr-subs-window { display: flex; flex-direction: column; justify-content: flex-end; height: 2lh; overflow: clip; }
  .minerr-subs-stack[data-align] .minerr-subs-rows { white-space: pre; }
  .minerr-subs-rows[data-gone]::before { content: attr(data-gone) "\\A"; }
  .minerr-subs[data-second="hover"]:not([data-paused]) .minerr-subs-stack:not(:hover) .minerr-subs-second { visibility: hidden; }
  .minerr-subs-line[hidden], .minerr-subs-second[hidden], .minerr-subs-toast[hidden] { display: none; }
  .minerr-subs[data-obscure="blur"]:not([data-paused]) .minerr-subs-line:not(:hover) { filter: blur(0.3em); }
  .minerr-subs[data-obscure="hide"]:not([data-paused]) .minerr-subs-line:not(:hover),
  .minerr-subs[data-obscure="hide"]:not([data-paused]) .minerr-subs-line:not(:hover) * {
    color: transparent; text-shadow: none; text-decoration-color: transparent;
  }
  .minerr-subs-toast {
    position: absolute; top: var(--space-3); left: 50%; transform: translateX(-50%); max-width: 80cqw; padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-pill); ${GLASS}
    color: var(--text); font: 600 var(--text-body)/1.4 var(--font-ui); text-align: center; box-shadow: var(--edge), var(--shadow-2);
    transition: opacity var(--normal) var(--ease), translate var(--normal) var(--ease);
  }
  @starting-style { .minerr-subs-toast { opacity: 0; translate: 0 -8px; } }
`;

const TOAST_MS = 2500;
const ROLL_MS = 300;

// How text rolls up from before, as the captions of YouTube: the rows of before from the first row that text starts with
// stay (the last of them can have more words), the rows above them are gone, and the rows that stay move up by shift
// rows. null when text does not start with rows of before.
export function rollOf(before: string, text: string): { gone: string[]; shift: number } | null {
  const old = before.split('\n');
  const now = text.split('\n');
  for (let gone = 0; gone < old.length; gone++) {
    const kept = old.slice(gone);
    const last = kept.length - 1;
    if (kept.join('') && kept.length <= now.length && kept.every((row, i) => (i === last ? now[i]?.startsWith(row) : now[i] === row))) {
      return { gone: old.slice(0, gone), shift: now.length - kept.length };
    }
  }
  return null;
}

// The caption window of the site: the side of its text, its distance from that side of the video as a fraction of the
// width of the video, and its width in the font size of its captions. null is a centered window.
export type CaptionAnchor = { side: 'left' | 'right'; inset: number; width: number } | null;

export interface Overlay {
  layer: HTMLDivElement;
  line: HTMLDivElement;
  show: (text: string, second: string, anchor?: CaptionAnchor) => void;
  toast: (text: string) => void;
}

// Keeps layer on the screen over video, on a site whose player Minerr does not know: the page can scroll, resize,
// or move the video into full screen.
export function followVideo(video: HTMLVideoElement, layer: HTMLElement): void {
  function place(): void {
    if (!video.isConnected) {
      clearInterval(timer);
      removeEventListener('scroll', place, true);
      return;
    }
    const host = document.fullscreenElement && document.fullscreenElement !== video ? document.fullscreenElement : document.body;
    if (layer.parentElement !== host) host.append(layer);
    const rect = video.getBoundingClientRect();
    Object.assign(layer.style, { position: 'fixed', inset: 'auto', zIndex: '2147483646', top: `${rect.top}px`, left: `${rect.left}px`,
      width: `${rect.width}px`, height: `${rect.height}px` });
  }
  // The interval covers a resize, full screen, and a page that moves the video; scroll makes the overlay follow without a lag.
  const timer = setInterval(place, 250);
  addEventListener('scroll', place, { passive: true, capture: true });
  place();
}

export function createOverlay(): Overlay {
  const layer = Object.assign(document.createElement('div'), { className: 'minerr-subs' });
  const stack = Object.assign(document.createElement('div'), { className: 'minerr-subs-stack' });
  const line = Object.assign(document.createElement('div'), { className: 'minerr-subs-line', hidden: true });
  const rows = Object.assign(document.createElement('div'), { className: 'minerr-subs-rows' });
  const frame = Object.assign(document.createElement('div'), { className: 'minerr-subs-window' });
  frame.append(rows);
  line.append(frame);
  // The second line is the secondary track, for example English, under the Japanese line.
  const secondLine = Object.assign(document.createElement('div'), { className: 'minerr-subs-second', hidden: true });
  const note = Object.assign(document.createElement('div'), { className: 'minerr-subs-toast', hidden: true, role: 'status' });
  stack.append(line, secondLine);
  layer.append(stack, note);
  document.head.append(Object.assign(document.createElement('style'), { textContent: STYLE }));
  const shown = new Map<HTMLElement, string>();
  // Replace the text only when it changes: page.ts swaps the text node for word spans, and that must stay.
  const set = (element: HTMLElement, text: string, holder = element) => {
    if (shown.get(element) === text) return;
    shown.set(element, text);
    holder.textContent = text;
    element.hidden = !text;
  };
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  let rolling: Animation | null = null;
  const roll = (gone: string[], shift: number) => {
    if (!shift || still.matches) return;
    rolling?.cancel();
    if (gone.length) rows.dataset.gone = gone.join('\n');
    const animation = rows.animate({ translate: [`0 ${shift}lh`, '0 0'] }, { duration: ROLL_MS, easing: 'ease-out' });
    rolling = animation;
    animation.onfinish = animation.oncancel = () => {
      if (rolling !== animation) return;
      rolling = null;
      delete rows.dataset.gone;
    };
  };
  const show = (text: string, second: string, anchor: CaptionAnchor = null) => {
    if (anchor) {
      stack.dataset.align = anchor.side;
      stack.style.setProperty('--minerr-inset', `${(anchor.inset * 100).toFixed(2)}cqw`);
      stack.style.setProperty('--minerr-window', anchor.width.toFixed(2));
    } else {
      delete stack.dataset.align;
      stack.style.removeProperty('--minerr-inset');
      stack.style.removeProperty('--minerr-window');
    }
    const before = shown.get(line) ?? '';
    set(line, text, rows);
    const rolled = anchor && before && text ? rollOf(before, text) : null;
    if (rolled) roll(rolled.gone, rolled.shift);
    set(secondLine, second);
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const toast = (text: string) => {
    clearTimeout(timer);
    note.textContent = text;
    note.hidden = false;
    timer = setTimeout(() => { note.hidden = true; }, TOAST_MS);
  };
  return { layer, line, show, toast };
}
