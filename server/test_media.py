"""Run: python3 -I -B -m unittest discover -s server -v."""

import hashlib
import json
import os
import re
import subprocess
import sys
import sysconfig
import tempfile
import threading
import types
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock

import media
from media import media_key, pick_track, video_id


def loudness(path):
    """The integrated loudness of the audio file at path, in LUFS."""
    out = subprocess.run(['ffmpeg', '-nostdin', '-hide_banner', '-i', str(path), '-af', 'ebur128', '-f', 'null', '-'],
                         check=True, capture_output=True, text=True).stderr
    return float(re.findall(r'I:\s+(-?[\d.]+) LUFS', out)[-1])


class Clip(unittest.TestCase):
    def test_quiet_and_loud_audio_give_clips_of_one_loudness(self):
        with tempfile.TemporaryDirectory() as folder:
            for volume, level in (('0.03', -39), ('0.9', -10)):
                with self.subTest(volume):
                    # A 300 Hz tone with a syllable rhythm of 4 Hz and a pause in each 2 seconds, like speech.
                    source = Path(folder, f'{volume}.wav')
                    subprocess.run(['ffmpeg', '-nostdin', '-loglevel', 'error', '-f', 'lavfi', '-i',
                                    f'aevalsrc={volume}*sin(2*PI*300*t)*(0.5+0.5*sin(2*PI*4*t))*lt(mod(t\\,2)\\,1.3):s=44100:d=6', str(source)],
                                   check=True)
                    self.assertEqual(round(loudness(source)), level)
                    clip = Path(folder, f'{volume}.mp3')
                    clip.write_bytes(media.clip(source, 1, 4))
                    found = loudness(clip)
                    self.assertLessEqual(abs(found + 16), 2, f'{found} LUFS, not -16 LUFS')


class Decode(unittest.TestCase):
    def test_gives_16_khz_mono_16_bit_samples_of_any_audio(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder, 'stereo.wav')
            subprocess.run(['ffmpeg', '-nostdin', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1:sample_rate=44100',
                            '-ac', '2', str(source)], check=True)
            self.assertEqual(len(media.decode(source)), 16000 * 2)


class Programs(unittest.TestCase):
    """uv run puts the scripts folder of the server's environment first on the PATH, and the yt-dlp package puts yt-dlp there."""

    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.scripts, self.user = Path(folder.name, 'env', 'bin'), Path(folder.name, 'user', 'bin')
        for program in (self.scripts / 'yt-dlp', self.user / 'yt-dlp', self.user / 'ffmpeg'):
            program.parent.mkdir(parents=True, exist_ok=True)
            program.write_text('#!/bin/sh\n')
            program.chmod(0o755)
        imageio_ffmpeg = types.SimpleNamespace(get_ffmpeg_exe=lambda: '/imageio/binaries/ffmpeg-linux-x86_64-v7.0.2')
        mock.patch.dict(sys.modules, {'imageio_ffmpeg': imageio_ffmpeg}).start()
        mock.patch.object(sysconfig, 'get_path', lambda name: str(self.scripts) if name == 'scripts' else None).start()
        self.addCleanup(mock.patch.stopall)

    def programs(self, *path):
        with mock.patch.dict(os.environ, {'PATH': os.pathsep.join(map(str, path))}):
            return media.which('yt-dlp'), media.find_ffmpeg()

    def test_the_programs_of_the_user_come_before_those_of_the_server_environment(self):
        self.assertEqual(self.programs(self.scripts, self.user), (str(self.user / 'yt-dlp'), str(self.user / 'ffmpeg')))

    def test_without_programs_of_the_user_the_server_runs_its_yt_dlp_package_and_the_ffmpeg_of_imageio_ffmpeg(self):
        self.assertEqual(self.programs(self.scripts), (str(self.scripts / 'yt-dlp'), '/imageio/binaries/ffmpeg-linux-x86_64-v7.0.2'))


class VideoId(unittest.TestCase):
    def test_youtube_urls(self):
        for url in ('https://www.youtube.com/watch?v=KfQPZZ5JmXw&list=PL1&t=30s',
                    'http://m.youtube.com/watch?feature=share&v=KfQPZZ5JmXw',
                    'https://youtu.be/KfQPZZ5JmXw?si=abc',
                    'https://www.youtube.com/shorts/KfQPZZ5JmXw'):
            self.assertEqual(video_id(url), 'KfQPZZ5JmXw', url)

    def test_rejects(self):
        for url, message in (('file:///etc/passwd', 'http or https'),
                             ('--exec=rm -rf ~', 'http or https'),
                             ('https://example.com/watch?v=KfQPZZ5JmXw', 'YouTube video URL'),
                             ('https://www.youtube.com/watch?v=short', 'no YouTube video id'),
                             ('https://www.youtube.com/watch?v=../../etc', 'no YouTube video id'),
                             ('https://www.youtube.com/feed/subscriptions', 'no YouTube video id')):
            with self.assertRaisesRegex(ValueError, message, msg=url):
                video_id(url)


class MediaKey(unittest.TestCase):
    def test_youtube_id_or_sha256_of_the_url(self):
        self.assertEqual(media_key('https://youtu.be/KfQPZZ5JmXw?si=abc'), 'KfQPZZ5JmXw')
        self.assertEqual(media_key('https://example.com/ep/1?x=2#t=30'), hashlib.sha256(b'https://example.com/ep/1?x=2').hexdigest())
        for url in ('file:///etc/passwd', '--exec=rm', 'https://www.youtube.com/feed/subscriptions'):
            with self.assertRaises(ValueError, msg=url):
                media_key(url)


class PickTrack(unittest.TestCase):
    def test_own_track_first_then_original_automatic_then_translation(self):
        own = {'ja-JP': [{'ext': 'srv3', 'url': 'srv3'}, {'ext': 'vtt', 'url': 'own-vtt'}], 'en': [{'ext': 'json3', 'url': 'en'}]}
        auto = {'ja': [{'ext': 'vtt', 'url': 'auto-vtt'}, {'ext': 'json3', 'url': 'auto-json3'}], 'ja-orig': [{'ext': 'json3', 'url': 'orig'}]}
        self.assertEqual(pick_track({'subtitles': own, 'automatic_captions': auto}, 'ja'), ('own-vtt', 'vtt'))
        self.assertEqual(pick_track({'subtitles': {}, 'automatic_captions': auto}, 'ja'), ('orig', 'json3'))
        self.assertEqual(pick_track({'language': 'ja', 'automatic_captions': {'ja': auto['ja']}}, 'ja'), ('auto-json3', 'json3'))
        self.assertIsNone(pick_track({'subtitles': {'ja': [{'ext': 'ass', 'url': 'x'}]}}, 'ja'))

    def test_japanese_is_never_a_translation_but_the_second_track_can_be(self):
        english_video = {'language': 'en', 'automatic_captions': {'en-orig': [{'ext': 'json3', 'url': 'en-asr'}],
                                                                  'ja': [{'ext': 'json3', 'url': 'ja-translated'}],
                                                                  'en': [{'ext': 'json3', 'url': 'en-asr-2'}]}}
        self.assertIsNone(pick_track(english_video, 'ja'), 'an English video has no Japanese subtitles, only a translation')
        japanese_video = {'language': 'ja', 'automatic_captions': {'ja-orig': [{'ext': 'json3', 'url': 'ja-asr'}],
                                                                   'en': [{'ext': 'json3', 'url': 'en-translated'}]}}
        self.assertEqual(pick_track(japanese_video, 'en'), ('en-translated', 'json3'), 'the English second track can be a translation')


class Track(BaseHTTPRequestHandler):
    def do_GET(self):
        body = 'WEBVTT\n\n00:01.000 --> 00:02.000\n猫'.encode()
        self.send_response(200)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        pass


class FetchCaptions(unittest.TestCase):
    def setUp(self):
        server = ThreadingHTTPServer(('127.0.0.1', 0), Track)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        self.track_url = f'http://127.0.0.1:{server.server_address[1]}/ja.vtt'

    def test_reads_the_info_of_yt_dlp_then_downloads_the_track(self):
        calls = []
        def fake_yt_dlp(*args, timeout):
            calls.append(args)
            return json.dumps({'subtitles': {'ja': [{'ext': 'vtt', 'url': self.track_url}]}})
        saved, media.yt_dlp = media.yt_dlp, fake_yt_dlp
        media.infos.clear()
        try:
            found = media.fetch_captions('https://youtu.be/KfQPZZ5JmXw', 'KfQPZZ5JmXw', 'ja')
            none = media.fetch_captions('https://youtu.be/KfQPZZ5JmXw', 'KfQPZZ5JmXw', 'en')
        finally:
            media.yt_dlp = saved
        self.assertEqual(found, {'ext': 'vtt', 'text': 'WEBVTT\n\n00:01.000 --> 00:02.000\n猫'})
        self.assertIsNone(none)
        self.assertEqual(calls, [('-J', '--', 'https://www.youtube.com/watch?v=KfQPZZ5JmXw')], 'the second language uses the info of the first')

    def fake_info(self, info):
        saved, media.yt_dlp = media.yt_dlp, lambda *args, timeout: json.dumps(info)
        self.addCleanup(setattr, media, 'yt_dlp', saved)
        media.infos.clear()

    def test_a_track_that_is_not_http_is_not_read(self):
        self.fake_info({'subtitles': {'ja': [{'ext': 'vtt', 'url': 'file:///etc/hostname'}]}})
        with self.assertRaisesRegex(ValueError, 'The subtitle track is not an http or https URL.'):
            media.fetch_captions('https://videos.example/ep/1', 'k', 'ja')

    def test_the_info_cache_keeps_at_most_32_videos(self):
        self.fake_info({})
        for n in range(40):
            media.video_info('https://videos.example/ep/1', f'k{n}')
        self.assertEqual(list(media.infos), [f'k{n}' for n in range(8, 40)])


class AudioCache(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.saved = media.AUDIO, media.yt_dlp
        media.AUDIO = Path(self.folder.name)

    def tearDown(self):
        media.AUDIO, media.yt_dlp = self.saved
        self.folder.cleanup()

    def test_partial_and_temp_files_of_yt_dlp_are_not_audio(self):
        for name in ('k.webm.part', 'k.webm.part-Frag3', 'k.temp.m4a', 'k.webm.ytdl', 'kk.webm'):
            (media.AUDIO / name).write_bytes(b'x')
        self.assertIsNone(media.cached_audio('k'))
        (media.AUDIO / 'k.webm').write_bytes(b'x')
        self.assertEqual(media.cached_audio('k'), media.AUDIO / 'k.webm')

    def test_download_keeps_partial_files_in_a_temp_folder_and_takes_one_audio_format(self):
        calls = []
        def fake_yt_dlp(*args, timeout):
            calls.append(args)
            (media.AUDIO / 'k.m4a').write_bytes(b'x')
        media.yt_dlp = fake_yt_dlp
        self.assertEqual(media.download_audio('https://videos.example/ep/1', 'k'), media.AUDIO / 'k.m4a')
        self.assertEqual(calls, [('-f', 'bestaudio/best[height<=480]/worst', '--playlist-items', '1', '-P', str(media.AUDIO),
                                  '-P', f'temp:{media.AUDIO / ".tmp"}', '-o', 'k.%(ext)s', '--', 'https://videos.example/ep/1')])


if __name__ == '__main__':
    unittest.main()
