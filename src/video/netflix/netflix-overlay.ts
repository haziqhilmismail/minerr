// The subtitle overlay on Netflix, with the Japanese subtitles of the title and their times, read in the tab.
// src/video/netflix/netflix-main.ts, in the page of Netflix, keeps the subtitle list of each title and seeks through the player.
// Netflix has DRM: the server cannot download the video, so the overlay has no WhisperX and no line audio (src/video/video.ts).
import { askPage } from '../ask-page.ts';
import type { SubtitleSegment } from '../captions.ts';
import { choose, fetchTrack, type Manifest, type PageReply, toReply } from './netflix-captions.ts';
import { followVideo } from '../overlay.ts';
import { serve } from '../../shared/rpc.ts';
import { attach, layer, setLines, toast } from '../video.ts';
import { secondDisplay } from '../videosettings.ts';

const WAIT_MS = 1000;
// The watch page: /watch/<id>, where the id is the movieId of the manifest.
const WATCH = /^\/watch\/(\d+)/;

// Netflix's own subtitles stay in the DOM, but they are invisible while the overlay has lines (data-minerr-netflix on the root).
const STYLE = `
  :root[data-minerr-netflix]:not([data-minerr-off]) .player-timedtext { opacity: 0 !important; pointer-events: none !important; }
  :root[data-minerr-off] .minerr-subs { display: none; }
`;

// What the tab has for a track of the title: its lines, or why it has none (nofile: Netflix gave no file for the track).
type Loaded = { kind: 'lines'; lines: SubtitleSegment[] } | { kind: 'image' } | { kind: 'none' } | { kind: 'nofile' };

// The title in the tab. manifest and the tracks are null until they load; known is from the last reply of the page script.
interface TitleState {
  movieId: string;
  manifest: Manifest | null;
  known: string[];
  japanese: Loaded | null;
  english: Loaded | null;
}

const NO_TITLE = 'Open a title on Netflix (a /watch/ page) first.';
const REASONS: Record<Exclude<Loaded, { kind: 'lines' }>['kind'], string> = {
  image: 'The Japanese subtitles of this title are images. Minerr cannot read them.',
  none: 'This title has no Japanese subtitles.',
  nofile: 'Netflix gave no subtitle file for the Japanese track. Reload the page.',
};
let state: TitleState | null = null;
let video: HTMLVideoElement | null = null;

document.head.append(Object.assign(document.createElement('style'), { textContent: STYLE }));

const post = (message: NetflixPageMessage) => window.postMessage(message, location.origin);
attach({ video: () => video, seek: time => post({ minerr: 'seek', time }) });

// What the overlay has, for the toolbar popup and the toast.
function status(title: TitleState): string {
  if (!title.manifest) {
    return title.known.length ? `The player has the subtitle list of ${title.known.join(', ')}, not of ${title.movieId}.` : 'The player gave no subtitle list yet.';
  }
  if (!title.japanese) return 'Reading the Japanese track…';
  return title.japanese.kind === 'lines' ? `Netflix subtitles with times: ${title.japanese.lines.length} lines.` : REASONS[title.japanese.kind];
}

const lines = (loaded: Loaded | null) => (loaded?.kind === 'lines' ? loaded.lines : null);

function render(): void {
  const japanese = state && lines(state.japanese);
  document.documentElement.toggleAttribute('data-minerr-netflix', Boolean(japanese));
  setLines(state && japanese
    ? { kind: 'timed', id: `netflix:${state.movieId}`, segments: japanese, second: lines(state.english), audio: null }
    : { kind: 'none' });
}

const ask = (movieId: string): Promise<PageReply | null> =>
  askPage<PageReply>({ minerr: 'ask', movieId } satisfies NetflixPageMessage, data => toReply(data, movieId), WAIT_MS);

async function loadTrack(manifest: Manifest, lang: string): Promise<Loaded> {
  const choice = choose(manifest, lang);
  if (choice.kind !== 'text') return choice;
  const found = await fetchTrack(choice).catch((error: unknown) => {
    console.warn('minerr: no Netflix subtitles from the tab', error);
    return null;
  });
  return found ? { kind: 'lines', lines: found } : { kind: 'nofile' };
}

async function loadEnglish(title: TitleState): Promise<void> {
  if (!title.manifest || title.english) return;
  const loaded = await loadTrack(title.manifest, 'en');
  if (state !== title) return;
  title.english = loaded;
  render();
}

// The manifest arrives when the player starts the title, so the tab asks each second until it has it or the user leaves the title.
async function load(title: TitleState): Promise<void> {
  while (state === title && !title.manifest) {
    const reply = await ask(title.movieId);
    if (state !== title) return;
    if (reply) Object.assign(title, reply);
    if (!title.manifest) await new Promise(resolve => setTimeout(resolve, WAIT_MS));
  }
  const { manifest } = title;
  if (state !== title || !manifest) return;
  const japanese = await loadTrack(manifest, 'ja');
  if (state !== title) return;
  title.japanese = japanese;
  if (japanese.kind !== 'lines') toast(status(title));
  render();
  if ((await secondDisplay.get()) !== 'off') loadEnglish(title);
}

// The second track loads only while it can show: when the title opens, or when the user turns it on (Shift+W, options).
secondDisplay.onChange(display => {
  if (display !== 'off' && state) loadEnglish(state);
});

function sync(): void {
  const found = document.querySelector('video');
  if (found !== video) {
    video = found;
    if (video) followVideo(video, layer);
  }
  const movieId = WATCH.exec(location.pathname)?.[1] ?? null;
  if (movieId === (state?.movieId ?? null)) return;
  state = movieId === null ? null : { movieId, manifest: null, known: [], japanese: null, english: null };
  render();
  if (state) load(state);
}

serve({ videoAttach: () => (state ? status(state) : NO_TITLE) }, target => target === undefined);

setInterval(sync, WAIT_MS);
sync();
