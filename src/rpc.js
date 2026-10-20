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

export async function call(message) {
  const reply = await chrome.runtime.sendMessage(message);
  if (!reply) throw new Error(`No handler answered "${message.type}"`);
  if ('error' in reply) throw new Error(reply.error);
  return reply.value;
}
