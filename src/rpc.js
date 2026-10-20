// Every reply is {value} or {error}, so an error thrown in a handler reaches the caller as an Error.
export function serve(handlers, accepts) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const handler = accepts(message) && handlers[message.type];
    if (!handler) return false;
    Promise.resolve()
      .then(() => handler(message, sender))
      .then(value => sendResponse({ value }), error => sendResponse({ error: error.message ?? String(error) }));
    return true;
  });
}

// Without tabId the message goes to the extension pages and the service worker; with it, to the content scripts of that tab.
export async function call(message, tabId) {
  const reply = await (tabId === undefined ? chrome.runtime.sendMessage(message) : chrome.tabs.sendMessage(tabId, message));
  if (!reply) throw new Error(`No handler answered "${message.type}"`);
  if ('error' in reply) throw new Error(reply.error);
  return reply.value;
}
