// Runs in the page of Netflix itself (manifest.json "world": "MAIN"), because the player keeps its subtitle list there.
// The player asks Netflix for a manifest and reads the reply with JSON.parse: the reply lists the subtitle tracks of the title
// with the URLs of their files (timedtexttracks). This script keeps that list per title and answers src/video/netflix/netflix-overlay.ts.
// The player asks for the subtitle formats in the profiles of its request: the script adds WebVTT, so the reply has a WebVTT URL
// (as Migaku and Subadub do). A seek goes through the player API, as the Netflix player does not take a direct currentTime write well.
// It has no import or export: Chrome loads content scripts without module support.

// The messages between src/video/netflix/netflix-overlay.ts and this script. This file is a script, so the type is global.
// The page can post messages too, so src/video/netflix/netflix-captions.ts checks each reply.
type NetflixPageMessage =
  | { minerr: 'ask'; movieId: string }
  | { minerr: 'seek'; time: number }
  | { minerr: 'manifest'; movieId: string; tracks: unknown; selected: unknown; known: string[] };

{
  const WEBVTT = 'webvtt-lssdh-ios8';
  const manifests = new Map<string, unknown>();

  const at = (value: unknown, key: string): unknown => (typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined);
  const callOf = (value: unknown, name: string, ...args: unknown[]): unknown => {
    const method = at(value, name);
    return typeof method === 'function' ? Reflect.apply(method, value, args) : undefined;
  };

  const stringify = JSON.stringify;
  JSON.stringify = function (this: unknown, value: unknown, ...rest: unknown[]) {
    const url = at(value, 'url');
    if (typeof url === 'string' && /manifest/i.test(url) && typeof value === 'object' && value !== null) {
      for (const part of Object.values(value)) {
        const profiles = at(part, 'profiles');
        if (Array.isArray(profiles) && !profiles.includes(WEBVTT)) profiles.unshift(WEBVTT);
      }
    }
    return Reflect.apply(stringify, this, [value, ...rest]);
  } as typeof JSON.stringify;

  const parse = JSON.parse;
  JSON.parse = function (this: unknown, ...args: unknown[]) {
    const value: unknown = Reflect.apply(parse, this, args);
    const result = at(value, 'result');
    const movieId = at(result, 'movieId');
    const tracks = at(result, 'timedtexttracks');
    if ((typeof movieId === 'number' || typeof movieId === 'string') && Array.isArray(tracks)) manifests.set(String(movieId), tracks);
    return value;
  } as typeof JSON.parse;

  // The player of the watch page, through the Netflix API, or null. The API changes without notice, so every step can be missing.
  function player(): unknown {
    try {
      const app = at(at(at(Reflect.get(window, 'netflix'), 'appContext'), 'state'), 'playerApp');
      const api = at(callOf(app, 'getAPI'), 'videoPlayer');
      const ids = callOf(api, 'getAllPlayerSessionIds');
      const list = Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
      const id = list.find(found => found.startsWith('watch-')) ?? list[0];
      return id === undefined ? null : (callOf(api, 'getVideoPlayerBySessionId', id) ?? null);
    } catch {
      return null;
    }
  }

  function seek(time: number): void {
    const found = player();
    const api = at(found, 'seek');
    if (typeof api === 'function') {
      try {
        Reflect.apply(api, found, [Math.round(time * 1000)]);
        return;
      } catch (error) {
        console.warn('minerr: the Netflix player refused the seek', error);
      }
    }
    const video = document.querySelector('video');
    if (video) video.currentTime = time;
  }

  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin) return;
    const { minerr, movieId, time } = Object(event.data);
    if (minerr === 'ask' && typeof movieId === 'string') {
      const reply: NetflixPageMessage = {
        minerr: 'manifest',
        movieId,
        tracks: manifests.get(movieId) ?? null,
        selected: at(callOf(player(), 'getTimedTextTrack'), 'trackId'),
        known: [...manifests.keys()],
      };
      window.postMessage(reply, location.origin);
    } else if (minerr === 'seek' && typeof time === 'number' && Number.isFinite(time)) {
      seek(Math.max(0, time));
    }
  });
}
