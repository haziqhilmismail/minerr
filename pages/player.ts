// Plays a video file from this computer with a subtitle overlay that Minerr parses, as on YouTube.
// Content scripts do not run on extension pages, so this page loads the word, popup, and i+1 modules itself.
import '../src/page-text/page.ts';
import '../src/popup/popup.ts';
import '../src/page-text/iplusone.ts';
import '../src/status/stats.ts';
import { parseSubtitles, type SubtitleSegment, toSrt } from '../src/video/captions.ts';
import { byId } from '../src/shared/dom.ts';
import { messageOf } from '../src/shared/rpc.ts';
import { applyTheme } from '../src/shared/theme.ts';
import { attach, layer, setLines } from '../src/video/video.ts';
import { getJob, uploadFile, waitForJob } from '../src/video/whisper.ts';

applyTheme();

const POLL_MS = 1000;

// The subtitles of the open video. Only WhisperX subtitles can be saved: subtitles from a file are already a file.
type Subtitles =
  | { state: 'none' }
  | { state: 'ready'; origin: 'file' | 'whisperx'; name: string; segments: SubtitleSegment[] }
  | { state: 'working'; text: string; progress: number | null }
  | { state: 'failed'; error: string };

const watch = byId('watch', HTMLElement);
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
const secondInput = byId('second-file', HTMLInputElement);

stage.append(layer);
attach({ video: () => video });

let file: File | null = null;
// The SHA-256 of the file, after the WhisperX server got it: the server then has its audio for the sentence audio.
let sha256: string | null = null;
let playError = false;
let subs: Subtitles = { state: 'none' };
// The secondary track from a second subtitle file, for example English, under the line.
let second: { state: 'ready'; name: string; segments: SubtitleSegment[] } | { state: 'failed'; error: string } | null = null;
// Counts the opened videos, so that a job for an earlier video does not change the subtitles of the current one.
let opened = 0;

function secondText(): string {
  if (!second) return '';
  return second.state === 'ready' ? ` Second subtitles from ${second.name}.` : ` ${second.error}`;
}

function statusText(): [string, string] {
  if (playError) return [`Chrome cannot play ${file?.name ?? 'this file'}. Convert it to MP4 or WebM, then open it again.`, 'error'];
  switch (subs.state) {
    case 'none': return ['No subtitles. Add a subtitle file, or generate subtitles with WhisperX.', ''];
    case 'ready': return [`${subs.origin === 'whisperx' ? 'WhisperX subtitles' : `Subtitles from ${subs.name}`}: ${subs.segments.length} lines.${secondText()}`, 'ok'];
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
  setLines(subs.state === 'ready' && file
    ? { kind: 'timed', id: `file:${file.name}:${file.size}`, segments: subs.segments, second: second?.state === 'ready' ? second.segments : null, audio: sha256 ? { sha256 } : null }
    : { kind: 'none' });
}

function setSubs(next: Subtitles): void {
  subs = next;
  render();
}

function openVideo(next: File): void {
  opened++;
  // Subtitles chosen before the first video belong to it; a later video starts without subtitles.
  if (file) {
    subs = { state: 'none' };
    second = null;
  }
  if (video.src) URL.revokeObjectURL(video.src);
  file = next;
  sha256 = null;
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


// The page sends the file to the server itself: a runtime message cannot carry a File, and this page has the host permission.
async function generate(): Promise<void> {
  if (!file) return;
  const mine = opened;
  const stale = () => mine !== opened;
  setSubs({ state: 'working', text: 'Sending the video to the WhisperX server…', progress: null });
  try {
    const upload = await uploadFile(file);
    const { id } = upload;
    if (stale()) return;
    ({ sha256 } = upload);
    const segments = await waitForJob(id, getJob, job => {
      if (stale()) return false;
      setSubs(job.state === 'transcribing'
        ? { state: 'working', text: `Transcribing… ${job.progress}%`, progress: job.progress }
        : { state: 'working', text: 'Waiting for the server…', progress: null });
      return true;
    }, POLL_MS);
    if (segments && !stale()) setSubs({ state: 'ready', origin: 'whisperx', name: 'WhisperX', segments });
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

video.addEventListener('error', () => {
  playError = true;
  render();
});
byId('choose', HTMLButtonElement).addEventListener('click', () => videoInput.click());
byId('add-subs', HTMLButtonElement).addEventListener('click', () => subsInput.click());
byId('add-second', HTMLButtonElement).addEventListener('click', () => secondInput.click());
secondInput.addEventListener('change', async () => {
  const [picked] = secondInput.files ?? [];
  secondInput.value = '';
  if (!picked) return;
  const segments = parseSubtitles(await picked.text());
  second = segments.length
    ? { state: 'ready', name: picked.name, segments }
    : { state: 'failed', error: `${picked.name} has no subtitles that Minerr can read. Use an .srt or .vtt file.` };
  render();
});
generateButton.addEventListener('click', generate);
saveButton.addEventListener('click', save);
byId('fullscreen', HTMLButtonElement).addEventListener('click', () => (document.fullscreenElement ? document.exitFullscreen() : watch.requestFullscreen()));
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
