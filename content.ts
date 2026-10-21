// Content scripts cannot be modules, so this loads the module code (listed in web_accessible_resources).
import(chrome.runtime.getURL('src/page-text/page.js'));
import(chrome.runtime.getURL('src/popup/popup.js'));
import(chrome.runtime.getURL('src/page-text/iplusone.js'));
import(chrome.runtime.getURL('src/status/stats.js'));
// The overlay of the site: YouTube and Netflix have their own; every other page gets the overlay that the toolbar menu starts.
const OVERLAYS: Record<string, string> = { 'www.youtube.com': 'src/video/youtube/youtube-overlay.js', 'm.youtube.com': 'src/video/youtube/youtube-overlay.js', 'www.netflix.com': 'src/video/netflix/netflix-overlay.js' };
import(chrome.runtime.getURL(OVERLAYS[location.hostname] ?? 'src/video/other-sites.js'));
