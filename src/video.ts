// One video element, its subtitle lines, and the overlay over it. YouTube, the player page, and other sites all use this module.
import type { SubtitleSegment } from './captions.ts';
import { modePause, played, setHold } from './autopause.ts';
import type { CardLine } from './lineaudio.ts';
import { play } from './dom.ts';
import { createLineList } from './linelist.ts';
import { createOverlay, wordStatuses } from './overlay.ts';
import { isEditable } from './chord.ts';
import {
  autoPause, cleanSegments, cleanText, GAP_LEAD, GAP_MODES, gapEnd, type GapMode, jumpTarget, lastStarted, PLAY_MODES, type PlayMode,
} from './playback.ts';
import { recordPart } from './record.ts';
import { serve } from './rpc.ts';
import { isIPlusOne } from './sentence.ts';
import { setTrack } from './stats.ts';
import { type VideoAction, videoKey } from './videokeys.ts';
import {
  cleanSubs, gapMode, playMode, type SecondDisplay, secondDisplay, type SubEffect, subEffect, subObscured, subScale,
} from './videosettings.ts';
import type { AudioSource } from './whisper.ts';

// What the overlay shows. 'timed' lines have times (WhisperX, a subtitle file, the subtitles of the site from the server).
// 'mirror' is the text of the site's own caption window, which has no times.
// id names the video, so a new video starts with no offset. audio is the audio that the server can have of the video.
// second is the secondary track (for example English), which shows under the line with the same offset.
export type Lines =
  | { kind: 'none' }
  | { kind: 'mirror'; text: string }
  | { kind: 'timed'; id: string; segments: SubtitleSegment[]; second: SubtitleSegment[] | null; audio: AudioSource | null };

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
const LIST_HINT = 'The subtitle sidebar needs subtitles with times. Generate them with WhisperX, or start the Minerr server for the YouTube subtitles.';

const { layer, line, show, toast } = createOverlay();
const list = createLineList({ seek: goTo, toast });
let target: Target = { video: () => null };
// The lines from the page, and the lines that the overlay uses: the same, or without bracketed text.
let given: Lines = { kind: 'none' };
let lines: Lines = given;
let clean = false;
let gap: GapMode = 'off';
// The speed of the video before a gap made it faster, while it is faster.
let gapRate: number | null = null;
// True while the tab records a line: no gap rule, play-mode pause, line change, or hold changes the playback.
let recording = false;
// Seconds added to every line time: a positive offset shows the lines later.
let offset = 0;
let scale = 1;
let hinted = false;
// The index of the line on the screen in the timed lines, or -1.
let shownIndex = -1;
let mode: PlayMode = 'normal';
// The line time of the last frame, to see which line edge the video passed.
let lastTime = 0;
// The line that the play mode paused at its end: it stays on the screen until the video plays or seeks.
let heldIndex = -1;
let secondShown: SecondDisplay = 'show';
// The segments in the subtitle sidebar.
let listed: SubtitleSegment[] | null = null;
// The first of two lines that J joined, for one card with both; it ends when the video leaves the two lines.
let combined: number | null = null;

// The host page puts the sidebar in its place, beside the video.
export const sidebar = list.panel;
export { layer, toast };

const video = () => target.video();
const timed = () => (lines.kind === 'timed' && lines.segments.length ? lines : null);
// The time of the video on the clock of the lines.
const lineTime = () => (video()?.currentTime ?? 0) - offset;
const currentIndex = (): number => {
  const time = lineTime();
  return timed()?.segments.findIndex(s => s.start <= time && time < s.end) ?? -1;
};

// The lines in the overlay: the line at the time, or the two joined lines.
function shownLines(): SubtitleSegment[] {
  if (shownIndex < 0) return [];
  const from = combined ?? shownIndex;
  return (timed()?.segments ?? []).slice(from, from + (combined === null ? 1 : 2));
}

// The line stays as it is during a recording, so the word of the open popup stays in the overlay.
function render(): void {
  if (recording) return;
  const found = timed();
  const held = heldIndex >= 0 && video()?.paused;
  shownIndex = found && !target.blocked?.() ? (held ? heldIndex : currentIndex()) : -1;
  if (combined !== null && shownIndex !== combined && shownIndex !== combined + 1) combined = null;
  if (lines.kind === 'mirror') return show(lines.text, '');
  const time = lineTime();
  const second = found && !target.blocked?.() && secondShown !== 'off' ? found.second?.find(s => s.start <= time && time < s.end)?.text : '';
  show(shownLines().map(segment => segment.text).join('\n'), second ?? '');
  // Between two lines, the sidebar keeps the mark on the line before.
  list.setCurrent(shownIndex >= 0 || !found ? shownIndex : lastStarted(found.segments, time));
}

function crossGap(playing: HTMLVideoElement): void {
  const found = timed();
  const mode = GAP_MODES[gap];
  const end = found && mode !== 1 && !recording ? gapEnd(found.segments, lineTime()) : null;
  if (end === null) {
    if (gapRate !== null) playing.playbackRate = gapRate;
    gapRate = null;
  } else if (mode === 'jump') {
    seek(end - GAP_LEAD + offset);
  } else if (gapRate === null) {
    gapRate = playing.playbackRate;
    playing.playbackRate = mode;
  }
}

// Before render, so the overlay still has the words of the line that ends, for the i+1 rule.
function checkPause(playing: HTMLVideoElement): void {
  const found = timed();
  const now = lineTime();
  const index = found && !recording && !playing.paused ? autoPause(found.segments, mode, lastTime, now) : null;
  lastTime = now;
  if (index === null || (PLAY_MODES[mode].only === 'iPlusOne' && !isIPlusOne(wordStatuses(line)))) return;
  if (PLAY_MODES[mode].pause === 'end') heldIndex = index;
  modePause(playing, line);
}

let frame = 0;
function follow(): void {
  cancelAnimationFrame(frame);
  const playing = video();
  if (playing) checkPause(playing);
  render();
  layer.toggleAttribute('data-paused', !playing || playing.paused);
  if (!timed() || !playing || playing.paused) return;
  crossGap(playing);
  frame = requestAnimationFrame(follow);
}

export function attach(next: Target): void {
  target = next;
  follow();
}

const cleaned = (value: Lines): Lines => {
  if (!clean || value.kind === 'none') return value;
  if (value.kind === 'mirror') return { ...value, text: cleanText(value.text) };
  return { ...value, segments: cleanSegments(value.segments), second: value.second && cleanSegments(value.second) };
};

function useLines(next: Lines): void {
  lines = next;
  const segments = lines.kind === 'timed' ? lines.segments : [];
  setTrack(segments);
  if (segments !== listed) {
    listed = segments;
    list.setLines(segments, lines.kind === 'timed' ? lines.id : null, LIST_HINT);
  }
  follow();
}

export function setLines(next: Lines): void {
  const id = (value: Lines) => (value.kind === 'timed' ? value.id : null);
  const nextId = id(next);
  if (nextId !== id(given)) {
    offset = 0;
    hinted = false;
  }
  given = next;
  useLines(cleaned(next));
}

function goTo(index: number): void {
  const segment = timed()?.segments[index];
  if (segment) seek(segment.start + offset);
}

function toggleList(): void {
  list.toggle();
  const full = document.fullscreenElement;
  if (!list.panel.hidden && full && !full.contains(list.panel)) toast('The subtitle sidebar shows when you leave full screen.');
  follow();
}


function seek(time: number): void {
  const playing = video();
  if (playing) playing.currentTime = Math.max(0, time);
}

function jump(kind: 'next' | 'previous' | 'replay'): void {
  const found = timed();
  const start = found && jumpTarget(found.segments, lineTime(), kind);
  if (start === null || start === undefined) return;
  seek(start + offset);
  const playing = video();
  if (kind === 'replay' && playing) play(playing);
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

function toggleObscured(): void {
  subObscured.get().then(on => {
    subObscured.set(!on);
    toast(on ? 'Subtitles shown.' : 'Subtitles obscured until you hover them or pause the video.');
  });
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
  obscure: toggleObscured,
  combine,
  browser: toggleList,
  // render first: a seek just now changed the time, and the seeked event that renders comes later.
  bookmark: () => {
    render();
    toast(list.toggleBookmark(shownIndex));
  },
  second: () => {
    const next = secondShown === 'off' ? 'show' : 'off';
    secondDisplay.set(next);
    toast(next === 'off' ? 'Second subtitles hidden.' : 'Second subtitles shown.');
  },
};

// Capture on window, so the keys of the site (YouTube binds c, j, l, ., and the arrows) do not also fire.
// The overlay takes a key only while it has lines; a key that needs times gets a hint on mirrored captions, once per video.
window.addEventListener('keydown', event => {
  if (event.ctrlKey || event.metaKey || isEditable(event) || !video()) return;
  const entry = videoKey(event);
  if (!entry || lines.kind === 'none' || target.blocked?.()) return;
  if (entry.timed && !timed()) {
    if (lines.kind === 'mirror' && !hinted) toast(TIMED_HINT);
    hinted = true;
    return;
  }
  if (ACTIONS[entry.action]() === false) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);

// The line of the word that the popup shows, for the sentence audio of its card. A word elsewhere on the page has no line.
function cardLine(): CardLine | null {
  const found = timed();
  const word = document.querySelector('.ml-word[data-ml-active]');
  const row = word && list.panel.contains(word) ? list.rowIndex(word) : null;
  const shown = row === null ? shownLines() : found?.segments.slice(row, row + 1) ?? [];
  const [first] = shown;
  const last = shown.at(-1);
  if (!found || !first || !last || !word || (row === null && !line.contains(word))) return null;
  const text = shown.map(segment => segment.text).join('\n');
  return { start: first.start + offset, end: last.end + offset, text, combined: shown.length > 1, audio: found.audio };
}

function combine(): void {
  const segments = timed()?.segments ?? [];
  if (combined === null && (shownIndex < 0 || !segments[shownIndex + 1])) return toast('There is no next line to join.');
  combined = combined === null ? shownIndex : null;
  toast(combined === null ? 'The line is alone again.' : 'Joined the next line: a card gets both lines and their audio.');
  follow();
}

// The holds do not change during a recording, which plays and pauses the video itself. After it, they follow the mouse and the popup again.
async function record({ start, end }: { start: number; end: number }) {
  const playing = video();
  if (!playing) return null;
  recording = true;
  try {
    return await recordPart(playing, start, end);
  } finally {
    recording = false;
    syncHolds();
  }
}

serve({ videoLine: cardLine, videoRecord: record }, target => target === undefined);

let effect: SubEffect = 'blur';
let obscured = false;
const showObscured = () => {
  if (obscured) layer.dataset.obscure = effect;
  else delete layer.dataset.obscure;
};
subEffect.watch(value => { effect = value; showObscured(); });
subObscured.watch(value => { obscured = value; showObscured(); });
cleanSubs.watch(value => {
  clean = value;
  useLines(cleaned(given));
});
gapMode.watch(value => { gap = value; });
playMode.watch(value => { mode = value; });
secondDisplay.watch(value => {
  secondShown = value;
  layer.dataset.second = value;
  follow();
});

// popup.ts marks the word of the open popup with data-ml-active.
function syncHolds(): void {
  const playing = video();
  if (!playing || recording) return;
  setHold(playing, 'hover', line.matches(':hover'));
  setHold(playing, 'popup', [layer, list.panel].some(root => root.querySelector('.ml-word[data-ml-active]') !== null));
}
line.addEventListener('mouseenter', syncHolds);
line.addEventListener('mouseleave', syncHolds);
for (const root of [layer, list.panel]) {
  new MutationObserver(syncHolds).observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-ml-active'] });
}

subScale.watch(value => {
  scale = value;
  layer.style.setProperty('--minerr-scale', String(value));
});

// Media events do not bubble, but the capture phase on the document sees them for any video element.
for (const type of ['play', 'pause', 'seeked', 'timeupdate']) {
  document.addEventListener(type, event => {
    if (event.target !== video()) return;
    if (type === 'play' && !recording) played();
    if (type === 'play' || type === 'seeked') heldIndex = -1;
    if (type !== 'timeupdate') lastTime = lineTime();
    follow();
  }, true);
}
