import { parseCaptions, type SubtitleSegment } from './captions.ts';
import { at, isList } from './parse.ts';

const SERVER = 'http://127.0.0.1:8766';

export interface Health {
  model: string;
  device: string;
}

// A WhisperX job. A done job has the subtitles.
export type Job =
  | { state: 'queued' | 'downloading' }
  | { state: 'transcribing'; progress: number }
  | { state: 'done'; segments: SubtitleSegment[] }
  | { state: 'error'; error: string };

// A job as the toolbar popup shows it, without the subtitles.
export type JobStatus = Exclude<Job, { state: 'done' }> | { state: 'done' };

async function send(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(SERVER + path, init);
  } catch {
    throw new Error('Start the WhisperX server: uv run server/whisper_server.py');
  }
}

async function fail(response: Response): Promise<never> {
  const error = at(await response.json().catch(() => null), 'error');
  throw new Error(typeof error === 'string' ? error : `The WhisperX server answered ${response.status}.`);
}

// Returns the JSON reply, or null for 404 (no such job, no cached subtitles).
async function request(path: string, init?: RequestInit): Promise<unknown> {
  const response = await send(path, init);
  if (response.status === 404) return null;
  if (!response.ok) return fail(response);
  return response.json();
}

const postJson = (body: object): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

function unexpected(): never {
  throw new Error('The WhisperX server sent an unexpected reply.');
}

const isSegment = (value: unknown): value is SubtitleSegment => typeof at(value, 'start') === 'number'
  && typeof at(value, 'end') === 'number' && typeof at(value, 'text') === 'string';

function toSegments(value: unknown): SubtitleSegment[] {
  if (!isList(value) || !value.every(isSegment)) unexpected();
  return value;
}

function toJob(value: unknown): Job {
  const state = at(value, 'state');
  switch (state) {
    case 'queued':
    case 'downloading':
      return { state };
    case 'transcribing': {
      const progress = at(value, 'progress');
      return { state, progress: typeof progress === 'number' ? progress : 0 };
    }
    case 'done':
      return { state, segments: toSegments(at(value, 'segments')) };
    case 'error': {
      const error = at(value, 'error');
      return { state, error: typeof error === 'string' ? error : 'The WhisperX job failed.' };
    }
    default:
      return unexpected();
  }
}

export async function health(): Promise<Health> {
  const reply = await request('/health');
  const model = at(reply, 'model');
  const device = at(reply, 'device');
  if (typeof model !== 'string' || typeof device !== 'string') unexpected();
  return { model, device };
}

export async function startJob(url: string): Promise<{ id: string }> {
  const id = at(await request('/jobs', postJson({ url })), 'id');
  if (typeof id !== 'string') unexpected();
  return { id };
}

// Sends the file to the server, which transcribes it in a job. fetch streams the file from the disk.
// The header must be ISO-8859-1 text, so the file name is URL-encoded.
export async function uploadFile(file: File): Promise<{ id: string }> {
  const headers = { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name) };
  const id = at(await request('/files', { method: 'POST', headers, body: file }), 'id');
  if (typeof id !== 'string') unexpected();
  return { id };
}

export async function getJob(id: string): Promise<Job | null> {
  const reply = await request(`/jobs/${encodeURIComponent(id)}`);
  return reply === null ? null : toJob(reply);
}

export async function cachedSegments(videoId: string): Promise<SubtitleSegment[] | null> {
  const reply = await request(`/subs/${encodeURIComponent(videoId)}`);
  return reply === null ? null : toSegments(reply);
}

// The subtitles of the site in lang (a code such as ja), which the server finds with yt-dlp, or null if the video has none.
export async function siteCaptions(url: string, lang: string): Promise<SubtitleSegment[] | null> {
  const reply = await request('/captions', postJson({ url, lang }));
  if (reply === null) return null;
  const ext = at(reply, 'ext');
  const text = at(reply, 'text');
  if (typeof ext !== 'string' || typeof text !== 'string') unexpected();
  return parseCaptions(ext, text);
}

// The audio that the server has of a video page (url) or of an uploaded file (sha256).
export type AudioSource = { url: string } | { sha256: string };

// An MP3 of the audio between start and end, in seconds.
export async function clipAudio(source: AudioSource, start: number, end: number): Promise<ArrayBuffer> {
  const response = await send('/clip', postJson({ ...source, start, end }));
  if (!response.ok) return fail(response);
  return response.arrayBuffer();
}
