// Records the audio of a part of a video in the page, for the sentence audio when the Minerr server has no audio of the video.
// The video plays the part again, so the user hears it.
import type { MediaFile } from './anki.ts';
import { play } from './dom.ts';

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

// A seek or a play that never ends (a stalled network) ends the recording 5 seconds after the length of the part.
async function record(video: HTMLVideoElement, start: number, end: number): Promise<MediaFile | null> {
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
  const recorder = new MediaRecorder(new MediaStream(tracks), { mimeType: MIME });
  const chunks: Blob[] = [];
  recorder.addEventListener('dataavailable', event => chunks.push(event.data));
  const stopped = once(recorder, 'stop');
  recorder.start();
  await new Promise<void>(resolve => {
    const check = () => (video.currentTime >= end || video.paused || video.ended || timeout.aborted ? resolve() : requestAnimationFrame(check));
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
  try {
    return await record(video, start, end);
  } finally {
    video.pause();
    video.currentTime = before.time;
    if (!before.paused) play(video);
  }
}
