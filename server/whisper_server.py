# /// script
# requires-python = "==3.12.*"
# dependencies = [
#   "whisperx==3.8.6",
#   "torch==2.8.0",
#   "torchaudio==2.8.0",
#   "torchvision==0.23.0",
# ]
#
# [[tool.uv.index]]
# name = "pytorch-cpu"
# url = "https://download.pytorch.org/whl/cpu"
# explicit = true
#
# [tool.uv.sources]
# torch = { index = "pytorch-cpu" }
# torchaudio = { index = "pytorch-cpu" }
# torchvision = { index = "pytorch-cpu" }
# ///
"""Local WhisperX subtitle server for Minerr. Run: uv run server/whisper_server.py"""

import argparse
import hashlib
import json
import os
import queue
import re
import shutil
import subprocess
import tempfile
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

PORT = 8766
CACHE = Path.home() / '.cache' / 'minerr' / 'subs'
# Uploads go to disk next to the cache, not to /tmp, which is in memory on some systems.
UPLOADS = Path.home() / '.cache' / 'minerr' / 'uploads'
CHUNK = 1 << 20
VIDEO_ID = re.compile(r'[A-Za-z0-9_-]{11}')
SHA256 = re.compile(r'[0-9a-f]{64}')
# Whisper ends a Japanese sentence with 。！？ or, when it omits the punctuation, with a space.
SENTENCE = re.compile(r'.+?(?:[。！？!?]+[」』）)]*|\s+|$)', re.S)
MAX_CHARS = 40


def video_id(url):
    """The YouTube video id in an http(s) URL. Raises ValueError for anything else."""
    parts = urlsplit(url)
    if parts.scheme not in ('http', 'https'):
        raise ValueError('Use an http or https URL.')
    host = (parts.hostname or '').removeprefix('www.').removeprefix('m.')
    if host == 'youtu.be':
        found = parts.path.strip('/').split('/')[0]
    elif host in ('youtube.com', 'music.youtube.com'):
        path = parts.path.strip('/').split('/')
        found = path[1] if len(path) > 1 and path[0] in ('shorts', 'live', 'embed') else parse_qs(parts.query).get('v', [''])[0]
    else:
        raise ValueError('Use a YouTube video URL.')
    if not VIDEO_ID.fullmatch(found):
        raise ValueError('The URL has no YouTube video id.')
    return found


def split_segment(segment, max_chars=MAX_CHARS):
    """Splits a long segment at sentence ends; each part gets time in proportion to its length."""
    text = segment['text'].strip()
    parts = [p.strip() for p in SENTENCE.findall(text)] if len(text) > max_chars else [text]
    parts = [p for p in parts if p]
    start, end = segment['start'], segment['end']
    total = sum(map(len, parts))
    out, at = [], start
    for part in parts:
        length = (end - start) * len(part) / total
        out.append({'start': round(at, 3), 'end': round(at + length, 3), 'text': part})
        at += length
    if out:
        out[-1]['end'] = end
    return out


def subtitle_segments(segments):
    return [part for segment in segments for part in split_segment(segment)]


def receive(stream, length, filename):
    """Copies length bytes of stream to a new file in UPLOADS, one chunk at a time. Returns the path and the SHA-256."""
    suffix = Path(filename).suffix
    UPLOADS.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256()
    with tempfile.NamedTemporaryFile(dir=UPLOADS, suffix=suffix if re.fullmatch(r'\.\w{1,10}', suffix) else '', delete=False) as out:
        path = Path(out.name)
        try:
            while length:
                chunk = stream.read(min(CHUNK, length))
                if not chunk:
                    raise ValueError('The upload ended before Content-Length bytes.')
                digest.update(chunk)
                out.write(chunk)
                length -= len(chunk)
        except BaseException:
            path.unlink(missing_ok=True)
            raise
    return path, digest.hexdigest()


class Transcriber:
    def __init__(self, model, threads, batch_size):
        self.name, self.threads, self.batch_size = model, threads, batch_size
        self.model = None

    def __call__(self, audio_path, on_progress):
        import whisperx
        if self.model is None:
            self.model = whisperx.load_model(self.name, 'cpu', compute_type='int8', language='ja', threads=self.threads)
        # load_audio runs ffmpeg, so audio_path can also be a video file: ffmpeg takes out its audio.
        audio = whisperx.load_audio(str(audio_path))
        result = self.model.transcribe(audio, batch_size=self.batch_size, language='ja',
                                       progress_callback=lambda percent: on_progress(round(percent)))
        return subtitle_segments(result['segments'])


def download_audio(vid, folder):
    yt_dlp = shutil.which('yt-dlp') or str(Path.home() / '.local' / 'bin' / 'yt-dlp')
    subprocess.run([yt_dlp, '--quiet', '--no-warnings', '--no-playlist', '--js-runtimes', 'node', '-f', 'bestaudio',
                    '-o', str(Path(folder) / 'audio.%(ext)s'), '--', f'https://www.youtube.com/watch?v={vid}'],
                   check=True, capture_output=True, text=True, timeout=1800)
    return next(Path(folder).glob('audio.*'))


class Jobs:
    """A FIFO queue of transcription jobs, run one at a time because transcription uses all the CPU cores."""

    def __init__(self, transcribe):
        self.transcribe = transcribe
        self.jobs = {}
        self.lock = threading.Lock()
        self.queue = queue.Queue()
        threading.Thread(target=self.work, daemon=True).start()

    # key is a YouTube video id, or the SHA-256 of an uploaded file.
    def cache_path(self, key):
        return CACHE / f'{key}.{self.transcribe.name}.json'

    def cached(self, key):
        path = self.cache_path(key)
        return json.loads(path.read_text(encoding='utf-8')) if path.is_file() else None

    def start(self, key, upload=None):
        """Queues a job for key, or returns the running job for key. The job owns upload, a file that it deletes when it ends."""
        with self.lock:
            for job_id, job in self.jobs.items():
                if job['key'] == key and job['state'] not in ('done', 'error'):
                    if upload:
                        upload.unlink(missing_ok=True)
                    return job_id
            job_id = uuid.uuid4().hex
            self.jobs[job_id] = {'key': key, 'upload': upload, 'state': 'queued'}
        self.queue.put(job_id)
        return job_id

    def get(self, job_id):
        """The public fields of the job, or None."""
        with self.lock:
            job = self.jobs.get(job_id)
            return {k: v for k, v in job.items() if k not in ('key', 'upload')} if job else None

    def update(self, job_id, **fields):
        with self.lock:
            self.jobs[job_id].update(fields)

    def subtitles(self, job_id, key, upload):
        def on_progress(percent):
            self.update(job_id, progress=percent)
        if upload:
            self.update(job_id, state='transcribing', progress=0)
            return self.transcribe(upload, on_progress)
        with tempfile.TemporaryDirectory(prefix='minerr-audio-') as folder:
            self.update(job_id, state='downloading')
            audio = download_audio(key, folder)
            self.update(job_id, state='transcribing', progress=0)
            return self.transcribe(audio, on_progress)

    def work(self):
        while True:
            job_id = self.queue.get()
            key, upload = self.jobs[job_id]['key'], self.jobs[job_id]['upload']
            try:
                segments = self.cached(key)
                if segments is None:
                    segments = self.subtitles(job_id, key, upload)
                    CACHE.mkdir(parents=True, exist_ok=True)
                    path = self.cache_path(key)
                    path.with_suffix('.tmp').write_text(json.dumps(segments, ensure_ascii=False), encoding='utf-8')
                    os.replace(path.with_suffix('.tmp'), path)
                self.update(job_id, state='done', segments=segments)
            except subprocess.CalledProcessError as error:
                self.update(job_id, state='error', error=f'yt-dlp failed: {(error.stderr or "").strip()[-300:]}')
            except Exception as error:
                self.update(job_id, state='error', error=f'{type(error).__name__}: {error}')
            finally:
                if upload:
                    upload.unlink(missing_ok=True)


def handler(jobs, health, port=PORT):
    class Handler(BaseHTTPRequestHandler):
        def reply(self, status, body):
            data = json.dumps(body, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        # The Host check stops DNS rebinding. The POST content types (JSON, octet-stream) make a browser preflight
        # cross-site requests, and the server answers no preflight, so they fail.
        def allowed(self):
            if self.headers.get('Host') not in (f'127.0.0.1:{port}', f'localhost:{port}'):
                self.reply(403, {'error': 'Forbidden host.'})
                return False
            return True

        def do_GET(self):
            if not self.allowed():
                return
            path = self.path.split('?')[0].strip('/').split('/')
            if path == ['health']:
                return self.reply(200, health)
            if len(path) == 2 and path[0] == 'jobs':
                job = jobs.get(path[1])
                return self.reply(200, job) if job else self.reply(404, {'error': 'No such job.'})
            if len(path) == 2 and (path[0] == 'subs' and VIDEO_ID.fullmatch(path[1]) or path[0] == 'files' and SHA256.fullmatch(path[1])):
                segments = jobs.cached(path[1])
                return self.reply(200, segments) if segments is not None else self.reply(404, {'error': 'No subtitles yet.'})
            self.reply(404, {'error': 'Not found.'})

        def do_POST(self):
            if not self.allowed():
                return
            if self.path == '/files':
                return self.upload()
            if self.path != '/jobs' or not self.headers.get('Content-Type', '').startswith('application/json'):
                return self.reply(404, {'error': 'Not found.'})
            try:
                body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))) or b'{}')
                vid = video_id(str(body.get('url', '')))
            except (ValueError, AttributeError) as error:
                return self.reply(400, {'error': str(error)})
            self.reply(200, {'id': jobs.start(vid)})

        # POST /files: the body is the media file. The job transcribes it and caches the subtitles by its SHA-256.
        def upload(self):
            if self.headers.get('Content-Type') != 'application/octet-stream':
                return self.reply(415, {'error': 'Send the file as application/octet-stream.'})
            filename = unquote(self.headers.get('X-Filename', ''))
            if not filename:
                return self.reply(400, {'error': 'Send the file name in X-Filename.'})
            if not self.headers.get('Content-Length', '').isdigit():
                return self.reply(411, {'error': 'Send a Content-Length.'})
            try:
                path, sha256 = receive(self.rfile, int(self.headers['Content-Length']), filename)
            except ValueError as error:
                return self.reply(400, {'error': str(error)})
            self.reply(200, {'id': jobs.start(sha256, path), 'sha256': sha256})

        def log_message(self, format, *args):
            pass

    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', default='large-v3-turbo', help='faster-whisper model name (default: %(default)s)')
    parser.add_argument('--threads', type=int, default=max(1, (os.cpu_count() or 2) // 2), help='CPU threads (default: %(default)s)')
    parser.add_argument('--batch-size', type=int, default=8)
    args = parser.parse_args()
    jobs = Jobs(Transcriber(args.model, args.threads, args.batch_size))
    health = {'ok': True, 'model': args.model, 'device': 'cpu', 'compute_type': 'int8'}
    server = ThreadingHTTPServer(('127.0.0.1', PORT), handler(jobs, health))
    print(f'Minerr WhisperX server on http://127.0.0.1:{PORT} (model {args.model}, {args.threads} threads)', flush=True)
    server.serve_forever()


if __name__ == '__main__':
    main()
