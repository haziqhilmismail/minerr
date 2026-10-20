import { byId } from './src/dom.ts';
import { call, type Message, messageOf } from './src/rpc.ts';
import type { PageStats } from './src/stats.ts';
import { STATUS_NAMES, STATUSES } from './src/status.ts';
import type { Snapshot, Source } from './src/subtitles.ts';
import { applyTheme } from './src/theme.ts';
import { iPlusOne } from './src/settings.ts';
import type { JobStatus } from './src/whisper.ts';

applyTheme();

const POLL_MS = 2000;
const HINT: Record<Source, string> = {
  youtube: 'Turn on CC in the YouTube player. Minerr shows its captions in large text.',
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

async function checkServer(): Promise<void> {
  try {
    const { model, device } = await call({ type: 'whisperHealth' });
    server.textContent = `WhisperX server is running: ${model} on the ${device.toUpperCase()}.`;
    server.className = 'ok';
  } catch (error) {
    server.textContent = messageOf(error);
    server.className = 'error';
  }
}

async function refresh(): Promise<void> {
  checkServer();
  if (watchTabId === undefined) {
    elsewhere.hidden = false;
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

function sentenceItem(text: string, index: number, source: PageStats['source']): HTMLLIElement {
  const item = document.createElement('li');
  if (source === 'video' || tab?.id === undefined) {
    item.textContent = text;
    return item;
  }
  const tabId = tab.id;
  const button = Object.assign(document.createElement('button'), { textContent: text, title: 'Show this sentence in the tab' });
  button.addEventListener('click', () => call({ type: 'pageStatsShow', index }, tabId).catch(error => { scoreBasis.textContent = messageOf(error); }));
  item.append(button);
  return item;
}

function showStats({ source, lines, score, sentences }: PageStats): void {
  if (!score) {
    scoreEmpty.textContent = source === 'video'
      ? 'Play the video with Japanese subtitles. The score uses the subtitle lines that the overlay showed.'
      : 'This page has no Japanese words.';
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
  scoreBasis.textContent = `${score.words} words ${source === 'video' ? `in ${lines} subtitle lines` : 'on this page'}. Known and ignored words are understood.`;
  byId('sentences-title', HTMLElement).textContent = sentences.length
    ? `Recommended sentences (${sentences.length})`
    : 'No recommended sentences. No sentence has exactly one unknown word.';
  byId('sentences', HTMLElement).replaceChildren(...sentences.map((text, index) => sentenceItem(text, index, source)));
}

async function showTabStats(): Promise<void> {
  try {
    if (tab?.id === undefined) throw new Error('No tab');
    showStats(await call({ type: 'pageStats' }, tab.id));
  } catch {
    scoreEmpty.textContent = 'Minerr cannot read this tab. If the tab was open before Minerr started, reload it.';
  }
}

async function act(message: Message<'subsGenerate'> | Message<'subsUse'>): Promise<void> {
  if (watchTabId === undefined) return;
  try {
    showState(await call(message, watchTabId));
  } catch (error) {
    showMessage(messageOf(error), 'error');
  }
}

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
const plusOne = byId('iplusone', HTMLInputElement);
plusOne.checked = await iPlusOne.get();
plusOne.addEventListener('change', () => iPlusOne.set(plusOne.checked));
byId('player', HTMLButtonElement).addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('player.html') }));
byId('options', HTMLAnchorElement).addEventListener('click', event => {
  event.preventDefault();
  chrome.runtime.openOptionsPage();
});

showTabStats();
refresh();
setInterval(refresh, POLL_MS);
