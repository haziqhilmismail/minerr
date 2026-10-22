// The port between the tab of a video (src/video/video.ts) and its subtitle side panel (pages/sidepanel.ts). The panel
// connects it with chrome.tabs.connect; the tab answers with its lines at once, then with each change. The actions of
// the panel on the video go the other way as videoGo messages (src/shared/rpc.ts), which have a reply.
import type { SubtitleSegment } from '../captions.ts';

export const PORT_NAME = 'minerr-sidebar';

// What the tab sends to the panel. lines: the timed lines of the video, none when it has no subtitles with times; id names
// the video, for its bookmarks. current: the index of the line at the time of the video, or -1. played: the user played
// the video, so the list follows it again.
export type TabEvent =
  | { kind: 'lines'; id: string | null; segments: SubtitleSegment[] }
  | { kind: 'current'; index: number }
  | { kind: 'played' };

// What the panel sends to the tab: the line of its open word popup, or null. The tab pauses the video for it
// (the pauseOnSidebar setting), and a card from that popup gets the audio of the line.
export interface PanelEvent {
  kind: 'popup';
  index: number | null;
}

// What a card of the panel asks of the video: a seek to the line, a play of the line once (then a pause at its end),
// or a pause at the start of the line (for the screenshot of a card).
export type Go = 'seek' | 'play' | 'still';
