import type { Health } from './whisper.ts';

// The WhisperX server as the toolbar popup shows it. On Windows the popup starts the server through the native messaging
// host com.minerr.whisperx (server/start-from-chrome.cmd), which Start WhisperX server.cmd registers each time it runs.
export type ServerStatus =
  | { state: 'checking' }
  | { state: 'running'; health: Health }
  | { state: 'off' }
  | { state: 'starting' }
  // Chrome has no host for this extension: the user has to double-click the launcher one time.
  | { state: 'setup' }
  // The server did not answer within START_LIMIT_MS of the click on Start the server.
  | { state: 'failed' };

export type HealthCheck = { kind: 'off' } | { kind: 'ok'; health: Health };

// What the popup knows. check is the last health check, undefined before the first one ends. click is the last click on
// Start the server: its time until the server answers, or 'no host' when Chrome has no host for this extension.
// chrome.storage.session keeps the time, because the window of the server takes the focus and closes the popup.
export interface ServerFacts {
  check: HealthCheck | undefined;
  click: number | 'no host' | null;
}

// The first start of the server creates the uv environment, which takes a while.
export const START_LIMIT_MS = 90_000;

export function serverStatus({ check, click }: ServerFacts, now: number): ServerStatus {
  if (check?.kind === 'ok') return { state: 'running', health: check.health };
  if (click === 'no host') return { state: 'setup' };
  if (click !== null) return now - click < START_LIMIT_MS ? { state: 'starting' } : { state: 'failed' };
  return check ? { state: 'off' } : { state: 'checking' };
}

// Whether the error of chrome.runtime.sendNativeMessage says that Chrome has no host for this extension. The host exits
// without a reply, so a start that worked also ends in an error ("Error when communicating with the native messaging host.").
// ponytail: Chrome gives no error code, only these messages. If a release rewords them, a start without a host shows
// starting until START_LIMIT_MS, then failed.
export const isNoHostError = (error: string): boolean =>
  error === 'Specified native messaging host not found.' || error === 'Access to the specified native messaging host is forbidden.';
