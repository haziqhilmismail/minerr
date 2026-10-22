// One video element, its subtitle lines, and the overlay over it. YouTube, the player page, and other sites all use this module.
import type { SubtitleSegment } from './captions.ts';
import { modePause, played, setHold } from './autopause.ts';
import type { CardLine } from '../anki/lineaudio.ts';
import { play } from '../shared/dom.ts';
import { toggleBookmark } from './sidebar/bookmarks.ts';
import { type PanelEvent, PORT_NAME, type TabEvent } from './sidebar/sidebar-port.ts';
import { TIMES_SOURCE } from './sidebar/sidebar.ts';
import { type CaptionAnchor, createOverlay, wordStatuses } from './overlay.ts';
import { isPopupOpen } from '../popup/popup.ts';
import { isEditable } from '../popup/chord.ts';
import {
  autoPause, cleanSegments, cleanText, GAP_LEAD, GAP_MODES, gapEnd, type GapMode, jumpTarget, lastStarted, onLine, PLAY_MODES, type PlayMode,
} from './playback.ts';
import { recordPart } from './record.ts';
import { call, messageOf, serve } from '../shared/rpc.ts';
import { isIPlusOne } from '../text/sentence.ts';
import { setTrack } from '../status/stats.ts';
import { type VideoAction, videoKey } from './videokeys.ts';
import {
  cleanSubs, gapMode, pauseOnHover, pauseOnSidebar, playMode, type SecondDisplay, secondDisplay, type SubEffect, subEffect, subObscured, subScale,
} from './videosettings.ts';
import type { AudioSource } from './whisper.ts';

// What the overlay shows. 'timed' lines have times (WhisperX, a subtitle file, the subtitles of the site from the server).
// 'mirror' is the text of the site's own caption window, which has no times. anchor is where that window sits, or null
// for the center.
// id names the video, so a new video starts with no offset. audio is the audio that the server can have of the video.
// second is the secondary track (for example English), which shows under the line with the same offset.
export type Lines =
  | { kind: 'none' }
  | { kind: 'mirror'; text: string; anchor: CaptionAnchor }
  | { kind: 'timed'; id: string; segments: SubtitleSegment[]; second: SubtitleSegment[] | null; audio: AudioSource | null };

export interface Target {
  video: () => HTMLVideoElement | null;
  // True while the video element plays something else, for example an ad on YouTube.
  blocked?: () => boolean;
  // Seeks through the player of the site, when a direct currentTime write upsets it (Netflix). Without it, the video element seeks.
  seek?: (time: number) => void;
}

// A video with DRM (Netflix and other sites): Chrome gives no sound to a recording of it and no picture to a screenshot of it.
// The page sets mediaKeys on such a video, and the video fires encrypted when its data is encrypted.
const encrypted = new WeakSet<EventTarget>();
document.addEventListener('encrypted', event => { if (event.target) encrypted.add(event.target); }, true);
const isProtected = (video: HTMLVideoElement): boolean => video.mediaKeys !== null || encrypted.has(video);
const PROTECTED_HINT = 'Protected video: the card gets no line audio and no screenshot.';

const OFFSET_STEP = 0.1;
const SCALE_STEP = 0.1;
// Most video is 24 to 30 frames per second; one step of 1/30 s shows the next frame or the one after it.
const FRAME = 1 / 30;
const TIMED_HINT = `This key needs subtitles with times. ${TIMES_SOURCE}`;
// A seek that never ends (a stalled network) does not keep a card from the sidebar waiting longer than this.
const SEEK_WAIT_MS = 2000;

const { layer, line, show, toast } = createOverlay();
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
// The segments that the subtitle side panel has.
let listed: SubtitleSegment[] | null = null;
// The ports of the open subtitle side panels of this tab (pages/sidepanel.ts): one, or none.
const panels = new Set<chrome.runtime.Port>();
// True from a G that opens the panel until the port of the panel connects: a second G in that time closes the panel.
let panelAsked = false;
// The line of the open word popup in the side panel, or null. The video pauses for it (pauseOnSidebar), and a card from it gets its audio.
let panelLine: number | null = null;
// The index that the panels have as the current line.
let panelCurrent = -1;
// The first of two lines that J joined, for one card with both; it ends when the video leaves the two lines.
let combined: number | null = null;
// The line that Play in the sidebar plays: the video pauses at its end. A seek out of the line ends it.
let playOnce: { index: number; segment: SubtitleSegment } | null = null;

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
  if (lines.kind === 'mirror') return show(lines.text, '', lines.anchor);
  const time = lineTime();
  const second = found && !target.blocked?.() && secondShown !== 'off' ? found.second?.find(s => s.start <= time && time < s.end)?.text : '';
  show(shownLines().map(segment => segment.text).join('\n'), second ?? '');
  // Between two lines, the sidebar keeps the mark on the line before.
  setPanelCurrent(shownIndex >= 0 || !found ? shownIndex : lastStarted(found.segments, time));
}

const tellPanels = (event: TabEvent) => { for (const panel of panels) panel.postMessage(event); };
const linesEvent = (): TabEvent => {
  const found = timed();
  return { kind: 'lines', id: found?.id ?? null, segments: found?.segments ?? [] };
};

function setPanelCurrent(index: number): void {
  if (index === panelCurrent) return;
  panelCurrent = index;
  tellPanels({ kind: 'current', index });
}

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== PORT_NAME) return;
  panels.add(port);
  panelAsked = false;
  // The sender is the side panel (pages/sidepanel.ts), which sends PanelEvent values.
  port.onMessage.addListener((event: PanelEvent) => {
    panelLine = event.index;
    syncHolds();
  });
  port.onDisconnect.addListener(() => {
    panels.delete(port);
    if (panels.size) return;
    panelLine = null;
    syncHolds();
  });
  port.postMessage(linesEvent());
  port.postMessage({ kind: 'current', index: panelCurrent } satisfies TabEvent);
});

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
  const from = lastTime;
  lastTime = now;
  if (!found || recording || playing.paused) return;
  if (playOnce && autoPause([playOnce.segment], 'after', from, now) !== null) {
    heldIndex = playOnce.index;
    playOnce = null;
    return playing.pause();
  }
  const index = autoPause(found.segments, mode, from, now);
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
    tellPanels(linesEvent());
    // The panels build new cards without a mark; the render after this sends the current line again.
    panelCurrent = -1;
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

function playLine(index: number): void {
  const playing = video();
  const segment = timed()?.segments[index];
  if (!playing || !segment) return;
  goTo(index);
  playOnce = { index, segment };
  play(playing);
}

async function stillAt(index: number): Promise<void> {
  const playing = video();
  if (!playing || !timed()?.segments[index]) return;
  playing.pause();
  const seeked = new Promise(resolve => playing.addEventListener('seeked', resolve, { once: true }));
  goTo(index);
  await Promise.race([seeked, new Promise(resolve => setTimeout(resolve, SEEK_WAIT_MS))]);
}

// The service worker opens the side panel next to this tab, or closes it. Chrome shows no side panel in full screen.
function toggleList(): void {
  const open = !panels.size && !panelAsked;
  panelAsked = open;
  call({ type: 'sidePanel', open }).catch(error => {
    panelAsked = false;
    toast(messageOf(error));
  });
  if (open && document.fullscreenElement) toast('The subtitle sidebar shows when you leave full screen.');
}

function seek(time: number): void {
  const playing = video();
  if (!playing) return;
  const to = Math.max(0, time);
  if (target.seek) target.seek(to);
  else playing.currentTime = to;
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
    const found = timed();
    const segment = found?.segments[shownIndex];
    if (!found || !segment) return toast('Go to a line first, then bookmark it.');
    toggleBookmark(found.id, segment.start).then(toast);
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
  if (!entry || lines.kind === 'none' || target.blocked?.() || (event.key.toLowerCase() === 'a' && isPopupOpen())) return;
  if (entry.timed && !timed()) {
    if (lines.kind === 'mirror' && !hinted) toast(TIMED_HINT);
    hinted = true;
    return;
  }
  if (ACTIONS[entry.action]() === false) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);

// The line of the word that the popup shows, for the sentence audio of its card: the line in the overlay when the popup of
// this page is on a word of it, else the line of the popup in the side panel. A word elsewhere on the page has no line.
function cardLine(): CardLine | null {
  const found = timed();
  if (!found) return null;
  const word = document.querySelector('.ml-word[data-ml-active]');
  if (word && !line.contains(word)) return null;
  const shown = word ? shownLines() : panelLine === null ? [] : found.segments.slice(panelLine, panelLine + 1);
  const [first] = shown;
  const last = shown.at(-1);
  if (!first || !last) return null;
  const text = shown.map(segment => segment.text).join('\n');
  const playing = video();
  const guarded = playing !== null && isProtected(playing);
  if (guarded) toast(PROTECTED_HINT);
  return { start: first.start + offset, end: last.end + offset, text, combined: shown.length > 1, audio: found.audio, protected: guarded };
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

// What a card of the side panel asks of the video (src/video/sidebar/sidebar-port.ts Go).
const GO = { seek: goTo, play: playLine, still: stillAt };

serve({ videoLine: cardLine, videoRecord: record, videoGo: async ({ index, how }) => { await GO[how](index); } }, target => target === undefined);

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

// popup.ts marks the word of the open popup with data-ml-active; the side panel tells its popup line (panelLine).
const hasPopup = (root: HTMLElement) => root.querySelector('.ml-word[data-ml-active]') !== null;
let holdOverlay = true;
let holdSidebar = true;
function syncHolds(): void {
  const playing = video();
  if (!playing || recording) return;
  setHold(playing, 'hover', holdOverlay && line.matches(':hover'));
  setHold(playing, 'popup', holdOverlay && hasPopup(layer));
  setHold(playing, 'sidebar', holdSidebar && panelLine !== null);
}
pauseOnHover.watch(value => { holdOverlay = value; syncHolds(); });
pauseOnSidebar.watch(value => { holdSidebar = value; syncHolds(); });
line.addEventListener('mouseenter', syncHolds);
line.addEventListener('mouseleave', syncHolds);
new MutationObserver(syncHolds).observe(layer, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-ml-active'] });

subScale.watch(value => {
  scale = value;
  layer.style.setProperty('--minerr-scale', String(value));
});

// Media events do not bubble, but the capture phase on the document sees them for any video element.
for (const type of ['play', 'pause', 'seeked', 'timeupdate']) {
  document.addEventListener(type, event => {
    if (event.target !== video()) return;
    // Only a play of the user takes the sidebar back to the current line, not the end of a pause of Minerr.
    const userPlay = type === 'play' && !recording && played() === 'user';
    if (type === 'play' || type === 'seeked') heldIndex = -1;
    if (type === 'seeked' && playOnce && !onLine(playOnce.segment, lineTime())) playOnce = null;
    if (type !== 'timeupdate') lastTime = lineTime();
    follow();
    if (userPlay) tellPanels({ kind: 'played' });
  }, true);
}
