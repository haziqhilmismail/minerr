import type { Health } from './whisper.ts';

export type ServerStatus =
  | { state: 'checking' }
  | { state: 'running'; health: Health }
  | { state: 'off' }
  | { state: 'broken'; error: string }
  | { state: 'starting' }
  | { state: 'setup' }
  | { state: 'failed' };

export type HealthCheck = Extract<ServerStatus, { state: 'running' | 'off' | 'broken' }>;

// click is the time of the last click on Start the server until a popup sees the server answer, or 'no host' when Chrome
// had no host for it. chrome.storage.session keeps the time, so a popup that opens again later shows the start.
export interface ServerFacts {
  check: HealthCheck | undefined;
  click: number | 'no host' | null;
}

export const CLICK_KEY = 'serverClick';

// A start from the button follows the setup double-click, which installed the packages, so it takes seconds. The rest is
// a margin for a cold WSL.
// ponytail: a server that answered and stopped while no popup was open shows as failed on the next open, because only a
// popup forgets the click.
export const START_LIMIT_MS = 90_000;

export function serverStatus({ check, click }: ServerFacts, now: number): ServerStatus {
  if (check && check.state !== 'off') return check;
  if (click === 'no host') return { state: 'setup' };
  if (click !== null) return now - click < START_LIMIT_MS ? { state: 'starting' } : { state: 'failed' };
  return check ?? { state: 'checking' };
}

// The host never replies. Of the errors that Chrome can give, only these two say that the host is missing.
// ponytail: Chrome gives no error code, only these messages. If a release rewords them, a start without a host shows
// starting until START_LIMIT_MS, then failed.
export const isNoHostError = (error: string): boolean =>
  error === 'Specified native messaging host not found.' || error === 'Access to the specified native messaging host is forbidden.';
