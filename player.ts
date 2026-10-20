// Plays a video file from this computer with a subtitle overlay that Minerr parses, as on YouTube.
// Content scripts do not run on extension pages, so this page loads the word, popup, and i+1 modules itself.
import './src/page.ts';
import './src/popup.ts';
import './src/iplusone.ts';
import { parseSubtitles, segmentAt, type SubtitleSegment, toSrt } from './src/captions.ts';
import { byId } from './src/dom.ts';
import { createOverlay } from './src/overlay.ts';
import { messageOf } from './src/rpc.ts';
import { applyTheme } from './src/theme.ts';
import { getJob, uploadFile } from './src/whisper.ts';

applyTheme();

const POLL_MS = 1000;

// The subtitles of the open video. Only WhisperX subtitles can be saved: subtitles from a file are already a file.
type Subtitles =
  | { state: 'none' }
  | { state: 'ready'; origin: 'file' | 'whisperx'; name: string; segments: SubtitleSegment[] }
  | { state: 'working'; text: string; progress: number | null }
  | { state: 'failed'; error: string };

const stage = byId('stage', HTMLElement);
const drop = byId('drop', HTMLElement);
const video = byId('video', HTMLVideoElement);
const bar = byId('bar', HTMLElement);
const status = byId('status', HTMLElement);
const progress = byId('progress', HTMLProgressElement);
const generateButton = byId('generate', HTMLButtonElement);
const saveButton = byId('save', HTMLButtonElement);
const hint = byId('hint', HTMLElement);
const videoInput = byId('video-file', HTMLInputElement);
const subsInput = byId('subs-file', HTMLInputElement);

const { layer, show } = createOverlay();
stage.append(layer);

let file: File | null = null;
let playError = false;
let subs: Subtitles = { state: 'none' };
// Counts the opened videos, so that a job for an earlier video does not change the subtitles of the current one.
let opened = 0;

let frame = 0;
function follow(): void {
  cancelAnimationFrame(frame);
  show(subs.state === 'ready' ? segmentAt(subs.segments, video.currentTime)?.text ?? '' : '');
  if (!video.paused) frame = requestAnimationFrame(follow);
}

function statusText(): [string, string] {
  if (playError) return [`Chrome cannot play ${file?.name ?? 'this file'}. Convert it to MP4 or WebM, then open it again.`, 'error'];
  switch (subs.state) {
    case 'none': return ['No subtitles. Add a subtitle file, or generate subtitles with WhisperX.', ''];
    case 'ready': return [`${subs.origin === 'whisperx' ? 'WhisperX subtitles' : `Subtitles from ${subs.name}`}: ${subs.segments.length} lines.`, 'ok'];
    case 'working': return [subs.text, ''];
    case 'failed': return [subs.error, 'error'];
    default: {
      const exhaustive: never = subs;
      return exhaustive;
    }
  }
}

function render(): void {
  const loaded = file !== null;
  stage.classList.toggle('empty', !loaded);
  drop.hidden = loaded;
  video.hidden = !loaded;
  bar.hidden = !loaded;
  hint.hidden = subs.state !== 'ready';
  [status.textContent, status.className] = statusText();
  generateButton.disabled = subs.state === 'working';
  saveButton.hidden = !(subs.state === 'ready' && subs.origin === 'whisperx');
  progress.hidden = subs.state !== 'working';
  // WhisperX reports 0% until its first chunk is done, so 0 shows the moving bar of unknown progress too.
  if (subs.state === 'working' && subs.progress) progress.value = subs.progress;
  else progress.removeAttribute('value');
  follow();
}

function setSubs(next: Subtitles): void {
  subs = next;
  render();
}

function openVideo(next: File): void {
  opened++;
  // Subtitles chosen before the first video belong to it; a later video starts without subtitles.
  if (file) subs = { state: 'none' };
  if (video.src) URL.revokeObjectURL(video.src);
  file = next;
  playError = false;
  video.src = URL.createObjectURL(next);
  document.title = `${next.name} - Minerr`;
  render();
}

async function openSubtitles(subtitle: File): Promise<void> {
  const segments = parseSubtitles(await subtitle.text());
  setSubs(segments.length
    ? { state: 'ready', origin: 'file', name: subtitle.name, segments }
    : { state: 'failed', error: `${subtitle.name} has no subtitles that Minerr can read. Use an .srt or .vtt file.` });
}

const isSubtitleFile = (candidate: File) => /\.(srt|vtt)$/i.test(candidate.name);

async function open(files: File[]): Promise<void> {
  const media = files.find(candidate => !isSubtitleFile(candidate));
  const subtitle = files.find(isSubtitleFile);
  if (media) openVideo(media);
  if (subtitle) await openSubtitles(subtitle);
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// The page sends the file to the server itself: a runtime message cannot carry a File, and this page has the host permission.
async function generate(): Promise<void> {
  if (!file) return;
  const mine = opened;
  const stale = () => mine !== opened;
  setSubs({ state: 'working', text: 'Sending the video to the WhisperX server…', progress: null });
  try {
    const { id } = await uploadFile(file);
    for (;;) {
      const job = await getJob(id);
      if (stale()) return;
      if (!job) throw new Error('The WhisperX server lost the job. Generate the subtitles again.');
      if (job.state === 'error') throw new Error(job.error);
      if (job.state === 'done') {
        setSubs({ state: 'ready', origin: 'whisperx', name: 'WhisperX', segments: job.segments });
        return;
      }
      setSubs(job.state === 'transcribing'
        ? { state: 'working', text: `Transcribing… ${job.progress}%`, progress: job.progress }
        : { state: 'working', text: 'Waiting for the server…', progress: null });
      await sleep(POLL_MS);
    }
  } catch (error) {
    if (!stale()) setSubs({ state: 'failed', error: messageOf(error) });
  }
}

// The .srt file gets the name of the video, so video players load it with the video.
function save(): void {
  if (subs.state !== 'ready' || !file) return;
  const href = URL.createObjectURL(new Blob([toSrt(subs.segments)], { type: 'application/x-subrip' }));
  Object.assign(document.createElement('a'), { href, download: `${file.name.replace(/\.[^.]+$/, '')}.srt` }).click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

for (const type of ['play', 'seeked', 'timeupdate']) video.addEventListener(type, follow);
video.addEventListener('error', () => {
  playError = true;
  render();
});
byId('choose', HTMLButtonElement).addEventListener('click', () => videoInput.click());
byId('add-subs', HTMLButtonElement).addEventListener('click', () => subsInput.click());
generateButton.addEventListener('click', generate);
saveButton.addEventListener('click', save);
byId('fullscreen', HTMLButtonElement).addEventListener('click', () => (document.fullscreenElement ? document.exitFullscreen() : stage.requestFullscreen()));
for (const input of [videoInput, subsInput]) {
  input.addEventListener('change', async () => {
    await open([...input.files ?? []]);
    input.value = '';
  });
}

document.addEventListener('dragover', event => {
  event.preventDefault();
  document.body.classList.add('dragging');
});
document.addEventListener('dragleave', event => {
  if (!event.relatedTarget) document.body.classList.remove('dragging');
});
document.addEventListener('drop', event => {
  event.preventDefault();
  document.body.classList.remove('dragging');
  open([...event.dataTransfer?.files ?? []]);
});
render();
