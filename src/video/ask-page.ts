// A question to the script of Minerr in the page itself (manifest.json "world": "MAIN"), and its reply.
// The page can post messages too, so toReply checks each message and gives null for one that is not the reply.
// Resolves null when the page script does not answer within waitMs.
export function askPage<T>(message: object, toReply: (data: unknown) => T | null, waitMs: number): Promise<T | null> {
  return new Promise(resolve => {
    const done = (reply: T | null) => {
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      resolve(reply);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== location.origin) return;
      const reply = toReply(event.data);
      if (reply) done(reply);
    };
    const timer = setTimeout(() => done(null), waitMs);
    window.addEventListener('message', onMessage);
    window.postMessage(message, location.origin);
  });
}
