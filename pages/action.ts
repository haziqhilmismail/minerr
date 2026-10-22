import { byId } from '../src/shared/dom.ts';
import { call, type Message, messageOf } from '../src/shared/rpc.ts';
import type { PageStats } from '../src/status/stats.ts';
import { STATUS_NAMES, STATUSES } from '../src/status/status.ts';
import type { Snapshot, Source } from '../src/video/youtube/youtube-overlay.ts';
import { applyTheme } from '../src/shared/theme.ts';
import { iPlusOne, minerrEnabled } from '../src/shared/settings.ts';
import { enabledSites, siteIsOn, siteOf, toggleSiteOf } from '../src/page-text/site.ts';
import { currentPlace, type JobStatus } from '../src/video/whisper.ts';
import { CLICK_KEY, type HealthCheck, isNoHostError, type ServerFacts, serverStatus, type ServerView, serverView } from '../src/video/server-status.ts';
import { at } from '../src/shared/guards.ts';

applyTheme();

const POLL_MS = 2000;
const HOST = 'com.minerr.whisperx';
const ADD_ON_RELEASE = 'https://github.com/haziqhilmismail/minerr/releases/latest';
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

const place = await currentPlace();
const serverStart = byId('server-start', HTMLElement);
const setup = byId('setup', HTMLElement);
const getAddOn = byId('get-addon', HTMLElement);
const addOn = byId('addon', HTMLButtonElement);

let check: HealthCheck | undefined;
const savedClick = at(await chrome.storage.session.get(CLICK_KEY), CLICK_KEY);
let click: ServerFacts['click'] = typeof savedClick === 'number' ? savedClick : null;

function show({ className, text, buttons }: ServerView): void {
  server.textContent = text;
  server.className = className;
  serverStart.hidden = !buttons.includes('start');
  setup.hidden = !buttons.includes('folder');
  getAddOn.hidden = !buttons.includes('addOn');
  addOn.classList.toggle('primary', buttons.length === 1);
}

const showServer = (): void => show(serverView(serverStatus({ check, click }, Date.now()), place));

async function checkServer(): Promise<void> {
  check = await call({ type: 'whisperHealth' }).then((health): HealthCheck => (health ? { state: 'running', health } : { state: 'off' }),
    (error: unknown): HealthCheck => ({ state: 'error', error: messageOf(error) }));
  // The start worked, so a popup that opens after the server stops shows that it is not running, not a failed start.
  if (check.state === 'running' && click !== null) {
    click = null;
    chrome.storage.session.remove(CLICK_KEY);
  }
  showServer();
}

byId('start', HTMLButtonElement).addEventListener('click', () => {
  click = Date.now();
  chrome.storage.session.set({ [CLICK_KEY]: click });
  showServer();
  chrome.runtime.sendNativeMessage(HOST, {}).catch((error: unknown) => {
    if (!isNoHostError(messageOf(error))) return;
    click = 'no host';
    chrome.storage.session.remove(CLICK_KEY);
    showServer();
  });
});
byId('folder', HTMLButtonElement).addEventListener('click', () => chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` }));
addOn.addEventListener('click', () => chrome.tabs.create({ url: ADD_ON_RELEASE }));

async function refresh(): Promise<void> {
  checkServer();
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

// The switch for the site of the tab. Only web pages get one: Minerr does not run on browser pages.
const siteHost = /^https?:/.test(tab?.url ?? '') ? new URL(tab?.url ?? '').hostname : '';
let pageTextOn = siteHost === '' || siteIsOn(await enabledSites.get(), siteHost);

function sourceText(stats: PageStats) {
  switch (stats.source) {
    case 'track': return { empty: 'The subtitles of this video have no Japanese words.', where: `in all ${stats.lines} subtitle lines of the video` };
    case 'shown': return { empty: 'Play the video with Japanese subtitles. The score uses the subtitle lines that the overlay showed.', where: `in the ${stats.lines} subtitle lines that the overlay showed` };
    case 'page': return {
      empty: pageTextOn ? 'This page has no Japanese words.' : 'The page text is off. Turn it on to see the score of this page.', where: 'on this page',
    };
  }
}

function showStats(stats: PageStats): void {
  const { score } = stats;
  const { empty, where } = sourceText(stats);
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
}

async function showTabStats(): Promise<void> {
  const tabId = tab?.id;
  const stats = tabId === undefined ? null : await call({ type: 'pageStats' }, tabId).catch(() => null);
  if (stats) showStats(stats);
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
const enabledHint = `In all tabs. ${shortcutOf('toggle-minerr')}`;
byId('enabled-hint', HTMLElement).textContent = enabledHint;
byId('power', HTMLLabelElement).title = enabledHint;
const enabled = byId('enabled', HTMLInputElement);
const siteCard = byId('site-toggle', HTMLElement);
enabled.addEventListener('change', () => minerrEnabled.set(enabled.checked));
minerrEnabled.watch(on => {
  enabled.checked = on;
  byId('enabled-state', HTMLElement).textContent = on ? 'On' : 'Off';
  byId('video-state', HTMLElement).textContent = on ? 'On' : 'Off';
  byId('minerr-off', HTMLElement).hidden = on;
  siteCard.classList.toggle('off', !on);
});

const plusOne = byId('iplusone', HTMLInputElement);
plusOne.checked = await iPlusOne.get();
plusOne.addEventListener('change', () => iPlusOne.set(plusOne.checked));
if (siteHost) {
  const siteSwitch = byId('site', HTMLInputElement);
  byId('site-name', HTMLElement).textContent = siteOf(siteHost);
  // content.ts shows the subtitle overlay by itself on these sites; other pages need the Subtitles button.
  byId('video-hint', HTMLElement).textContent = siteIsOn(['youtube.com', 'netflix.com'], siteHost) ? 'Always on.' : 'Use Subtitles below.';
  byId('site-hint', HTMLElement).textContent = `Titles, comments, and other text. ${shortcutOf('toggle-site')}`;
  siteSwitch.checked = pageTextOn;
  siteSwitch.addEventListener('change', async () => {
    pageTextOn = await toggleSiteOf(siteHost);
    siteSwitch.checked = pageTextOn;
    // The tab parses its text after the switch, so the score comes a moment later.
    setTimeout(showTabStats, 1500);
  });
  siteCard.hidden = false;
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
refresh();
setInterval(refresh, POLL_MS);
