import type { Health } from './whisper.ts';

export type ServerStatus =
  | { state: 'checking' }
  | { state: 'running'; health: Health }
  | { state: 'off' }
  | { state: 'error'; error: string }
  | { state: 'starting' }
  | { state: 'setup' }
  | { state: 'failed' };

export type HealthCheck = Extract<ServerStatus, { state: 'running' | 'off' | 'error' }>;

// click is the time of the last click on Start the server until a popup sees the server answer, or 'no host' when Chrome
// had no host for it. chrome.storage.session keeps the time, so a popup that opens again later shows the start.
export interface ServerFacts {
  check: HealthCheck | undefined;
  click: number | 'no host' | null;
}

export const CLICK_KEY = 'serverClick';

// A start from the button usually follows the setup double-click, which installed the packages, so it takes seconds. The
// rest is a margin for a cold WSL. A start that installs packages shows as failed until the server answers.
// ponytail: a server that answered and stopped while no popup was open shows as failed on the next open, because only a
// popup forgets the click.
export const START_LIMIT_MS = 90_000;

export function serverStatus({ check, click }: ServerFacts, now: number): ServerStatus {
  if (check && check.state !== 'off') return check;
  if (click === 'no host') return { state: 'setup' };
  if (click !== null) return now - click < START_LIMIT_MS ? { state: 'starting' } : { state: 'failed' };
  return check ?? { state: 'checking' };
}

// The host never replies. Chrome gives no error code, and of its messages only these two say that the host is missing.
// If a release rewords them, a start without a host shows starting until START_LIMIT_MS, then failed.
export const isNoHostError = (error: string): boolean =>
  error === 'Specified native messaging host not found.' || error === 'Access to the specified native messaging host is forbidden.';

// Where Minerr runs. Only Windows has the Start button, because the native messaging hosts of the server are .cmd files.
export interface Place {
  windows: boolean;
}

// The help to start the server where the popup is not, for example in the error of Generate with WhisperX.
export const serverHint = ({ windows }: Place): string => (windows
  ? 'Start the WhisperX server: click the Minerr button in the toolbar, then click Start the server. You can also double-click "Start WhisperX server (Windows).cmd" in the Minerr folder. If you use WSL, double-click "Start WhisperX server (WSL).cmd" instead.'
  : 'Start the WhisperX server: uv run server/whisper_server.py');

export type ServerButton = 'start' | 'folder';

// The line of the server in the toolbar popup, and the buttons under it.
export interface ServerView {
  className: '' | 'ok' | 'error';
  text: string;
  buttons: ServerButton[];
}

type StatusOf<S extends ServerStatus['state']> = Extract<ServerStatus, { state: S }>;
type View<S extends ServerStatus['state']> = Pick<ServerView, 'className' | 'buttons'> & { text: (status: StatusOf<S>, place: Place) => string };

// The buttons that each state offers. SHOWN keeps the ones that the place has.
const VIEW: { [S in ServerStatus['state']]: View<S> } = {
  checking: { className: '', buttons: [], text: () => 'Checking the WhisperX server…' },
  running: { className: 'ok', buttons: [], text: ({ health }) => `WhisperX server is running: ${health.model} on the ${health.device.toUpperCase()}.` },
  off: { className: 'error', buttons: ['start'], text: (_, place) => (place.windows ? 'The WhisperX server is not running.' : serverHint(place)) },
  error: { className: 'error', buttons: [], text: ({ error }) => error },
  starting: { className: '', buttons: [], text: () => 'Starting the WhisperX server…' },
  setup: { className: 'error', buttons: ['folder'], text: () => 'To set up the Start button, double-click "Start WhisperX server (Windows).cmd" in the Minerr folder one time. If you use WSL, double-click "Start WhisperX server (WSL).cmd" instead.' },
  failed: { className: 'error', buttons: ['start'], text: () => `The WhisperX server did not answer in ${START_LIMIT_MS / 1000} seconds. Look at the WhisperX window.` },
};

const SHOWN: Record<ServerButton, (place: Place) => boolean> = {
  start: ({ windows }) => windows,
  folder: () => true,
};

export function serverView<S extends ServerStatus['state']>(status: StatusOf<S>, place: Place): ServerView {
  const view = VIEW[status.state];
  return { className: view.className, text: view.text(status, place), buttons: view.buttons.filter(button => SHOWN[button](place)) };
}
