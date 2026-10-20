import { captionText, segmentAt, type SubtitleSegment } from './captions.ts';
import { call, type Message, messageOf, serve } from './rpc.ts';
import type { Job, JobStatus } from './whisper.ts';

const POLL_MS = 2000;

// YouTube's caption window stays in the DOM (the overlay reads it), but it is invisible and takes no mouse events.
// The layer fills the player as a size container, so the subtitle size follows the player in every view mode.
// When Minerr is off (page.ts sets data-minerr-off on the root), YouTube's own captions come back and the overlay hides.
const STYLE = `
  :root:not([data-minerr-off]) .ytp-caption-window-container { opacity: 0 !important; pointer-events: none !important; }
  :root[data-minerr-off] .minerr-subs { display: none; }
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

// 'youtube' mirrors YouTube's own captions; 'whisperx' shows the segments from the local server.
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

// segments are the WhisperX subtitles of the video, when the server has them.
type OverlayState = { videoId: string | null; job: TrackedJob | null }
  & ({ source: 'youtube'; segments: SubtitleSegment[] | null } | { source: 'whisperx'; segments: SubtitleSegment[] });

let state: OverlayState = { videoId: null, source: 'youtube', segments: null, job: null };

const layer = Object.assign(document.createElement('div'), { className: 'minerr-subs' });
const line = Object.assign(document.createElement('div'), { className: 'minerr-subs-line', hidden: true });
layer.append(line);
document.head.append(Object.assign(document.createElement('style'), { textContent: STYLE }));

let player: Element | null = null;
let shown = '';

const video = () => player?.querySelector('video');
const currentVideoId = () => (location.pathname === '/watch' ? new URLSearchParams(location.search).get('v') : null);

// Replace the text only when it changes: page.ts swaps the text node for word spans, and that must stay.
function show(text: string): void {
  if (text === shown) return;
  shown = text;
  line.textContent = text;
  line.hidden = !text;
}

function render(): void {
  if (state.source === 'whisperx') {
    // An ad plays in the same video element, and its time is not the time of the video.
    const ad = player?.classList.contains('ad-showing');
    show(ad ? '' : segmentAt(state.segments, video()?.currentTime ?? 0)?.text ?? '');
  } else {
    show(captionText([...(player?.querySelectorAll('.caption-visual-line') ?? [])].map(l => l.textContent ?? '')));
  }
}

let frame = 0;
function follow(): void {
  cancelAnimationFrame(frame);
  render();
  const playing = video();
  if (state.source === 'whisperx' && playing && !playing.paused) frame = requestAnimationFrame(follow);
}

const captions = new MutationObserver(() => {
  if (state.source === 'youtube') render();
});

async function changeVideo(videoId: string | null): Promise<void> {
  state = { videoId, source: 'youtube', segments: null, job: null };
  render();
  if (!videoId) return;
  const segments = await call({ type: 'whisperCached', videoId }).catch(() => null);
  if (segments && state.videoId === videoId) useSegments(segments);
}

function useSegments(segments: SubtitleSegment[]): void {
  state = { ...state, source: 'whisperx', segments };
  follow();
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

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const finished = (status: JobStatus) => status.state === 'done' || status.state === 'error';

// The tab polls the job it started, so the result arrives even when the toolbar popup is closed.
async function poll(job: TrackedJob, id: string): Promise<void> {
  while (state.job === job) {
    const reply: Job = await call({ type: 'whisperJob', id })
      .catch((error: unknown): Job => ({ state: 'error', error: messageOf(error) }))
      ?? { state: 'error', error: 'The WhisperX server lost the job. Generate the subtitles again.' };
    if (state.job !== job) return;
    if (reply.state === 'done') {
      job.status = { state: 'done' };
      useSegments(reply.segments);
    } else {
      job.status = reply;
    }
    if (finished(job.status)) return;
    await sleep(POLL_MS);
  }
}

const snapshot = (): Snapshot => ({
  videoId: state.videoId,
  source: state.source,
  hasWhisperx: Boolean(state.segments),
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
    if (!state.segments) throw new Error('No WhisperX subtitles for this video yet.');
    state = { ...state, source: 'whisperx', segments: state.segments };
  } else {
    state = { ...state, source: 'youtube' };
  }
  follow();
  return snapshot();
}

serve({ subsState: snapshot, subsGenerate: generate, subsUse: use }, () => true);

for (const type of ['play', 'seeked', 'timeupdate']) document.addEventListener(type, follow, true);
document.addEventListener('yt-navigate-finish', sync);
setInterval(sync, 1000);
sync();
