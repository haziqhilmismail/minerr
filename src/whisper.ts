import type { SubtitleSegment } from './captions.ts';
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

// Returns the JSON reply, or null for 404 (no such job, no cached subtitles).
async function request(path: string, body?: object): Promise<unknown> {
  let response;
  try {
    response = await fetch(SERVER + path, body && { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new Error('Start the WhisperX server: uv run server/whisper_server.py');
  }
  if (response.status === 404) return null;
  const reply: unknown = await response.json();
  if (!response.ok) {
    const error = at(reply, 'error');
    throw new Error(typeof error === 'string' ? error : `The WhisperX server answered ${response.status}.`);
  }
  return reply;
}

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
  const id = at(await request('/jobs', { url }), 'id');
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
