// The YouTube captions of a video with their times, read in the tab without the Minerr server, as asbplayer and Migaku do.
// src/youtube-main.ts, in the page of YouTube, tells the caption tracks of the player and the token of its caption requests.
import { parseCaptions, type SubtitleSegment } from './captions.ts';
import { at, isList, isString } from './parse.ts';

// A caption track in the player response of YouTube. kind is 'asr' for the automatic captions (speech recognition),
// which YouTube makes only in the language of the video; it lists no translations here.
export interface CaptionTrack {
  languageCode: string;
  kind: string | null;
  vssId: string;
  baseUrl: string;
}

// The caption tracks of a video, and the languages of its audio tracks that YouTube dubbed by machine.
// A dubbed audio track gets its own automatic track: speech recognition of a machine translation.
export interface Captions {
  tracks: CaptionTrack[];
  dubbed: string[];
}

interface PlayerState extends Captions {
  videoId: string | null;
  pot: string | null;
}

// The player of a video with Japanese captions, and the token of its caption requests.
export interface TabPlayer extends Captions {
  pot: string;
}

// Minerr studies Japanese: its Japanese track is never a machine translation (as STUDY_LANG in server/media.py).
const STUDY_LANG = 'ja';
const WAIT_MS = 1000;
// ponytail: the tab waits up to one minute for the player (a long ad can play first), then the overlay copies the captions.
const PLAYER_WAIT_MS = 60_000;
const SHOW_EVERY = 5;

// The track of the uploader in lang first, then the automatic track, as server/media.py pick_track; ja before ja-JP, as the server.
// The automatic Japanese track of a video that YouTube dubbed into Japanese is not the language of the video.
function trackIn({ tracks, dubbed }: Captions, lang: string): CaptionTrack | null {
  const asrAllowed = lang !== STUDY_LANG || !dubbed.includes(lang);
  const matching = tracks.filter(t => (t.languageCode === lang || t.languageCode.startsWith(`${lang}-`)) && (asrAllowed || t.kind !== 'asr'));
  return matching.sort((a, b) => Number(a.kind === 'asr') - Number(b.kind === 'asr') || a.languageCode.length - b.languageCode.length)[0] ?? null;
}

// The URL of the best track in lang, or null. A language other than Japanese can be a translation of the Japanese track (tlang).
export function trackUrl(captions: Captions, lang: string): URL | null {
  const own = trackIn(captions, lang);
  if (own) return new URL(own.baseUrl);
  const japanese = lang === STUDY_LANG ? null : trackIn(captions, STUDY_LANG);
  if (!japanese) return null;
  const url = new URL(japanese.baseUrl);
  url.searchParams.set('tlang', lang);
  return url;
}

function toTrack(value: unknown): CaptionTrack[] {
  const [languageCode, kind, vssId, baseUrl] = ['languageCode', 'kind', 'vssId', 'baseUrl'].map(key => at(value, key));
  if (!isString(languageCode) || !isString(vssId) || !isString(baseUrl)) return [];
  // The page can post anything, so the tab fetches only caption URLs of YouTube.
  const url = new URL(baseUrl, location.origin);
  if (url.origin !== location.origin || url.pathname !== '/api/timedtext') return [];
  return [{ languageCode, kind: isString(kind) ? kind : null, vssId, baseUrl: url.href }];
}

// The id of an audio track is its language and a number, as ja.10.
const dubbedLanguage = (audioTrack: unknown): string[] => {
  const id = at(audioTrack, 'id');
  return at(audioTrack, 'isAutoDubbed') === true && isString(id) ? [id.split(/[.-]/)[0] ?? id] : [];
};

function toPlayerState(event: MessageEvent): PlayerState | null {
  if (event.source !== window || event.origin !== location.origin || at(event.data, 'minerr') !== 'player') return null;
  const [videoId, tracks, audioTracks, pot] = ['videoId', 'tracks', 'audioTracks', 'pot'].map(key => at(event.data, key));
  return {
    videoId: isString(videoId) ? videoId : null,
    tracks: isList(tracks) ? tracks.flatMap(toTrack) : [],
    dubbed: isList(audioTracks) ? audioTracks.flatMap(dubbedLanguage) : [],
    pot: isString(pot) ? pot : null,
  };
}

const post = (message: YoutubePageMessage) => window.postMessage(message, location.origin);

// The state of the player, or null when src/youtube-main.ts does not answer.
function ask(): Promise<PlayerState | null> {
  return new Promise(resolve => {
    const done = (state: PlayerState | null) => {
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      resolve(state);
    };
    const onMessage = (event: MessageEvent) => {
      const state = toPlayerState(event);
      if (state) done(state);
    };
    const timer = setTimeout(() => done(null), WAIT_MS);
    window.addEventListener('message', onMessage);
    post({ minerr: 'ask' });
  });
}

// The player of the video, or null if the video has no Japanese track. wanted() is false when the user opened another video.
// Without a token yet (the captions are off), the tab makes the player show the Japanese track: the player then asks for it with a token.
export async function findTabPlayer(videoId: string, wanted: () => boolean): Promise<TabPlayer | null> {
  const deadline = Date.now() + PLAYER_WAIT_MS;
  for (let i = 0; Date.now() < deadline && wanted(); i++) {
    const state = await ask();
    // After a navigation in the page, the player can have the last video for a moment.
    if (state?.videoId === videoId) {
      const japanese = trackIn(state, STUDY_LANG);
      if (!japanese) return null;
      if (state.pot) return { ...state, pot: state.pot };
      if (i % SHOW_EVERY === 0) post({ minerr: 'show', languageCode: japanese.languageCode, vssId: japanese.vssId });
    }
    await new Promise(resolve => setTimeout(resolve, WAIT_MS));
  }
  return null;
}

// The captions of the video in lang (ja or en), or null.
export async function tabCaptions(player: TabPlayer, lang: string): Promise<SubtitleSegment[] | null> {
  const url = trackUrl(player, lang);
  if (!url) return null;
  for (const [name, value] of Object.entries({ fmt: 'json3', c: 'WEB', potc: '1', pot: player.pot })) url.searchParams.set(name, value);
  const response = await fetch(url);
  const text = response.ok ? await response.text() : '';
  // YouTube answers an empty body when it does not accept the token.
  return text ? parseCaptions('json3', text) : null;
}
