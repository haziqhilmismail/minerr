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

async function record(video: HTMLVideoElement, start: number, end: number): Promise<MediaFile | null> {
  video.pause();
  video.currentTime = start;
  await once(video, 'seeked');
  const stream = video.captureStream();
  await video.play();
  const tracks = stream.getAudioTracks();
  if (!tracks.length) return null;
  const recorder = new MediaRecorder(new MediaStream(tracks), { mimeType: MIME });
  const chunks: Blob[] = [];
  recorder.addEventListener('dataavailable', event => chunks.push(event.data));
  const stopped = once(recorder, 'stop');
  recorder.start();
  await new Promise<void>(resolve => {
    const check = () => (video.currentTime >= end || video.paused || video.ended ? resolve() : requestAnimationFrame(check));
    check();
  });
  recorder.stop();
  await stopped;
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
