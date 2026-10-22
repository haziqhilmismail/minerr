import { captionText, type SubtitleSegment } from '../captions.ts';
import { SIDE_OPEN } from '../sidebar/sidebar.ts';
import { call, type Message, messageOf, serve } from '../../shared/rpc.ts';
import { attach, layer, type Lines, setLines, sidebar } from '../video.ts';
import type { CaptionAnchor } from '../overlay.ts';
import { secondDisplay } from '../videosettings.ts';
import { type JobStatus, waitForJob } from '../whisper.ts';
import { findTabPlayer, tabCaptions, type TabPlayer } from './youtube-captions.ts';

const POLL_MS = 2000;
const RETRY_MS = 3000;
const MAX_RETRY_MS = 60000;

// YouTube's caption window stays in the DOM (the overlay reads it), but it is invisible and takes no mouse events.
// When Minerr is off (page.ts sets data-minerr-off on the root), YouTube's own captions come back and the overlay hides.
// The open subtitle sidebar (src/video/sidebar/sidebar.ts) narrows the page. The masthead is fixed, so it gets its own right edge.
// The theater player is as high as the narrower page is wide, where YouTube makes it as high as the window is wide.
// YouTube sets the min-width of #columns from the window, wider than the narrower page. Minerr removes that min-width
// and hides #secondary (the recommended videos), so the player column gets the width of the page.
const STYLE = `
  :root:not([data-minerr-off]) .ytp-caption-window-container { opacity: 0 !important; pointer-events: none !important; }
  :root[data-minerr-off] .minerr-subs { display: none; }
  ${SIDE_OPEN} #masthead-container { left: 0 !important; right: var(--minerr-side-width) !important; width: auto !important; }
  ${SIDE_OPEN} ytd-watch-flexy[theater]:not([fullscreen]) #full-bleed-container {
    height: calc((100vw - var(--minerr-side-width)) * 9 / 16) !important;
  }
  ${SIDE_OPEN} ytd-watch-flexy #columns { min-width: 0 !important; }
  ${SIDE_OPEN} ytd-watch-flexy #secondary { display: none !important; }
`;

// 'youtube' shows the YouTube subtitles: with times when the server or the tab got them, else a mirror of YouTube's own captions.
// 'whisperx' shows the WhisperX segments from the local server.
export type Source = 'youtube' | 'whisperx';

// The overlay of a tab, as the toolbar popup shows it.
export interface Snapshot {
  videoId: string | null;
  source: Source;
  hasWhisperx: boolean;
  job: JobStatus | null;
}

// A WhisperX job that this tab started. id is null when the start failed.
interface TrackedJob {
  id: string | null;
  status: JobStatus;
}

// The subtitle tracks of the video, each null until it loads.
// whisperx is from WhisperX; youtube is the Japanese YouTube subtitles with times, from the server (yt-dlp) or from the player in the tab;
// english is the English YouTube subtitles, the secondary track.
interface Tracks {
  whisperx: SubtitleSegment[] | null;
  youtube: SubtitleSegment[] | null;
  english: SubtitleSegment[] | null;
}

// tabPlayer is the YouTube player of the video in this tab, which both YouTube tracks wait for.
interface OverlayState {
  videoId: string | null;
  source: Source;
  tracks: Tracks;
  job: TrackedJob | null;
  tabPlayer: Promise<TabPlayer | null>;
}

const noTracks = (): Tracks => ({ whisperx: null, youtube: null, english: null });
const noPlayer = Promise.resolve(null);
let state: OverlayState = { videoId: null, source: 'youtube', tracks: noTracks(), job: null, tabPlayer: noPlayer };

document.head.append(Object.assign(document.createElement('style'), { textContent: STYLE }));

let player: Element | null = null;

const video = () => player?.querySelector('video') ?? null;
const watchUrl = (videoId: string | null) => `https://www.youtube.com/watch?v=${videoId}`;
const currentVideoId = () => (location.pathname === '/watch' ? new URLSearchParams(location.search).get('v') : null);

// An ad plays in the same video element, and its time is not the time of the video.
attach({ video, blocked: () => player?.classList.contains('ad-showing') ?? false });

function render(): void {
  const { tracks } = state;
  const segments = state.source === 'whisperx' ? tracks.whisperx : tracks.youtube;
  setLines(segments
    ? { kind: 'timed', id: `youtube:${state.videoId}`, segments, second: tracks.english, audio: { url: watchUrl(state.videoId) } }
    : mirror([...(player?.querySelectorAll<HTMLElement>('.caption-visual-line') ?? [])]));
}

const mirror = (rows: HTMLElement[]): Lines =>
  ({ kind: 'mirror', text: captionText(rows.map(row => row.textContent ?? '')), anchor: anchorOf(rows[0]) });

// The caption window of YouTube sets the side of its text (left for the automatic captions), and its lines inherit it.
// Only an explicit left or right counts: start is the default of a window that sets no side. The overlay line starts
// where the window starts, at the left of the video for the automatic captions.
function anchorOf(row: HTMLElement | undefined): CaptionAnchor {
  const side = row ? getComputedStyle(row).textAlign : '';
  const box = row?.closest('.caption-window')?.getBoundingClientRect();
  const area = layer.getBoundingClientRect();
  if ((side !== 'left' && side !== 'right') || !box || !area.width) return null;
  const inset = side === 'left' ? box.left - area.left : area.right - box.right;
  return { side, inset: Math.max(0, inset) / area.width };
}

const captions = new MutationObserver(() => {
  if (state.source === 'youtube' && !state.tracks.youtube) render();
});

function changeVideo(videoId: string | null): void {
  state = { videoId, source: 'youtube', tracks: noTracks(), job: null, tabPlayer: noPlayer };
  render();
  if (!videoId) return;
  state.tabPlayer = findTabPlayer(videoId, () => state.videoId === videoId);
  loadTracks(videoId);
  loadYoutube(track => loadFromTab(videoId, track));
}

// The server can start after the video opened, so the tab asks for the cached WhisperX subtitles until the server answers,
// with twice the wait after each try, up to one minute. Only then does it ask for the YouTube subtitles,
// which take some seconds, because yt-dlp asks YouTube.
function loadTracks(videoId: string, wait = RETRY_MS): void {
  call({ type: 'whisperCached', videoId }).then(segments => {
    if (state.videoId !== videoId) return;
    if (segments) useSegments(segments);
    loadYoutube(track => loadFromServer(videoId, track));
  }, () => setTimeout(() => { if (state.videoId === videoId) loadTracks(videoId, Math.min(wait * 2, MAX_RETRY_MS)); }, wait));
}

type YoutubeTrack = 'youtube' | 'english';
const LANG: Record<YoutubeTrack, string> = { youtube: 'ja', english: 'en' };

// The server and the tab read the same YouTube track, so the first one wins and the lines do not change under the user.
function useYoutube(videoId: string, track: YoutubeTrack, segments: SubtitleSegment[] | null): void {
  if (!segments?.length || state.videoId !== videoId || state.tracks[track]) return;
  state.tracks[track] = segments;
  render();
}

// The Japanese track, then the English track if the second subtitles can show.
function loadYoutube(load: (track: YoutubeTrack) => Promise<void>): void {
  load('youtube').then(() => secondDisplay.get()).then(display => { if (display !== 'off') load('english'); });
}

async function loadFromServer(videoId: string, track: YoutubeTrack): Promise<void> {
  if (state.tracks[track]) return;
  const segments = await call({ type: 'siteCaptions', url: watchUrl(videoId), lang: LANG[track] }).catch(() => null);
  useYoutube(videoId, track, segments);
}

// Works without the server. YouTube can refuse the tab, and then only the server has the track.
async function loadFromTab(videoId: string, track: YoutubeTrack): Promise<void> {
  if (state.videoId !== videoId) return;
  const player = await state.tabPlayer;
  const segments = player && await tabCaptions(player, LANG[track]).catch((error: unknown) => {
    console.warn('minerr: no YouTube captions from the tab', error);
    return null;
  });
  useYoutube(videoId, track, segments);
}

// The second track loads only while it can show: when the video opens, or when the user turns it on (Shift+W, options).
secondDisplay.onChange(display => {
  const { videoId } = state;
  if (display === 'off' || !videoId || state.tracks.english) return;
  loadFromServer(videoId, 'english');
  loadFromTab(videoId, 'english');
});

function useSegments(segments: SubtitleSegment[]): void {
  state.tracks.whisperx = segments;
  state.source = 'whisperx';
  render();
}

// The 1 s check covers the first load and every single-page navigation; yt-navigate-finish only makes it quicker.
function sync(): void {
  const found = document.querySelector('#movie_player');
  if (found !== player) {
    player = found;
    captions.disconnect();
    if (player) captions.observe(player, { childList: true, subtree: true, characterData: true });
  }
  if (player && layer.parentElement !== player) player.append(layer);
  if (sidebar.parentElement !== document.body) document.body.append(sidebar);
  const videoId = currentVideoId();
  if (videoId !== state.videoId) changeVideo(videoId);
}

const finished = (status: JobStatus) => status.state === 'done' || status.state === 'error';

// The tab polls the job it started, so the result arrives even when the toolbar popup is closed.
async function poll(job: TrackedJob, id: string): Promise<void> {
  const current = () => state.job === job;
  try {
    const segments = await waitForJob(id, jobId => call({ type: 'whisperJob', id: jobId }), status => {
      if (current()) job.status = status;
      return current();
    }, POLL_MS);
    if (!segments || !current()) return;
    job.status = { state: 'done' };
    useSegments(segments);
  } catch (error) {
    if (current()) job.status = { state: 'error', error: messageOf(error) };
  }
}

const snapshot = (): Snapshot => ({
  videoId: state.videoId,
  source: state.source,
  hasWhisperx: Boolean(state.tracks.whisperx),
  job: state.job?.status ?? null,
});

async function generate(): Promise<Snapshot> {
  const { videoId } = state;
  if (!videoId) throw new Error('Open a YouTube video first.');
  if (state.job && !finished(state.job.status)) return snapshot();
  // A failed start is a job error too, so the popup keeps showing it on every refresh.
  const job = await call({ type: 'whisperStart', url: location.href }).then(
    ({ id }): TrackedJob => ({ id, status: { state: 'queued' } }),
    (error: unknown): TrackedJob => ({ id: null, status: { state: 'error', error: messageOf(error) } }),
  );
  if (state.videoId === videoId) {
    state.job = job;
    if (job.id) poll(job, job.id);
  }
  return snapshot();
}

function use({ source }: Message<'subsUse'>): Snapshot {
  if (source === 'whisperx') {
    if (!state.tracks.whisperx) throw new Error('No WhisperX subtitles for this video yet.');
    state.source = 'whisperx';
  } else {
    state.source = 'youtube';
  }
  render();
  return snapshot();
}

serve({ subsState: snapshot, subsGenerate: generate, subsUse: use }, () => true);

document.addEventListener('yt-navigate-finish', sync);
setInterval(sync, 1000);
sync();
