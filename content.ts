// Content scripts cannot be modules, so this loads the module code (listed in web_accessible_resources).
import(chrome.runtime.getURL('src/page.js'));
import(chrome.runtime.getURL('src/popup.js'));
import(chrome.runtime.getURL('src/iplusone.js'));
import(chrome.runtime.getURL('src/stats.js'));
// The overlay of the site: YouTube and Netflix have their own; every other page gets the overlay that the toolbar menu starts.
const OVERLAYS: Record<string, string> = { 'www.youtube.com': 'src/subtitles.js', 'm.youtube.com': 'src/subtitles.js', 'www.netflix.com': 'src/netflix.js' };
import(chrome.runtime.getURL(OVERLAYS[location.hostname] ?? 'src/anywhere.js'));
