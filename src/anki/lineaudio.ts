// The subtitle line of a new card, in the service worker: its sentence when the user joined two lines, and its audio.
// The audio: the server cuts it from its audio of the video,
// else the tab records the line while it plays again.
import { escapeHtml, type MediaFile } from './anki.ts';
import { toBase64 } from '../video/record.ts';
import { call } from '../shared/rpc.ts';
import { audioPadding } from '../video/videosettings.ts';
import { type AudioSource, clipAudio } from '../video/whisper.ts';

// The subtitle line of the word of a new card, as the tab reports it: times in seconds of the video.
// combined: the user joined two lines (J), so the card sentence is the text of both.
// audio is the audio that the server can have of the video, or null for a local file that the server never got.
// protected: the video has DRM, so the tab can record no audio and the screenshot shows no picture.
export interface CardLine {
  start: number;
  end: number;
  text: string;
  combined: boolean;
  audio: AudioSource | null;
  protected: boolean;
}

// The subtitle line of the word of a new card in the tab, or null for a word that is not in a subtitle line.
export const cardLine = (tabId: number): Promise<CardLine | null> => call({ type: 'videoLine' }, tabId).catch(() => null);

// The audio of the line, or null when neither the server nor the tab could give it.
export async function lineAudio(line: CardLine, tabId: number): Promise<MediaFile | null> {
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

const UNESCAPES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"' };

// The card sentence for joined lines: the text of the lines (line breaks become spaces) around the sentence of the popup,
// which has the word in <b>. If the lines do not contain that sentence, it stays as it is.
export function widenSentence(text: string, sentence: string): string {
  const plain = sentence.replace(/<[^>]*>/g, '').replace(/&(amp|lt|gt|quot);/g, entity => UNESCAPES[entity] ?? entity);
  const flat = text.replace(/\s+/g, ' ').trim();
  const at = flat.indexOf(plain);
  return at < 0 || !plain ? sentence : escapeHtml(flat.slice(0, at)) + sentence + escapeHtml(flat.slice(at + plain.length));
}
