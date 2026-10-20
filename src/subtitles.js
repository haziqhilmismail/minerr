import { captionText, segmentAt } from './captions.js';
import { call, serve } from './rpc.js';

const POLL_MS = 2000;
const FINISHED = ['done', 'error'];

// YouTube's caption window stays in the DOM (the overlay reads it), but it is invisible and takes no mouse events.
// The layer fills the player as a size container, so the subtitle size follows the player in every view mode.
const STYLE = `
  .ytp-caption-window-container { opacity: 0 !important; pointer-events: none !important; }
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

// source is 'youtube' (mirror YouTube's own captions) or 'whisperx' (segments from the local server, when present).
let state = { videoId: null, source: 'youtube', segments: null, job: null };

const layer = Object.assign(document.createElement('div'), { className: 'minerr-subs' });
const line = Object.assign(document.createElement('div'), { className: 'minerr-subs-line', hidden: true });
layer.append(line);
document.head.append(Object.assign(document.createElement('style'), { textContent: STYLE }));

let player = null;
let shown = '';

const video = () => player?.querySelector('video');
const currentVideoId = () => (location.pathname === '/watch' ? new URLSearchParams(location.search).get('v') : null);

// Replace the text only when it changes: page.js swaps the text node for word spans, and that must stay.
function show(text) {
  if (text === shown) return;
  shown = text;
  line.textContent = text;
  line.hidden = !text;
}

function render() {
  if (state.source === 'whisperx') {
    show(segmentAt(state.segments, video()?.currentTime ?? 0)?.text ?? '');
  } else {
    show(captionText([...(player?.querySelectorAll('.caption-visual-line') ?? [])].map(l => l.textContent)));
  }
}

let frame = 0;
function follow() {
  cancelAnimationFrame(frame);
  render();
  if (state.source === 'whisperx' && video() && !video().paused) frame = requestAnimationFrame(follow);
}

const captions = new MutationObserver(() => {
  if (state.source === 'youtube') render();
});

async function changeVideo(videoId) {
  state = { videoId, source: 'youtube', segments: null, job: null };
  render();
  if (!videoId) return;
  const segments = await call({ type: 'whisperCached', videoId }).catch(() => null);
  if (segments && state.videoId === videoId) useSegments(segments);
}

function useSegments(segments) {
  state.segments = segments;
  state.source = 'whisperx';
  follow();
}

// The 1 s check covers the first load and every single-page navigation; yt-navigate-finish only makes it quicker.
function sync() {
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

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// The tab polls the job it started, so the result arrives even when the toolbar popup is closed.
async function poll(job) {
  while (state.job === job) {
    const reply = await call({ type: 'whisperJob', id: job.id })
      .catch(error => ({ state: 'error', error: error.message }))
      ?? { state: 'error', error: 'The WhisperX server lost the job. Generate the subtitles again.' };
    if (state.job !== job) return;
    Object.assign(job, { state: reply.state, progress: reply.progress, error: reply.error });
    if (reply.state === 'done') useSegments(reply.segments);
    if (FINISHED.includes(reply.state)) return;
    await sleep(POLL_MS);
  }
}

const snapshot = () => ({
  videoId: state.videoId,
  source: state.source,
  hasWhisperx: Boolean(state.segments),
  job: state.job && { state: state.job.state, progress: state.job.progress, error: state.job.error },
});

async function generate() {
  const { videoId } = state;
  if (!videoId) throw new Error('Open a YouTube video first.');
  if (state.job && !FINISHED.includes(state.job.state)) return snapshot();
  // A failed start is a job error too, so the popup keeps showing it on every refresh.
  const job = await call({ type: 'whisperStart', url: location.href })
    .then(({ id }) => ({ id, state: 'queued' }), error => ({ state: 'error', error: error.message }));
  if (state.videoId === videoId) {
    state.job = job;
    if (job.id) poll(job);
  }
  return snapshot();
}

function use({ source }) {
  if (source === 'whisperx' && !state.segments) throw new Error('No WhisperX subtitles for this video yet.');
  state.source = source === 'whisperx' ? 'whisperx' : 'youtube';
  follow();
  return snapshot();
}

serve({ subsState: snapshot, subsGenerate: generate, subsUse: use }, () => true);

for (const type of ['play', 'seeked', 'timeupdate']) document.addEventListener(type, follow, true);
document.addEventListener('yt-navigate-finish', sync);
setInterval(sync, 1000);
sync();
