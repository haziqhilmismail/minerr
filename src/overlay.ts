// The large centered subtitle line over a video, on YouTube, on the player page, and on other sites.
// The layer fills its positioned parent as a size container, so the text size follows the video in every view mode.
const STYLE = `
  .minerr-subs { position: absolute; inset: 0; z-index: 60; container-type: size; pointer-events: none; --minerr-scale: 1; }
  .minerr-subs-stack {
    position: absolute; left: 50%; bottom: max(64px, 11cqh); transform: translateX(-50%);
    display: flex; flex-direction: column; align-items: center; gap: 0.3em; width: max-content; max-width: 90cqw;
    font: 500 calc(clamp(20px, min(5.6cqh, 3.4cqw), 64px) * var(--minerr-scale))/1.45 "Hiragino Sans", "Yu Gothic UI", "Meiryo", "Noto Sans JP", system-ui, sans-serif;
  }
  .minerr-subs-line {
    box-sizing: border-box; max-width: 100%; padding: 0.12em 0.55em 0.18em;
    border-radius: 0.3em; background: rgba(10, 10, 14, 0.74); color: #fff; pointer-events: auto;
    text-align: center; white-space: pre-line; overflow-wrap: anywhere; text-shadow: 0 1px 3px rgba(0, 0, 0, 0.7);
  }
  .minerr-subs-line[hidden], .minerr-subs-toast[hidden] { display: none; }
  .minerr-subs-toast {
    position: absolute; top: 12px; left: 50%; transform: translateX(-50%); max-width: 80cqw; padding: 6px 12px;
    border-radius: 6px; background: rgba(10, 10, 14, 0.85); color: #fff; font: 600 14px/1.4 system-ui, sans-serif; text-align: center;
  }
`;

const TOAST_MS = 2500;

export interface Overlay {
  layer: HTMLDivElement;
  line: HTMLDivElement;
  show: (text: string) => void;
  toast: (text: string) => void;
}

export function createOverlay(): Overlay {
  const layer = Object.assign(document.createElement('div'), { className: 'minerr-subs' });
  const stack = Object.assign(document.createElement('div'), { className: 'minerr-subs-stack' });
  const line = Object.assign(document.createElement('div'), { className: 'minerr-subs-line', hidden: true });
  const note = Object.assign(document.createElement('div'), { className: 'minerr-subs-toast', hidden: true, role: 'status' });
  stack.append(line);
  layer.append(stack, note);
  document.head.append(Object.assign(document.createElement('style'), { textContent: STYLE }));
  let shown = '';
  // Replace the text only when it changes: page.ts swaps the text node for word spans, and that must stay.
  const show = (text: string) => {
    if (text === shown) return;
    shown = text;
    line.textContent = text;
    line.hidden = !text;
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
