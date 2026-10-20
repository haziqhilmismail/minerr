import { captionText, type SubtitleSegment } from './captions.ts';
import { SIDE_OPEN } from './linelist.ts';
import { call, type Message, messageOf, serve } from './rpc.ts';
import { attach, layer, setLines, sidebar } from './video.ts';
import { secondDisplay } from './videosettings.ts';
import { type JobStatus, waitForJob } from './whisper.ts';
import { tabCaptions } from './youtube-captions.ts';

const POLL_MS = 2000;
const RETRY_MS = 3000;
const MAX_RETRY_MS = 60000;

// YouTube's caption window stays in the DOM (the overlay reads it), but it is invisible and takes no mouse events.
// When Minerr is off (page.ts sets data-minerr-off on the root), YouTube's own captions come back and the overlay hides.
// The open subtitle sidebar (src/linelist.ts) narrows the page. The masthead is fixed, so it gets its own right edge.
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

interface OverlayState {
  videoId: string | null;
  source: Source;
  tracks: Tracks;
  job: TrackedJob | null;
}

const noTracks = (): Tracks => ({ whisperx: null, youtube: null, english: null });
let state: OverlayState = { videoId: null, source: 'youtube', tracks: noTracks(), job: null };

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
    : { kind: 'mirror', text: captionText([...(player?.querySelectorAll('.caption-visual-line') ?? [])].map(l => l.textContent ?? '')) });
}

const captions = new MutationObserver(() => {
  if (state.source === 'youtube' && !state.tracks.youtube) render();
});

function changeVideo(videoId: string | null): void {
  state = { videoId, source: 'youtube', tracks: noTracks(), job: null };
  render();
  if (!videoId) return;
  loadTracks(videoId);
  // The second track waits for the first, which gets the token of the player.
  loadFromTab(videoId, 'youtube').then(() => secondDisplay.get()).then(display => { if (display !== 'off') loadFromTab(videoId, 'english'); });
}

// The server can start after the video opened, so the tab asks for the cached WhisperX subtitles until the server answers,
// with twice the wait after each try, up to one minute. Only then does it ask for the YouTube subtitles,
// which take some seconds, because yt-dlp asks YouTube.
function loadTracks(videoId: string, wait = RETRY_MS): void {
  call({ type: 'whisperCached', videoId }).then(segments => {
    if (state.videoId !== videoId) return;
    if (segments) useSegments(segments);
    loadFromServer(videoId, 'youtube');
    secondDisplay.get().then(display => { if (display !== 'off') loadFromServer(videoId, 'english'); });
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

function loadFromServer(videoId: string, track: YoutubeTrack): void {
  if (state.tracks[track]) return;
  call({ type: 'siteCaptions', url: watchUrl(videoId), lang: LANG[track] }).then(segments => useYoutube(videoId, track, segments), () => undefined);
}

// Works without the server. YouTube can refuse the tab, and then only the server has the track.
function loadFromTab(videoId: string, track: YoutubeTrack): Promise<void> {
  return tabCaptions(videoId, LANG[track], () => state.videoId === videoId)
    .then(segments => useYoutube(videoId, track, segments), error => console.warn('minerr: no YouTube captions from the tab', error));
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
