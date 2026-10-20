// Content scripts cannot be modules, so this loads the module code (listed in web_accessible_resources).
import(chrome.runtime.getURL('src/page.js'));
import(chrome.runtime.getURL('src/popup.js'));
import(chrome.runtime.getURL('src/iplusone.js'));
import(chrome.runtime.getURL('src/stats.js'));
if (location.hostname === 'www.youtube.com' || location.hostname === 'm.youtube.com') import(chrome.runtime.getURL('src/subtitles.js'));
