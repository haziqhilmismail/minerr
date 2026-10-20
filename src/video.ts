// One video element, its subtitle lines, and the overlay over it. YouTube, the player page, and other sites all use this module.
import { segmentAt, type SubtitleSegment } from './captions.ts';
import { createOverlay } from './overlay.ts';

// What the overlay shows. 'timed' lines have times (WhisperX, a subtitle file, the subtitles of the site from the server).
// 'mirror' is the text of the site's own caption window, which has no times.
export type Lines =
  | { kind: 'none' }
  | { kind: 'mirror'; text: string }
  | { kind: 'timed'; segments: SubtitleSegment[] };

export interface Target {
  video: () => HTMLVideoElement | null;
  // True while the video element plays something else, for example an ad on YouTube.
  blocked?: () => boolean;
}

const { layer, show } = createOverlay();
let target: Target = { video: () => null };
let lines: Lines = { kind: 'none' };

export { layer };

const video = () => target.video();

function render(): void {
  if (lines.kind === 'mirror') show(lines.text);
  else if (lines.kind === 'timed' && !target.blocked?.()) show(segmentAt(lines.segments, video()?.currentTime ?? 0)?.text ?? '');
  else show('');
}

let frame = 0;
function follow(): void {
  cancelAnimationFrame(frame);
  render();
  const playing = video();
  if (lines.kind === 'timed' && playing && !playing.paused) frame = requestAnimationFrame(follow);
}

export function attach(next: Target): void {
  target = next;
  follow();
}

export function setLines(next: Lines): void {
  lines = next;
  follow();
}

// Media events do not bubble, but the capture phase on the document sees them for any video element.
for (const type of ['play', 'seeked', 'timeupdate']) {
  document.addEventListener(type, event => {
    if (event.target === video()) follow();
  }, true);
}
