import { call } from './src/rpc.js';

const POLL_MS = 2000;
const $ = id => document.getElementById(id);
const HINT = {
  youtube: 'Turn on CC in the YouTube player. Minerr shows its captions in large text.',
  whisperx: 'The subtitles come from the WhisperX server on this computer.',
};
const JOB_TEXT = {
  queued: 'Waiting for the server…',
  downloading: 'Downloading the audio…',
  transcribing: 'Transcribing…',
  done: 'The WhisperX subtitles are ready.',
};

// Tests open this page in a tab with ?tab=<id>, because in a tab the active tab is this page itself.
const tabParam = new URLSearchParams(location.search).get('tab');
const [tab] = tabParam ? [await chrome.tabs.get(Number(tabParam))] : await chrome.tabs.query({ active: true, currentWindow: true });
const onWatchPage = /^https:\/\/(www|m)\.youtube\.com\/watch\?/.test(tab?.url ?? '');

function showMessage(text, className = '') {
  $('job').textContent = text;
  $('job').className = className;
}

function showState({ source, hasWhisperx, job }) {
  $('controls').hidden = false;
  for (const button of document.querySelectorAll('[data-source]')) {
    button.setAttribute('aria-pressed', String(button.dataset.source === source));
  }
  document.querySelector('[data-source="whisperx"]').disabled = !hasWhisperx;
  $('hint').textContent = HINT[source];
  const running = Boolean(job) && !['done', 'error'].includes(job.state);
  $('generate').hidden = hasWhisperx;
  $('generate').disabled = running;
  $('progress').hidden = job?.state !== 'transcribing';
  $('progress').value = job?.progress ?? 0;
  if (!job) showMessage('');
  else if (job.state === 'error') showMessage(job.error, 'error');
  else showMessage(`${JOB_TEXT[job.state]}${job.state === 'transcribing' ? ` ${job.progress ?? 0}%` : ''}`, job.state === 'done' ? 'ok' : '');
}

async function checkServer() {
  try {
    const { model, device } = await call({ type: 'whisperHealth' });
    $('server').textContent = `WhisperX server is running: ${model} on the ${device.toUpperCase()}.`;
    $('server').className = 'ok';
  } catch (error) {
    $('server').textContent = error.message;
    $('server').className = 'error';
  }
}

async function refresh() {
  checkServer();
  if (!onWatchPage) {
    $('elsewhere').hidden = false;
    return;
  }
  try {
    showState(await call({ type: 'subsState' }, tab.id));
  } catch {
    $('elsewhere').textContent = 'Reload the YouTube tab, then open this menu again.';
    $('elsewhere').hidden = false;
  }
}

async function act(message) {
  try {
    showState(await call(message, tab.id));
  } catch (error) {
    showMessage(error.message, 'error');
  }
}

$('generate').addEventListener('click', () => {
  $('generate').disabled = true;
  act({ type: 'subsGenerate' });
});
for (const button of document.querySelectorAll('[data-source]')) {
  button.addEventListener('click', () => act({ type: 'subsUse', source: button.dataset.source }));
}
$('options').addEventListener('click', event => {
  event.preventDefault();
  chrome.runtime.openOptionsPage();
});

refresh();
setInterval(refresh, POLL_MS);
