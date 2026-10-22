// The subtitle sidebar, in the side panel of Chrome next to the tab of the video (background.ts opens it for the G key).
// The tab is in the URL (?tab=<id>). The page connects a port to the tab (src/video/sidebar/sidebar-port.ts), gets its lines
// and the current line, and sends the line of its open word popup back. The actions of a card go to the tab as messages.
// Content scripts do not run on extension pages, so this page loads the word, popup, and i+1 modules itself.
import '../src/page-text/page.ts';
import '../src/popup/popup.ts';
import '../src/page-text/iplusone.ts';
import { toast } from '../src/popup/popup-view.ts';
import { call, messageOf } from '../src/shared/rpc.ts';
import { applyTheme } from '../src/shared/theme.ts';
import { type Go, type PanelEvent, PORT_NAME, type TabEvent } from '../src/video/sidebar/sidebar-port.ts';
import { createLineList } from '../src/video/sidebar/sidebar.ts';

applyTheme();

// The tab loads a new page: its content script connects again after the page loads, so the panel tries again until then.
// ponytail: one connect each second while the tab has no video page; tabs.onUpdated if that shows.
const RETRY_MS = 1000;
const tabId = Number(new URLSearchParams(location.search).get('tab'));

const go = (how: Go) => (index: number) => call({ type: 'videoGo', index, how }, tabId).catch(error => toast(messageOf(error)));
const list = createLineList({ seek: go('seek'), play: go('play'), still: go('still'), toast });
document.body.prepend(list.root);

let port: chrome.runtime.Port | null = null;
// The line of the open popup that the tab knows.
let told: number | null = null;

function connect(): void {
  let next: chrome.runtime.Port;
  try {
    next = chrome.tabs.connect(tabId, { name: PORT_NAME });
  } catch {
    // The tab is gone, and Chrome closes the panel of a closed tab.
    return;
  }
  port = next;
  told = null;
  // The sender is the tab (src/video/video.ts), which sends TabEvent values.
  next.onMessage.addListener((event: TabEvent) => {
    switch (event.kind) {
      case 'lines': return list.setLines({ id: event.id, segments: event.segments });
      case 'current': return list.setCurrent(event.index);
      case 'played': return list.resumeFollow();
      default: {
        const exhaustive: never = event;
        return exhaustive;
      }
    }
  });
  next.onDisconnect.addListener(() => {
    // The error of a tab without a content script (a page of Chrome) is read here, so it does not log.
    void chrome.runtime.lastError;
    if (port !== next) return;
    port = null;
    list.setLines(null);
    setTimeout(connect, RETRY_MS);
  });
}
connect();

// popup.ts marks the word of the open popup with data-ml-active. The tab pauses the video for it and gives its line to a card.
new MutationObserver(() => {
  const word = list.root.querySelector('.ml-word[data-ml-active]');
  const index = word ? list.rowIndex(word) : null;
  if (index === told) return;
  told = index;
  port?.postMessage({ kind: 'popup', index } satisfies PanelEvent);
}).observe(list.root, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-ml-active'] });
