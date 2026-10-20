// One video element, its subtitle lines, and the overlay over it. YouTube, the player page, and other sites all use this module.
import { segmentAt, type SubtitleSegment } from './captions.ts';
import { createOverlay } from './overlay.ts';
import { jumpTarget } from './playback.ts';
import { type VideoAction, videoKey } from './videokeys.ts';
import { subScale } from './videosettings.ts';

// What the overlay shows. 'timed' lines have times (WhisperX, a subtitle file, the subtitles of the site from the server).
// 'mirror' is the text of the site's own caption window, which has no times.
// id names the video, so a new video starts with no offset.
export type Lines =
  | { kind: 'none' }
  | { kind: 'mirror'; text: string }
  | { kind: 'timed'; id: string; segments: SubtitleSegment[] };

export interface Target {
  video: () => HTMLVideoElement | null;
  // True while the video element plays something else, for example an ad on YouTube.
  blocked?: () => boolean;
}

const OFFSET_STEP = 0.1;
const SCALE_STEP = 0.1;
// Most video is 24 to 30 frames per second; one step of 1/30 s shows the next frame or the one after it.
const FRAME = 1 / 30;
const TIMED_HINT = 'This key needs subtitles with times. Generate them with WhisperX, or start the Minerr server for the YouTube subtitles.';

const { layer, line, show, toast } = createOverlay();
let target: Target = { video: () => null };
let lines: Lines = { kind: 'none' };
// Seconds added to every line time: a positive offset shows the lines later.
let offset = 0;
let scale = 1;
let hinted = false;

export { layer };

const video = () => target.video();
const isEditable = (node: EventTarget | null) => node instanceof HTMLElement
  && (node.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName));
const timed = () => (lines.kind === 'timed' && lines.segments.length ? lines : null);
// The time of the video on the clock of the lines.
const lineTime = () => (video()?.currentTime ?? 0) - offset;
const current = (): SubtitleSegment | null => {
  const found = timed();
  return found ? segmentAt(found.segments, lineTime()) : null;
};

function render(): void {
  if (lines.kind === 'mirror') show(lines.text);
  else if (timed() && !target.blocked?.()) show(current()?.text ?? '');
  else show('');
}

let frame = 0;
function follow(): void {
  cancelAnimationFrame(frame);
  render();
  const playing = video();
  if (timed() && playing && !playing.paused) frame = requestAnimationFrame(follow);
}

export function attach(next: Target): void {
  target = next;
  follow();
}

export function setLines(next: Lines): void {
  const id = (value: Lines) => (value.kind === 'timed' ? value.id : null);
  if (id(next) !== id(lines)) {
    offset = 0;
    hinted = false;
  }
  lines = next;
  follow();
}

// A pause, a seek, or a new source can interrupt play(); that is not an error.
const play = () => { video()?.play().catch(() => undefined); };

function seek(time: number): void {
  const playing = video();
  if (playing) playing.currentTime = Math.max(0, time);
}

function jump(kind: 'next' | 'previous' | 'replay'): void {
  const found = timed();
  const start = found && jumpTarget(found.segments, lineTime(), kind);
  if (start === null || start === undefined) return;
  seek(start + offset);
  if (kind === 'replay') play();
}

function step(frames: number): void {
  const playing = video();
  if (!playing) return;
  playing.pause();
  seek(playing.currentTime + frames * FRAME);
}

function shift(by: number): void {
  offset = Math.round((offset + by) * 10) / 10;
  toast(`Subtitle offset: ${offset > 0 ? '+' : ''}${offset.toFixed(1)} s`);
  follow();
}

function resize(by: number): void {
  const next = Math.min(3, Math.max(0.5, Math.round((scale + by) * 10) / 10));
  subScale.set(next);
  toast(`Subtitle size: ${Math.round(next * 100)}%`);
}

// The plain text of the line on the screen, from the overlay, so it is the text that the user sees.
function copy(): boolean {
  const text = line.hidden ? '' : line.textContent ?? '';
  if (!text) return false;
  navigator.clipboard.writeText(text).then(() => toast('Copied the line.'), () => toast('Chrome did not allow the copy.'));
  return true;
}

// Each action returns false when it did nothing, so the page gets the key.
const ACTIONS: Record<VideoAction, () => boolean | void> = {
  next: () => jump('next'),
  previous: () => jump('previous'),
  replay: () => jump('replay'),
  back5: () => seek((video()?.currentTime ?? 0) - 5),
  forward5: () => seek((video()?.currentTime ?? 0) + 5),
  copy,
  frameForward: () => step(1),
  frameBack: () => step(-1),
  offsetUp: () => shift(OFFSET_STEP),
  offsetDown: () => shift(-OFFSET_STEP),
  bigger: () => resize(SCALE_STEP),
  smaller: () => resize(-SCALE_STEP),
};

// Capture on window, so the keys of the site (YouTube binds c, j, l, ., and the arrows) do not also fire.
// The overlay takes a key only while it has lines; a key that needs times gets a hint on mirrored captions, once per video.
window.addEventListener('keydown', event => {
  if (event.ctrlKey || event.metaKey || isEditable(event.target) || !video()) return;
  const entry = videoKey(event);
  if (!entry || lines.kind === 'none') return;
  if (entry.timed && !timed()) {
    if (lines.kind === 'mirror' && !hinted) toast(TIMED_HINT);
    hinted = true;
    return;
  }
  if (ACTIONS[entry.action]() === false) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);

subScale.watch(value => {
  scale = value;
  layer.style.setProperty('--minerr-scale', String(value));
});

// Media events do not bubble, but the capture phase on the document sees them for any video element.
for (const type of ['play', 'seeked', 'timeupdate']) {
  document.addEventListener(type, event => {
    if (event.target === video()) follow();
  }, true);
}
