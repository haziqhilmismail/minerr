import { byId } from '../src/shared/dom.ts';
import { call, type Message, messageOf } from '../src/shared/rpc.ts';
import type { PageStats } from '../src/status/stats.ts';
import { STATUS_NAMES, STATUSES } from '../src/status/status.ts';
import type { Snapshot, Source } from '../src/video/youtube/youtube-overlay.ts';
import { applyTheme } from '../src/shared/theme.ts';
import { iPlusOne, minerrEnabled } from '../src/shared/settings.ts';
import { enabledSites, siteIsOn, siteOf, toggleSiteOf } from '../src/page-text/site.ts';
import { type JobStatus, serverHint } from '../src/video/whisper.ts';
import { nextStatus, type ServerEvent, type ServerStatus, START_LIMIT_MS } from '../src/video/server-status.ts';
import { at } from '../src/shared/guards.ts';

applyTheme();

const POLL_MS = 2000;
const SERVER_POLL_MS = 1000;
const HOST = 'com.minerr.whisperx';
const HINT: Record<Source, string> = {
  youtube: 'Minerr shows the Japanese captions of YouTube. If the overlay stays empty, turn on CC in the YouTube player.',
  whisperx: 'The subtitles come from the WhisperX server on this computer.',
};
const JOB_TEXT: Record<Exclude<JobStatus['state'], 'error'>, string> = {
  queued: 'Waiting for the server…',
  downloading: 'Downloading the audio…',
  transcribing: 'Transcribing…',
  done: 'The WhisperX subtitles are ready.',
};

// Tests open this page in a tab with ?tab=<id>, because in a tab the active tab is this page itself.
const tabParam = new URLSearchParams(location.search).get('tab');
const [tab] = tabParam ? [await chrome.tabs.get(Number(tabParam))] : await chrome.tabs.query({ active: true, currentWindow: true });
// The id of the YouTube watch tab that this popup controls, if the tab is one.
const watchTabId = /^https:\/\/(www|m)\.youtube\.com\/watch\?/.test(tab?.url ?? '') ? tab?.id : undefined;

const job = byId('job', HTMLElement);
const controls = byId('controls', HTMLElement);
const hint = byId('hint', HTMLElement);
const generate = byId('generate', HTMLButtonElement);
const progress = byId('progress', HTMLProgressElement);
const server = byId('server', HTMLElement);
const elsewhere = byId('elsewhere', HTMLElement);
const attach = byId('attach', HTMLButtonElement);
const sourceButtons = [...document.querySelectorAll('[data-source]')].filter(button => button instanceof HTMLButtonElement);
const isSource = (value: unknown): value is Source => value === 'youtube' || value === 'whisperx';

function showMessage(text: string, className = ''): void {
  job.textContent = text;
  job.className = className;
}

function showState(snapshot: Snapshot): void {
  const { source, hasWhisperx, job: status } = snapshot;
  controls.hidden = false;
  for (const button of sourceButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.source === source));
    if (button.dataset.source === 'whisperx') button.disabled = !hasWhisperx;
  }
  hint.textContent = HINT[source];
  const running = status !== null && status.state !== 'done' && status.state !== 'error';
  generate.hidden = hasWhisperx;
  generate.disabled = running;
  progress.hidden = status?.state !== 'transcribing';
  progress.value = status?.state === 'transcribing' ? status.progress : 0;
  if (!status) showMessage('');
  else if (status.state === 'error') showMessage(status.error, 'error');
  else showMessage(`${JOB_TEXT[status.state]}${status.state === 'transcribing' ? ` ${status.progress}%` : ''}`, status.state === 'done' ? 'ok' : '');
}

// On Windows the popup starts the server through the native messaging host; elsewhere it shows the command.
const windows = navigator.platform.startsWith('Win');
const serverStart = byId('server-start', HTMLElement);
const setup = byId('setup', HTMLElement);

function serverText(status: ServerStatus): string {
  switch (status.state) {
    case 'checking': return 'Checking the WhisperX server…';
    case 'running': return `WhisperX server is running: ${status.health.model} on the ${status.health.device.toUpperCase()}.`;
    case 'off': return windows ? 'The WhisperX server is not running.' : serverHint(navigator.platform);
    case 'starting': return 'Starting the WhisperX server… The first start installs its packages, which takes some minutes.';
    case 'setup': return 'To set up the Start button, double-click "Start WhisperX server.cmd" in the Minerr folder one time.';
    case 'failed': return 'The WhisperX server did not answer in 90 seconds. Look at the WhisperX window.';
  }
}
const SERVER_CLASS: Record<ServerStatus['state'], string> = { checking: '', running: 'ok', off: 'error', starting: '', setup: 'error', failed: 'error' };

// The session keeps the time of the click: the window of the server takes the focus, which closes the popup,
// and the popup that opens next shows that the server starts.
let status: ServerStatus = { state: 'checking' };
const since = at(await chrome.storage.session.get('serverStart'), 'serverStart');
if (typeof since === 'number' && Date.now() - since < START_LIMIT_MS) status = { state: 'starting', since };

function showServer(): void {
  server.textContent = serverText(status);
  server.className = SERVER_CLASS[status.state];
  serverStart.hidden = !windows || !(status.state === 'off' || status.state === 'setup' || status.state === 'failed');
  setup.hidden = status.state !== 'setup';
}

function serverEvent(event: ServerEvent): void {
  status = nextStatus(status, event, Date.now());
  showServer();
}

async function checkServer(): Promise<void> {
  serverEvent({ type: 'health', health: await call({ type: 'whisperHealth' }).catch(() => null) });
}

byId('start', HTMLButtonElement).addEventListener('click', () => {
  serverEvent({ type: 'start' });
  if (status.state === 'starting') chrome.storage.session.set({ serverStart: status.since });
  chrome.runtime.sendNativeMessage(HOST, {})
    .then(() => serverEvent({ type: 'host', error: null }), (error: unknown) => serverEvent({ type: 'host', error: messageOf(error) }));
});
byId('folder', HTMLButtonElement).addEventListener('click', () => chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` }));

async function refresh(): Promise<void> {
  if (watchTabId === undefined) {
    elsewhere.hidden = false;
    attach.hidden = !/^https?:/.test(tab?.url ?? '');
    return;
  }
  try {
    showState(await call({ type: 'subsState' }, watchTabId));
  } catch {
    elsewhere.textContent = 'Reload the YouTube tab, then open this menu again.';
    elsewhere.hidden = false;
  }
}

const scoreEmpty = byId('score-empty', HTMLElement);
const scoreLabel = byId('score-label', HTMLElement);
const scoreBasis = byId('score-basis', HTMLElement);

// tabId is null for sentences that the tab cannot show.
function sentenceItem(text: string, index: number, tabId: number | null): HTMLLIElement {
  const item = document.createElement('li');
  if (tabId === null) {
    item.textContent = text;
    return item;
  }
  const button = Object.assign(document.createElement('button'), { textContent: text, title: 'Show this sentence in the tab' });
  button.addEventListener('click', () => call({ type: 'pageStatsShow', index }, tabId).catch(error => { scoreBasis.textContent = messageOf(error); }));
  item.append(button);
  return item;
}

// The switch for the site of the tab. Only web pages get one: Minerr does not run on browser pages.
const siteHost = /^https?:/.test(tab?.url ?? '') ? new URL(tab?.url ?? '').hostname : '';
let pageTextOn = siteHost === '' || siteIsOn(await enabledSites.get(), siteHost);

function sourceText(stats: PageStats) {
  switch (stats.source) {
    case 'track': return { empty: 'The subtitles of this video have no Japanese words.', where: `in all ${stats.lines} subtitle lines of the video`, showable: false };
    case 'shown': return { empty: 'Play the video with Japanese subtitles. The score uses the subtitle lines that the overlay showed.', where: `in the ${stats.lines} subtitle lines that the overlay showed`, showable: false };
    case 'page': return {
      empty: pageTextOn ? 'This page has no Japanese words.' : 'The page text is off. Turn it on to see the score of this page.', where: 'on this page', showable: true,
    };
  }
}

function showStats(stats: PageStats, tabId: number): void {
  const { score, sentences } = stats;
  const { empty, where, showable } = sourceText(stats);
  if (!score) {
    scoreEmpty.textContent = empty;
    return;
  }
  scoreEmpty.hidden = true;
  byId('score', HTMLElement).hidden = false;
  byId('score-percent', HTMLElement).textContent = `${score.percent}%`;
  scoreLabel.textContent = score.rating.label;
  scoreLabel.style.color = score.rating.color;
  byId('score-counts', HTMLElement).replaceChildren(...STATUS_NAMES.map(status => {
    const dot = Object.assign(document.createElement('span'), { className: 'dot' });
    dot.style.background = STATUSES[status].color;
    const item = document.createElement('li');
    item.append(dot, `${STATUSES[status].label} ${score.unique[status]}`);
    return item;
  }));
  scoreBasis.textContent = `${score.words} words ${where}. Known and ignored words are understood.`;
  byId('sentences-title', HTMLElement).textContent = sentences.length
    ? `Recommended sentences (${sentences.length})`
    : 'No recommended sentences. No sentence has exactly one unknown word.';
  byId('sentences', HTMLElement).replaceChildren(...sentences.map((text, index) => sentenceItem(text, index, showable ? tabId : null)));
}

async function showTabStats(): Promise<void> {
  const tabId = tab?.id;
  const stats = tabId === undefined ? null : await call({ type: 'pageStats' }, tabId).catch(() => null);
  if (stats && tabId !== undefined) showStats(stats, tabId);
  else scoreEmpty.textContent = 'Minerr cannot read this tab. Pages of Chrome and of extensions have no score. If the tab was open before Minerr started, reload it.';
}

async function act(message: Message<'subsGenerate'> | Message<'subsUse'>): Promise<void> {
  if (watchTabId === undefined) return;
  try {
    showState(await call(message, watchTabId));
  } catch (error) {
    showMessage(messageOf(error), 'error');
  }
}

attach.addEventListener('click', async () => {
  if (tab?.id === undefined) return;
  elsewhere.textContent = await call({ type: 'videoAttach' }, tab.id).catch((error: unknown) => messageOf(error));
});
generate.addEventListener('click', () => {
  generate.disabled = true;
  act({ type: 'subsGenerate' });
});
for (const button of sourceButtons) {
  button.addEventListener('click', () => {
    const { source } = button.dataset;
    if (isSource(source)) act({ type: 'subsUse', source });
  });
}
// The browser shortcut of a command, as the user set it on the Chrome shortcuts page.
const shortcuts = new Map((await chrome.commands.getAll()).map(({ name, shortcut }) => [name, shortcut]));
const shortcutOf = (command: string) => `Shortcut: ${shortcuts.get(command) || 'not set'}.`;
byId('enabled-hint', HTMLElement).textContent = `In all tabs. ${shortcutOf('toggle-minerr')}`;
const enabled = byId('enabled', HTMLInputElement);
enabled.addEventListener('change', () => minerrEnabled.set(enabled.checked));
minerrEnabled.watch(on => { enabled.checked = on; });

const plusOne = byId('iplusone', HTMLInputElement);
plusOne.checked = await iPlusOne.get();
plusOne.addEventListener('change', () => iPlusOne.set(plusOne.checked));
if (siteHost) {
  const siteSwitch = byId('site', HTMLInputElement);
  const show = () => {
    siteSwitch.checked = pageTextOn;
    byId('site-state', HTMLElement).textContent = pageTextOn ? 'On' : 'Off';
  };
  byId('site-name', HTMLElement).textContent = `${siteOf(siteHost)}. ${shortcutOf('toggle-site')} Video subtitles work without it.`;
  show();
  siteSwitch.addEventListener('change', async () => {
    pageTextOn = await toggleSiteOf(siteHost);
    show();
    // The tab parses its text after the switch, so the score comes a moment later.
    setTimeout(showTabStats, 1500);
  });
  byId('site-toggle', HTMLElement).hidden = false;
}
const PAGES = { player: 'pages/player.html', reader: 'pages/reader.html', paste: 'pages/reader.html?paste', words: 'pages/words.html' };
for (const [id, page] of Object.entries(PAGES)) {
  byId(id, HTMLButtonElement).addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL(page) }));
}
byId('options', HTMLAnchorElement).addEventListener('click', event => {
  event.preventDefault();
  chrome.runtime.openOptionsPage();
});

showTabStats();
showServer();
checkServer();
setInterval(checkServer, SERVER_POLL_MS);
refresh();
setInterval(refresh, POLL_MS);
