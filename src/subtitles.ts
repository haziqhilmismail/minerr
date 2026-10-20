import { captionText, type SubtitleSegment } from './captions.ts';
import { call, type Message, messageOf, serve } from './rpc.ts';
import { attach, layer, setLines } from './video.ts';
import { secondDisplay } from './videosettings.ts';
import { type JobStatus, waitForJob } from './whisper.ts';

const POLL_MS = 2000;
const RETRY_MS = 3000;
const MAX_RETRY_MS = 60000;

// YouTube's caption window stays in the DOM (the overlay reads it), but it is invisible and takes no mouse events.
// When Minerr is off (page.ts sets data-minerr-off on the root), YouTube's own captions come back and the overlay hides.
const STYLE = `
  :root:not([data-minerr-off]) .ytp-caption-window-container { opacity: 0 !important; pointer-events: none !important; }
  :root[data-minerr-off] .minerr-subs { display: none; }
`;

// 'youtube' shows the YouTube subtitles: with times when the server downloaded them, else a mirror of YouTube's own captions.
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

// The subtitle tracks of the video, each null until the server has it.
// whisperx is from WhisperX; youtube is the Japanese YouTube subtitles with times, which the server downloads with yt-dlp;
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
  if (videoId) loadTracks(videoId);
}

// The server can start after the video opened, so the tab asks for the cached WhisperX subtitles until the server answers,
// with twice the wait after each try, up to one minute. Only then does it ask for the YouTube subtitles,
// which take some seconds, because yt-dlp asks YouTube.
function loadTracks(videoId: string, wait = RETRY_MS): void {
  call({ type: 'whisperCached', videoId }).then(segments => {
    if (state.videoId !== videoId) return;
    if (segments) useSegments(segments);
    loadSiteCaptions(videoId);
  }, () => setTimeout(() => { if (state.videoId === videoId) loadTracks(videoId, Math.min(wait * 2, MAX_RETRY_MS)); }, wait));
}

function loadSiteCaptions(videoId: string): void {
  const url = watchUrl(videoId);
  call({ type: 'siteCaptions', url, lang: 'ja' }).then(segments => {
    if (!segments?.length || state.videoId !== videoId) return;
    state.tracks.youtube = segments;
    render();
  }, () => undefined);
  secondDisplay.get().then(display => { if (display !== 'off') loadEnglish(videoId); });
}

// The second track loads only while it can show: when the video opens, or when the user turns it on (Shift+W, options).
function loadEnglish(videoId: string): void {
  call({ type: 'siteCaptions', url: watchUrl(videoId), lang: 'en' }).then(segments => {
    if (!segments?.length || state.videoId !== videoId) return;
    state.tracks.english = segments;
    render();
  }, () => undefined);
}

secondDisplay.onChange(display => {
  if (display !== 'off' && state.videoId && !state.tracks.english) loadEnglish(state.videoId);
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
