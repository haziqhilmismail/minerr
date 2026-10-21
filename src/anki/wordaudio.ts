// The audio of a word from JapanesePod101, the default audio source of Yomitan, for the service worker.
import type { MediaFile } from './anki.ts';
import { toBase64 } from '../video/record.ts';

const KANA = /^[ぁ-ゖァ-ヺー]+$/;

// Yomitan _getInfoJpod101: a word in kana only sends no kanji.
export function wordAudioUrl(expression: string, reading: string): string {
  const params = new URLSearchParams();
  if (!(expression === reading && KANA.test(expression))) params.set('kanji', expression);
  if (reading) params.set('kana', reading);
  return `https://assets.languagepod101.com/dictionary/japanese/audiomp3.php?${params}`;
}

// JapanesePod101 answers a word that it has no audio for with this clip, "The audio for this clip is currently not available".
// Yomitan _isAudioBinaryValid rejects the clip by its SHA-256.
const PLACEHOLDER_SHA256 = 'ae6398b5a27bc8c0a771df6c907ade794be15518174773c58c7c7ddd17098906';

export const isPlaceholder = (sha256: string): boolean => sha256 === PLACEHOLDER_SHA256;

// The clip as a media file named by its hash, so the same clip is one file in Anki. Null for the placeholder clip.
export async function wordAudioFile(bytes: ArrayBuffer): Promise<MediaFile | null> {
  const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return isPlaceholder(sha256) ? null : { filename: `minerr-word-${sha256.slice(0, 16)}.mp3`, data: toBase64(bytes) };
}

// Null if the fetch fails or JapanesePod101 has no audio of the word: the card then has no word audio.
export async function wordAudio(expression: string, reading: string): Promise<MediaFile | null> {
  try {
    const response = await fetch(wordAudioUrl(expression, reading), { signal: AbortSignal.timeout(8000) });
    return response.ok ? await wordAudioFile(await response.arrayBuffer()) : null;
  } catch (error) {
    console.warn('minerr: no word audio from JapanesePod101', error);
    return null;
  }
}
