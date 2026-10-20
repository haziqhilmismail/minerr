// Records the audio of a part of a video in the page, for the sentence audio when the Minerr server has no audio of the video.
// The video plays the part again, so the user hears it.
import type { MediaFile } from './anki.ts';

// Chrome has captureStream on media elements, but the DOM types of TypeScript have it only on canvas.
declare global {
  interface HTMLMediaElement {
    captureStream(): MediaStream;
  }
}

const MIME = 'audio/webm;codecs=opus';

const once = (target: EventTarget, type: string) => new Promise(resolve => target.addEventListener(type, resolve, { once: true }));

function base64(blob: Blob): Promise<string> {
  const reader = new FileReader();
  const done = once(reader, 'loadend');
  reader.readAsDataURL(blob);
  return done.then(() => String(reader.result).split(',')[1] ?? '');
}

// Returns null when the video gives no audio track, for example a video without sound.
export async function recordPart(video: HTMLVideoElement, start: number, end: number): Promise<MediaFile | null> {
  const before = { time: video.currentTime, paused: video.paused };
  video.pause();
  video.currentTime = start;
  await once(video, 'seeked');
  const stream = video.captureStream();
  await video.play();
  const tracks = stream.getAudioTracks();
  let file: MediaFile | null = null;
  if (tracks.length) {
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
    file = { filename: `minerr-${Date.now()}.webm`, data: await base64(new Blob(chunks, { type: MIME })) };
  }
  video.pause();
  video.currentTime = before.time;
  if (!before.paused) video.play().catch(() => undefined);
  return file;
}
