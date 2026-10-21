import type { Health } from './whisper.ts';

// The WhisperX server as the toolbar popup shows it. On Windows the popup starts the server through the native messaging
// host com.minerr.whisperx (server/start-from-chrome.cmd), which Start WhisperX server.cmd registers each time it runs.
export type ServerStatus =
  | { state: 'checking' }
  | { state: 'running'; health: Health }
  | { state: 'off' }
  | { state: 'starting'; since: number }
  // Chrome has no host for this extension: the user has to double-click the launcher one time.
  | { state: 'setup' }
  // The server did not answer within START_LIMIT_MS of the click.
  | { state: 'failed' };

export type ServerEvent =
  // A health check; null when the server did not answer.
  | { type: 'health'; health: Health | null }
  // The user clicked Start the server.
  | { type: 'start' }
  // The result of the message to the host: the error of Chrome, or null for a reply. The host exits without a reply,
  // so a start that worked also ends in an error: "Error when communicating with the native messaging host.".
  | { type: 'host'; error: string | null };

// The first start of the server creates the uv environment, which takes a while.
export const START_LIMIT_MS = 90_000;
const SETUP_ERRORS = ['Specified native messaging host not found.', 'Access to the specified native messaging host is forbidden.'];

export function nextStatus(status: ServerStatus, event: ServerEvent, now: number): ServerStatus {
  switch (event.type) {
    case 'start':
      return { state: 'starting', since: now };
    case 'host':
      return event.error !== null && SETUP_ERRORS.includes(event.error) ? { state: 'setup' } : status;
    case 'health':
      if (event.health) return { state: 'running', health: event.health };
      if (status.state === 'starting') return now - status.since < START_LIMIT_MS ? status : { state: 'failed' };
      return status.state === 'setup' || status.state === 'failed' ? status : { state: 'off' };
  }
}
