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
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit, urlunsplit

PORT = 8766
CACHE = Path.home() / '.cache' / 'minerr' / 'subs'
# Uploads go to disk next to the cache, not to /tmp, which is in memory on some systems.
UPLOADS = Path.home() / '.cache' / 'minerr' / 'uploads'
# The audio of each video and uploaded file, for sentence audio. A video's audio downloads once.
AUDIO = Path.home() / '.cache' / 'minerr' / 'audio'
CHUNK = 1 << 20
VIDEO_ID = re.compile(r'[A-Za-z0-9_-]{11}')
SHA256 = re.compile(r'[0-9a-f]{64}')
LANG = re.compile(r'[a-z]{2,3}')
# The subtitle formats that the extension reads, best first.
CAPTION_EXTS = ('json3', 'vtt', 'srt')
MAX_CLIP = 60
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


def media_key(url):
    """The cache key of a video page: the YouTube video id, or the SHA-256 of any other http(s) URL without its fragment."""
    parts = urlsplit(url)
    if parts.scheme not in ('http', 'https') or not parts.hostname:
        raise ValueError('Use an http or https URL.')
    try:
        return video_id(url)
    except ValueError as error:
        if 'no YouTube video id' in str(error):
            raise
    return hashlib.sha256(urlunsplit(parts._replace(fragment='')).encode()).hexdigest()


def page_url(key, url):
    """The URL that yt-dlp opens: the plain watch URL for a YouTube video id."""
    return f'https://www.youtube.com/watch?v={key}' if VIDEO_ID.fullmatch(key) else url


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


def yt_dlp(*args, timeout):
    command = shutil.which('yt-dlp') or str(Path.home() / '.local' / 'bin' / 'yt-dlp')
    return subprocess.run([command, '--quiet', '--no-warnings', '--no-playlist', '--js-runtimes', 'node', *args],
                          check=True, capture_output=True, text=True, timeout=timeout).stdout


def cached_audio(key):
    return next((path for path in AUDIO.glob(f'{key}.*') if path.suffix != '.part'), None) if AUDIO.is_dir() else None


def download_audio(url, key):
    """The audio file of the video at url, from AUDIO, downloaded first if it is not there."""
    found = cached_audio(key)
    if found:
        return found
    AUDIO.mkdir(parents=True, exist_ok=True)
    yt_dlp('-f', 'bestaudio/best', '-o', str(AUDIO / f'{key}.%(ext)s'), '--', page_url(key, url), timeout=1800)
    found = cached_audio(key)
    if not found:
        raise RuntimeError('yt-dlp wrote no audio file.')
    return found


def keep_audio(path, key):
    """Copies the audio stream of an uploaded file to AUDIO, so the file can go."""
    AUDIO.mkdir(parents=True, exist_ok=True)
    subprocess.run(['ffmpeg', '-nostdin', '-loglevel', 'error', '-y', '-i', str(path), '-vn', '-c:a', 'copy', str(AUDIO / f'{key}.mka')],
                   check=True, capture_output=True, timeout=600)


def clip(source, start, end):
    """MP3 bytes of the audio of source from start to end, in seconds."""
    result = subprocess.run(['ffmpeg', '-nostdin', '-loglevel', 'error', '-ss', f'{start:.3f}', '-t', f'{end - start:.3f}', '-i', str(source),
                             '-vn', '-ac', '1', '-c:a', 'libmp3lame', '-q:a', '4', '-f', 'mp3', 'pipe:1'],
                            check=True, capture_output=True, timeout=120)
    return result.stdout


def pick_track(info, lang):
    """The URL and format of the best subtitle track in lang: a track of the uploader first, then the automatic
    track in the language of the video, then any automatic one (YouTube translates it)."""
    def best(tracks):
        usable = [t for t in tracks or [] if t.get('ext') in CAPTION_EXTS and t.get('url')]
        return min(usable, key=lambda t: CAPTION_EXTS.index(t['ext']), default=None)
    own = info.get('subtitles') or {}
    auto = info.get('automatic_captions') or {}
    names = sorted((name for name in own if name == lang or name.startswith(f'{lang}-')), key=len)
    for tracks in [*(own[name] for name in names), auto.get(f'{lang}-orig'), auto.get(lang)]:
        track = best(tracks)
        if track:
            return track['url'], track['ext']
    return None


def fetch_captions(url, key, lang):
    """The subtitles of the video in lang, as {'ext', 'text'}, or None if it has none."""
    info = json.loads(yt_dlp('-J', '--', page_url(key, url), timeout=300))
    track = pick_track(info, lang)
    if not track:
        return None
    with urllib.request.urlopen(track[0], timeout=60) as response:
        return {'ext': track[1], 'text': response.read().decode('utf-8', 'replace')}


def write_json(path, value):
    """Writes value to path in one step, so a reader never sees half a file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.with_suffix('.tmp').write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8')
    os.replace(path.with_suffix('.tmp'), path)


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8')) if path.is_file() else None


def failure(error):
    """The text of an error for the extension. A yt-dlp error ends with its own message."""
    if isinstance(error, subprocess.CalledProcessError):
        stderr = error.stderr.decode('utf-8', 'replace') if isinstance(error.stderr, bytes) else error.stderr or ''
        return f'{Path(str(error.cmd[0])).name} failed: {stderr.strip()[-300:]}'
    return f'{type(error).__name__}: {error}'


class Jobs:
    """A FIFO queue of transcription jobs, run one at a time because transcription uses all the CPU cores."""

    def __init__(self, transcribe):
        self.transcribe = transcribe
        self.jobs = {}
        self.lock = threading.Lock()
        self.queue = queue.Queue()
        threading.Thread(target=self.work, daemon=True).start()

    # key is a YouTube video id, the SHA-256 of another video URL, or the SHA-256 of an uploaded file.
    def cache_path(self, key):
        return CACHE / f'{key}.{self.transcribe.name}.json'

    def cached(self, key):
        return read_json(self.cache_path(key))

    def start(self, key, upload=None, url=None):
        """Queues a job for key, or returns the running job for key. The job owns upload, a file that it deletes when it ends.
        A job without upload downloads the audio of url."""
        with self.lock:
            for job_id, job in self.jobs.items():
                if job['key'] == key and job['state'] not in ('done', 'error'):
                    if upload:
                        upload.unlink(missing_ok=True)
                    return job_id
            job_id = uuid.uuid4().hex
            self.jobs[job_id] = {'key': key, 'upload': upload, 'url': url, 'state': 'queued'}
        self.queue.put(job_id)
        return job_id

    def get(self, job_id):
        """The public fields of the job, or None."""
        with self.lock:
            job = self.jobs.get(job_id)
            return {k: v for k, v in job.items() if k not in ('key', 'upload', 'url')} if job else None

    def update(self, job_id, **fields):
        with self.lock:
            self.jobs[job_id].update(fields)

    def subtitles(self, job_id, key, upload, url):
        def on_progress(percent):
            self.update(job_id, progress=percent)
        if not upload:
            self.update(job_id, state='downloading')
        audio = upload or download_audio(url, key)
        self.update(job_id, state='transcribing', progress=0)
        return self.transcribe(audio, on_progress)

    def work(self):
        while True:
            job_id = self.queue.get()
            job = self.jobs[job_id]
            key, upload, url = job['key'], job['upload'], job['url']
            try:
                segments = self.cached(key)
                if segments is None:
                    segments = self.subtitles(job_id, key, upload, url)
                    write_json(self.cache_path(key), segments)
                result = {'state': 'done', 'segments': segments}
            except Exception as error:
                result = {'state': 'error', 'error': failure(error)}
            # The upload goes before the job ends, so a client that sees the end sees no upload.
            if upload:
                keep_upload_audio(upload, key)
            self.update(job_id, **result)


def keep_upload_audio(upload, key):
    # A file that ffmpeg cannot read has no audio to keep; its subtitles are still good.
    try:
        if not cached_audio(key):
            keep_audio(upload, key)
    except Exception:
        pass
    finally:
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
            routes = {'/jobs': self.job, '/captions': self.captions, '/clip': self.clip}
            route = routes.get(self.path)
            if not route or not self.headers.get('Content-Type', '').startswith('application/json'):
                return self.reply(404, {'error': 'Not found.'})
            try:
                body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))) or b'{}')
                if not isinstance(body, dict):
                    raise ValueError('Send a JSON object.')
                route(body)
            except (ValueError, TypeError) as error:
                self.reply(400, {'error': str(error)})

        def job(self, body):
            url = str(body.get('url', ''))
            self.reply(200, {'id': jobs.start(media_key(url), url=url)})

        # POST /captions {url, lang}: the subtitles of the site in lang, as {ext, text}. yt-dlp finds them; the cache keeps them.
        def captions(self, body):
            url, lang = str(body.get('url', '')), str(body.get('lang', ''))
            if not LANG.fullmatch(lang):
                raise ValueError('Send a language code such as ja.')
            key = media_key(url)
            path = CACHE / f'{key}.captions.{lang}.json'
            found = read_json(path)
            if found is None:
                try:
                    found = fetch_captions(url, key, lang) or {}
                except Exception as error:
                    return self.reply(502, {'error': failure(error)})
                write_json(path, found)
            if not found:
                return self.reply(404, {'error': f'The video has no {lang} subtitles.'})
            self.reply(200, found)

        # POST /clip {url or sha256, start, end}: an MP3 of the audio between start and end, in seconds.
        # The audio of a URL downloads once; the audio of a file is there only after a WhisperX job for the file.
        def clip(self, body):
            start, end = body.get('start'), body.get('end')
            if not all(isinstance(t, (int, float)) and not isinstance(t, bool) for t in (start, end)) or not 0 <= start < end <= start + MAX_CLIP:
                raise ValueError(f'Send a start and an end in seconds, at most {MAX_CLIP} seconds apart.')
            sha256 = str(body.get('sha256', ''))
            try:
                if sha256:
                    if not SHA256.fullmatch(sha256):
                        raise ValueError('The sha256 is not a SHA-256.')
                    source = cached_audio(sha256)
                    if not source:
                        return self.reply(404, {'error': 'The server has no audio of this file. Generate subtitles with WhisperX first.'})
                else:
                    url = str(body.get('url', ''))
                    source = download_audio(url, media_key(url))
                data = clip(source, start, end)
            except ValueError:
                raise
            except Exception as error:
                return self.reply(502, {'error': failure(error)})
            self.send_response(200)
            self.send_header('Content-Type', 'audio/mpeg')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)

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
