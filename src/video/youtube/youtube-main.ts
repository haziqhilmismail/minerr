// Runs in the page of YouTube itself (manifest.json "world": "MAIN"), because the player and its caption requests are there.
// YouTube sends a caption track only with the proof-of-origin token (pot) of its player: a fetch without it gets an empty reply.
// This script keeps the token of the last caption request of the player, and answers src/video/youtube/youtube-captions.ts.
// It has no import or export: Chrome loads content scripts without module support.

// The messages between src/video/youtube/youtube-captions.ts and this script. This file is a script, so the type is global.
// The page can post messages too, so src/video/youtube/youtube-captions.ts checks each reply.
type YoutubePageMessage =
  | { minerr: 'ask' }
  | { minerr: 'show'; languageCode: string; vssId: string }
  | { minerr: 'player'; videoId: string | null; tracks: unknown; audioTracks: unknown[]; pot: string | null };

{
  interface Player extends HTMLElement {
    getPlayerResponse?(): unknown;
    loadModule?(name: string): void;
    unloadModule?(name: string): void;
    setOption?(module: string, option: string, value: object): void;
  }
  interface PlayerResponse {
    videoDetails?: { videoId?: unknown };
    captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: unknown } };
    streamingData?: { adaptiveFormats?: { audioTrack?: unknown }[] };
  }

  let token: { videoId: string; pot: string } | null = null;

  // The player asks for captions with XMLHttpRequest, not fetch (YouTube, October 2026).
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, ...args: [method: string, url: string | URL, ...rest: unknown[]]) {
    const url = new URL(args[1], location.href);
    const videoId = url.searchParams.get('v');
    const pot = url.searchParams.get('pot');
    if (url.pathname === '/api/timedtext' && videoId && pot) token = { videoId, pot };
    return Reflect.apply(open, this, args);
  };

  const player = () => document.getElementById('movie_player') as Player | null;

  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin) return;
    const { minerr, languageCode, vssId } = Object(event.data);
    if (minerr === 'ask') {
      const response = player()?.getPlayerResponse?.() as PlayerResponse | undefined;
      const videoId = response?.videoDetails?.videoId;
      const reply: YoutubePageMessage = {
        minerr: 'player',
        videoId: typeof videoId === 'string' ? videoId : null,
        tracks: response?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [],
        audioTracks: (response?.streamingData?.adaptiveFormats ?? []).map(format => format.audioTrack).filter(Boolean),
        pot: token && token.videoId === videoId ? token.pot : null,
      };
      window.postMessage(reply, location.origin);
    } else if (minerr === 'show' && typeof languageCode === 'string' && typeof vssId === 'string') {
      // The player then asks YouTube for the track, with a token. Its first request can be without a token, before the token is ready,
      // and the player does not ask again for a track that it has: the reload of the captions module makes it ask again.
      const found = player();
      found?.unloadModule?.('captions');
      found?.loadModule?.('captions');
      found?.setOption?.('captions', 'track', { languageCode, vss_id: vssId });
    }
  });
}
