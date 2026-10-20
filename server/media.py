"""The video side of the Minerr server: cache keys of video pages, yt-dlp, the audio cache, and line clips."""

import hashlib
import json
import re
import shutil
import subprocess
import threading
import time
import urllib.request
from pathlib import Path
from urllib.parse import parse_qs, urlsplit, urlunsplit

# The audio of each video and uploaded file, for sentence audio. A video's audio downloads once.
AUDIO = Path.home() / '.cache' / 'minerr' / 'audio'
VIDEO_ID = re.compile(r'[A-Za-z0-9_-]{11}')
# The subtitle formats that the extension reads, best first.
CAPTION_EXTS = ('json3', 'vtt', 'srt')


def youtube_host(parts):
    """The YouTube host of a split URL without www. or m., or None for another site."""
    host = (parts.hostname or '').removeprefix('www.').removeprefix('m.')
    return host if host in ('youtu.be', 'youtube.com', 'music.youtube.com') else None


def video_id(url):
    """The YouTube video id in an http(s) URL. Raises ValueError for anything else."""
    parts = urlsplit(url)
    if parts.scheme not in ('http', 'https'):
        raise ValueError('Use an http or https URL.')
    host = youtube_host(parts)
    if host == 'youtu.be':
        found = parts.path.strip('/').split('/')[0]
    elif host:
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
    if youtube_host(parts):
        return video_id(url)
    return hashlib.sha256(urlunsplit(parts._replace(fragment='')).encode()).hexdigest()


def page_url(key, url):
    """The URL that yt-dlp opens: the plain watch URL for a YouTube video id."""
    return f'https://www.youtube.com/watch?v={key}' if VIDEO_ID.fullmatch(key) else url


def yt_dlp(*args, timeout):
    command = shutil.which('yt-dlp') or str(Path.home() / '.local' / 'bin' / 'yt-dlp')
    return subprocess.run([command, '--quiet', '--no-warnings', '--no-playlist', '--js-runtimes', 'node', *args],
                          check=True, capture_output=True, text=True, timeout=timeout).stdout


def cached_audio(key):
    """The finished audio file of key in AUDIO, or None. Only <key>.<ext> is finished: yt-dlp also writes names such as
    <key>.webm.part-Frag3 and <key>.temp.m4a, and a killed download leaves them."""
    if not AUDIO.is_dir():
        return None
    return next((path for path in AUDIO.glob(f'{key}.*') if path.stem == key and path.suffix not in ('.part', '.ytdl')), None)


# One lock for each key, so a WhisperX job and a clip never download the same audio at the same time.
downloads = {}
downloads_lock = threading.Lock()


def download_audio(url, key):
    """The audio file of the video at url, from AUDIO, downloaded first if it is not there."""
    with downloads_lock:
        lock = downloads.setdefault(key, threading.Lock())
    with lock:
        found = cached_audio(key)
        if found:
            return found
        AUDIO.mkdir(parents=True, exist_ok=True)
        # The partial files stay in .tmp until yt-dlp moves the finished file to AUDIO, so /clip never reads one.
        # A site without an audio-only format gets a small video, and a page with many videos gets its first.
        yt_dlp('-f', 'bestaudio/best[height<=480]/worst', '--playlist-items', '1', '-P', str(AUDIO), '-P', f'temp:{AUDIO / ".tmp"}',
               '-o', f'{key}.%(ext)s', '--', page_url(key, url), timeout=1800)
        found = cached_audio(key)
        if not found:
            raise RuntimeError('yt-dlp wrote no audio file.')
        return found


def start_download(url, key):
    """Downloads the audio in a thread. A second call waits for the first download and then finds the file."""
    def run():
        try:
            download_audio(url, key)
        except Exception:
            pass
    threading.Thread(target=run, daemon=True).start()


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


# The info of yt-dlp for each video, for some minutes: the extension asks for two languages at once.
# ponytail: one lock for all videos, so a second video waits for the first; a lock per key if that gets slow.
INFO_SECONDS = 600
infos = {}
info_lock = threading.Lock()


def video_info(url, key):
    with info_lock:
        found = infos.get(key)
        if not found or time.monotonic() - found[0] > INFO_SECONDS:
            found = infos[key] = (time.monotonic(), json.loads(yt_dlp('-J', '--', page_url(key, url), timeout=300)))
        return found[1]


def fetch_captions(url, key, lang):
    """The subtitles of the video in lang, as {'ext', 'text'}, or None if it has none."""
    info = video_info(url, key)
    track = pick_track(info, lang)
    if not track:
        return None
    with urllib.request.urlopen(track[0], timeout=60) as response:
        return {'ext': track[1], 'text': response.read().decode('utf-8', 'replace')}


def keep_upload_audio(upload, key):
    # A file that ffmpeg cannot read has no audio to keep; its subtitles are still good.
    try:
        if not cached_audio(key):
            keep_audio(upload, key)
    except Exception:
        pass
    finally:
        upload.unlink(missing_ok=True)
