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
  /* YouTube adds its automatic captions word by word in a box of fixed width, with the text at one side. The same box here
     keeps the words in place; a centered box moves the line at each word. */
  .minerr-subs-line[data-align] { width: 24em; }
  .minerr-subs-line[data-align="left"] { text-align: left; }
  .minerr-subs-line[data-align="right"] { text-align: right; }
  .minerr-subs-second { padding: 0.12em 0.7em 0.16em; font: 400 0.72em/1.45 var(--font-ui); }
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

// The side of the text in the caption window of the site, or null for the center.
export type Align = 'left' | 'right' | null;

export interface Overlay {
  layer: HTMLDivElement;
  line: HTMLDivElement;
  show: (text: string, second: string, align?: Align) => void;
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
  // The second line is the secondary track, for example English, under the Japanese line.
  const secondLine = Object.assign(document.createElement('div'), { className: 'minerr-subs-second', hidden: true });
  const note = Object.assign(document.createElement('div'), { className: 'minerr-subs-toast', hidden: true, role: 'status' });
  stack.append(line, secondLine);
  layer.append(stack, note);
  document.head.append(Object.assign(document.createElement('style'), { textContent: STYLE }));
  const shown = new Map<HTMLElement, string>();
  // Replace the text only when it changes: page.ts swaps the text node for word spans, and that must stay.
  const set = (element: HTMLElement, text: string) => {
    if (shown.get(element) === text) return;
    shown.set(element, text);
    element.textContent = text;
    element.hidden = !text;
  };
  const show = (text: string, second: string, align: Align = null) => {
    if (align) line.dataset.align = align;
    else delete line.dataset.align;
    set(line, text);
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
