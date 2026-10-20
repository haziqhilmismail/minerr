// The sentence audio of a new card, in the service worker: the server cuts it from its audio of the video,
// else the tab records the line while it plays again.
import type { MediaFile } from './anki.ts';
import { call } from './rpc.ts';
import { audioPadding } from './videosettings.ts';
import { type AudioSource, clipAudio } from './whisper.ts';

// The subtitle line of the word of a new card, as the tab reports it: times in seconds of the video.
// audio is the audio that the server can have of the video, or null for a local file that the server never got.
export interface CardLine {
  start: number;
  end: number;
  text: string;
  audio: AudioSource | null;
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let text = '';
  // String.fromCharCode takes its arguments on the stack, so the bytes go in chunks.
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

// Null when the word is not in a subtitle line, or when neither the server nor the tab could give the audio.
export async function lineAudio(tabId: number): Promise<MediaFile | null> {
  const line = await call({ type: 'videoLine' }, tabId).catch(() => null);
  if (!line) return null;
  const padding = (await audioPadding.get()) / 1000;
  const start = Math.max(0, line.start - padding);
  const end = line.end + padding;
  if (line.audio) {
    try {
      return { filename: `minerr-${Date.now()}.mp3`, data: toBase64(await clipAudio(line.audio, start, end)) };
    } catch (error) {
      console.warn('minerr: the server gave no line audio, so the tab records it', error);
    }
  }
  return call({ type: 'videoRecord', start, end }, tabId).catch(() => null);
}
