// Records the audio of a part of a video in the page, for the sentence audio when the Minerr server has no audio of the video.
// The video plays the part again, so the user hears it.
import type { MediaFile } from '../anki/anki.ts';
import { play } from '../shared/dom.ts';

// Chrome has captureStream on media elements, but the DOM types of TypeScript have it only on canvas.
declare global {
  interface HTMLMediaElement {
    captureStream(): MediaStream;
  }
}

const MIME = 'audio/webm;codecs=opus';

const once = (target: EventTarget, type: string) => new Promise(resolve => target.addEventListener(type, resolve, { once: true }));

export function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let text = '';
  // String.fromCharCode takes its arguments on the stack, so the bytes go in chunks.
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

// The recording gets one loudness: a gain takes the mean power of the sound so far (without the pauses, under GATE) to TARGET,
// and a limiter stops the peaks. A compressor alone also evens out the level, but it lifts the noise in the pauses to near the speech.
// TARGET and GATE are powers (-18 and -50 dBFS); MAX_GAIN is an amplitude factor (+30 dB).
const TARGET = 10 ** (-18 / 10);
const GATE = 10 ** (-50 / 10);
const MAX_GAIN = 10 ** (30 / 20);

// Null when Chrome does not let the page start audio (no user action on the page yet): then the recording keeps the level of the video.
async function startAudio(): Promise<AudioContext | null> {
  const context = new AudioContext();
  await Promise.race([context.resume(), new Promise(resolve => setTimeout(resolve, 300))]);
  if (context.state === 'running') return context;
  void context.close();
  return null;
}

// The tracks to record. follow() sets the gain from the sound so far; call it while the recording runs.
interface Leveled {
  tracks: MediaStreamTrack[];
  follow: () => void;
}

function level(context: AudioContext, tracks: MediaStreamTrack[]): Leveled {
  const source = context.createMediaStreamSource(new MediaStream(tracks));
  const analyser = new AnalyserNode(context, { fftSize: 2048 });
  const gain = new GainNode(context);
  const out = context.createMediaStreamDestination();
  source.connect(analyser);
  source.connect(gain).connect(new DynamicsCompressorNode(context, { threshold: -6, knee: 0, ratio: 20, attack: 0.001, release: 0.1 })).connect(out);
  const block = new Float32Array(analyser.fftSize);
  let sum = 0;
  let count = 0;
  const follow = () => {
    analyser.getFloatTimeDomainData(block);
    const power = block.reduce((total, sample) => total + sample * sample, 0) / block.length;
    if (power < GATE) return;
    sum += power;
    count += 1;
    gain.gain.setTargetAtTime(Math.min(MAX_GAIN, Math.sqrt(TARGET * count / sum)), context.currentTime, 0.05);
  };
  return { tracks: out.stream.getAudioTracks(), follow };
}

// A seek or a play that never ends (a stalled network) ends the recording 5 seconds after the length of the part.
async function record(video: HTMLVideoElement, start: number, end: number, audio: AudioContext | null): Promise<MediaFile | null> {
  // The line plays at the speed of the video, so a slow speed needs more time.
  const timeout = AbortSignal.timeout(((end - start) / video.playbackRate + 5) * 1000);
  const gaveUp = once(timeout, 'abort');
  video.pause();
  video.currentTime = start;
  await Promise.race([once(video, 'seeked'), gaveUp]);
  if (timeout.aborted) return null;
  const stream = video.captureStream();
  await Promise.race([video.play(), gaveUp]);
  const tracks = stream.getAudioTracks();
  if (timeout.aborted || !tracks.length) return null;
  const leveled: Leveled = audio ? level(audio, tracks) : { tracks, follow: () => undefined };
  const recorder = new MediaRecorder(new MediaStream(leveled.tracks), { mimeType: MIME });
  const chunks: Blob[] = [];
  recorder.addEventListener('dataavailable', event => chunks.push(event.data));
  const stopped = once(recorder, 'stop');
  recorder.start();
  await new Promise<void>(resolve => {
    const check = () => {
      leveled.follow();
      if (video.currentTime >= end || video.paused || video.ended || timeout.aborted) resolve();
      else requestAnimationFrame(check);
    };
    check();
  });
  recorder.stop();
  await stopped;
  if (timeout.aborted) return null;
  return { filename: `minerr-${Date.now()}.webm`, data: toBase64(await new Blob(chunks, { type: MIME }).arrayBuffer()) };
}

// Returns null when the video gives no audio track, for example a video without sound.
// The video goes back to its time and its play state also when the recording fails.
export async function recordPart(video: HTMLVideoElement, start: number, end: number): Promise<MediaFile | null> {
  const before = { time: video.currentTime, paused: video.paused };
  const audio = await startAudio();
  try {
    return await record(video, start, end, audio);
  } finally {
    void audio?.close();
    video.pause();
    video.currentTime = before.time;
    if (!before.paused) play(video);
  }
}
