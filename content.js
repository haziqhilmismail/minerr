// Content scripts cannot be modules, so this loads the module code (listed in web_accessible_resources).
import(chrome.runtime.getURL('src/page.js'));
import(chrome.runtime.getURL('src/popup.js'));
