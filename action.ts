import { byId } from './src/dom.ts';
import { call, type Message, messageOf } from './src/rpc.ts';
import type { Snapshot, Source } from './src/subtitles.ts';
import type { JobStatus } from './src/whisper.ts';

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
byId('options', HTMLAnchorElement).addEventListener('click', event => {
  event.preventDefault();
  chrome.runtime.openOptionsPage();
});

refresh();
setInterval(refresh, POLL_MS);
