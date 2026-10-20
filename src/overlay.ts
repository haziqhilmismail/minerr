// The large centered subtitle line over a video, on YouTube and on the player page.
// The layer fills its positioned parent as a size container, so the text size follows the video in every view mode.
const STYLE = `
  .minerr-subs { position: absolute; inset: 0; z-index: 60; container-type: size; pointer-events: none; }
  .minerr-subs-line {
    position: absolute; left: 50%; bottom: max(64px, 11cqh); transform: translateX(-50%);
    box-sizing: border-box; width: max-content; max-width: 90cqw; padding: 0.12em 0.55em 0.18em;
    border-radius: 0.3em; background: rgba(10, 10, 14, 0.74); color: #fff; pointer-events: auto;
    font: 500 clamp(20px, min(5.6cqh, 3.4cqw), 64px)/1.45 "Hiragino Sans", "Yu Gothic UI", "Meiryo", "Noto Sans JP", system-ui, sans-serif;
    text-align: center; white-space: pre-line; overflow-wrap: anywhere; text-shadow: 0 1px 3px rgba(0, 0, 0, 0.7);
  }
  .minerr-subs-line[hidden] { display: none; }
`;

export interface Overlay {
  layer: HTMLDivElement;
  show: (text: string) => void;
}

export function createOverlay(): Overlay {
  const layer = Object.assign(document.createElement('div'), { className: 'minerr-subs' });
  const line = Object.assign(document.createElement('div'), { className: 'minerr-subs-line', hidden: true });
  layer.append(line);
  document.head.append(Object.assign(document.createElement('style'), { textContent: STYLE }));
  let shown = '';
  // Replace the text only when it changes: page.ts swaps the text node for word spans, and that must stay.
  const show = (text: string) => {
    if (text === shown) return;
    shown = text;
    line.textContent = text;
    line.hidden = !text;
  };
  return { layer, show };
}
