// The subtitle overlay on a page that is not YouTube: on the largest visible video, with subtitles from a file,
// from the site through the server (yt-dlp), or from WhisperX. The toolbar popup starts it, so other pages load nothing more.
import { parseSubtitles, type SubtitleSegment } from './captions.ts';
import { followVideo } from './overlay.ts';
import { GLASS } from '../shared/design-tokens.ts';
import { call, messageOf, serve } from '../shared/rpc.ts';
import { waitForJob } from './whisper.ts';

const POLL_MS = 2000;
const BAR_STYLE = `
  .minerr-site-bar { position: absolute; top: var(--space-3); left: var(--space-3); display: flex; flex-wrap: wrap; gap: var(--space-1); padding: var(--space-1);
    border-radius: var(--radius-pill); ${GLASS}
    box-shadow: var(--edge), var(--shadow-2); pointer-events: auto; font: 600 var(--text-footnote)/1.4 var(--font-ui); }
  .minerr-site-bar button { min-height: 32px; padding: 0 var(--space-3); border: 0; border-radius: var(--radius-pill); background: transparent;
    color: var(--text); font: inherit; cursor: pointer; transition: background-color var(--fast) var(--ease); }
  .minerr-site-bar button:hover { background: var(--raised); }
  .minerr-site-bar button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
`;

const area = (video: HTMLVideoElement) => {
  const rect = video.getBoundingClientRect();
  const width = Math.min(rect.right, innerWidth) - Math.max(rect.left, 0);
  const height = Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0);
  return width > 0 && height > 0 ? width * height : 0;
};

// The largest video on the screen, or null. A video inside a frame is not in this document, so it does not count.
function mainVideo(): HTMLVideoElement | null {
  const [best] = [...document.querySelectorAll('video')].map(video => ({ video, size: area(video) }))
    .filter(({ size }) => size > 0).sort((a, b) => b.size - a.size);
  return best?.video ?? null;
}

let started: Promise<void> | null = null;

async function start(video: HTMLVideoElement): Promise<void> {
  const { attach, layer, setLines, toast } = await import('./video.ts');
  const url = location.href;
  let primary: SubtitleSegment[] = [];
  let second: SubtitleSegment[] | null = null;
  const use = () => setLines(primary.length
    ? { kind: 'timed', id: `page:${url}`, segments: primary, second, audio: { url } }
    : { kind: 'none' });

  followVideo(video, layer);
  attach({ video: () => (video.isConnected ? video : null) });

  const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.srt,.vtt', hidden: true });
  input.addEventListener('change', async () => {
    const [file] = input.files ?? [];
    input.value = '';
    if (!file) return;
    const segments = parseSubtitles(await file.text());
    if (!segments.length) return toast(`${file.name} has no subtitles that Minerr can read. Use an .srt or .vtt file.`);
    primary = segments;
    use();
    toast(`Subtitles from ${file.name}: ${segments.length} lines.`);
  });

  async function fromSite(): Promise<void> {
    toast('Asking the Minerr server for the subtitles of this page…');
    try {
      const found = await call({ type: 'siteCaptions', url, lang: 'ja' });
      if (!found?.length) return toast('This page has no Japanese subtitles that yt-dlp can find. Try WhisperX or a file.');
      primary = found;
      second = await call({ type: 'siteCaptions', url, lang: 'en' }).catch(() => null);
      use();
      toast(`Subtitles of the site: ${found.length} lines.`);
    } catch (error) {
      toast(messageOf(error));
    }
  }

  async function whisperx(): Promise<void> {
    try {
      const { id } = await call({ type: 'whisperStart', url });
      const segments = await waitForJob(id, jobId => call({ type: 'whisperJob', id: jobId }), job => {
        toast(job.state === 'transcribing' ? `WhisperX: transcribing… ${job.progress}%` : 'WhisperX: downloading the audio…');
        return true;
      }, POLL_MS);
      if (!segments) return;
      primary = segments;
      use();
      toast(`WhisperX subtitles: ${segments.length} lines.`);
    } catch (error) {
      toast(messageOf(error));
    }
  }

  const button = (text: string, onclick: () => void) => Object.assign(document.createElement('button'), { type: 'button', textContent: text, onclick });
  const bar = Object.assign(document.createElement('div'), { className: 'minerr-site-bar' });
  bar.append(
    button('Subtitle file', () => input.click()),
    button('Subtitles of the site', fromSite),
    button('WhisperX', whisperx),
    button('Hide these buttons', () => { bar.hidden = true; }),
    input,
  );
  document.head.append(Object.assign(document.createElement('style'), { textContent: BAR_STYLE }));
  layer.append(bar);
  use();
}

function attachHere(): string {
  const video = mainVideo();
  if (!video) throw new Error('This page has no video on the screen. A video inside a frame does not count.');
  started ??= start(video);
  return 'Minerr shows its subtitle overlay on the video. Use the buttons at the top left of the video.';
}

serve({ videoAttach: attachHere }, target => target === undefined);
