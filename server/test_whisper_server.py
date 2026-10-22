"""Run: python3 -I -B -m unittest discover -s server -v (needs no WhisperX install)."""

import hashlib
import io
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock

import media
import whisper_server
from media import media_key, pick_track, video_id
from whisper_server import Jobs, handler, receive, split_segment, subtitle_segments


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


class TranscriberChunks(unittest.TestCase):
    def test_whisperx_cuts_the_audio_into_8_second_parts_and_the_cache_name_says_so(self):
        import types
        calls = {}

        class Model:
            def transcribe(self, audio, **options):
                calls['audio'], calls['transcribe'] = audio, options
                return {'segments': [{'start': 0.0, 'end': 2.0, 'text': '猫'}]}

        fake = types.ModuleType('whisperx')
        fake.load_model = lambda name, device, **options: calls.setdefault('load', (name, options)) and Model()
        with mock.patch.dict(sys.modules, {'whisperx': fake}), mock.patch.object(media, 'load_audio', lambda path: f'samples of {path}'):
            transcriber = whisper_server.Transcriber('large-v3-turbo', 2, 4)
            self.assertEqual(transcriber(Path('a.mka'), lambda percent: None), [{'start': 0.0, 'end': 2.0, 'text': '猫'}])
        name, options = calls['load']
        self.assertEqual((name, options['vad_options']), ('large-v3-turbo', {'chunk_size': 8}))
        self.assertEqual(calls['transcribe']['chunk_size'], 8)
        self.assertEqual(calls['audio'], 'samples of a.mka', 'the server decodes the audio with its own ffmpeg, not with whisperx')
        self.assertEqual(transcriber.name, 'large-v3-turbo.8s')


class SplitSegment(unittest.TestCase):
    def test_short_segment_stays_whole(self):
        self.assertEqual(split_segment({'start': 1.0, 'end': 3.0, 'text': ' 猫が魚を食べた。犬も。 '}),
                         [{'start': 1.0, 'end': 3.0, 'text': '猫が魚を食べた。犬も。'}])

    def test_long_segment_splits_at_sentence_ends_with_proportional_time(self):
        text = 'あ' * 19 + '。' + '「' + 'い' * 8 + '！」' + 'う' * 10
        self.assertEqual(split_segment({'start': 10.0, 'end': 51.0, 'text': text}), [
            {'start': 10.0, 'end': 30.0, 'text': 'あ' * 19 + '。'},
            {'start': 30.0, 'end': 41.0, 'text': '「' + 'い' * 8 + '！」'},
            {'start': 41.0, 'end': 51.0, 'text': 'う' * 10},
        ])

    def test_space_ends_a_sentence_in_a_long_segment(self):
        self.assertEqual(split_segment({'start': 0.0, 'end': 41.0, 'text': 'か' * 20 + ' ' + 'き' * 20}), [
            {'start': 0.0, 'end': 20.5, 'text': 'か' * 20},
            {'start': 20.5, 'end': 41.0, 'text': 'き' * 20},
        ])

    def test_long_segment_without_sentence_end_stays_whole(self):
        self.assertEqual(split_segment({'start': 0.0, 'end': 9.0, 'text': 'え' * 50}),
                         [{'start': 0.0, 'end': 9.0, 'text': 'え' * 50}])

    def test_empty_segments_drop_out(self):
        self.assertEqual(subtitle_segments([{'start': 0.0, 'end': 1.0, 'text': '  '},
                                            {'start': 1.0, 'end': 2.0, 'text': 'はい'}]),
                         [{'start': 1.0, 'end': 2.0, 'text': 'はい'}])


class Reader(io.BytesIO):
    """A stream that records the size of each read."""

    def __init__(self, data):
        super().__init__(data)
        self.reads = []

    def read(self, size=-1):
        self.reads.append(size)
        return super().read(size)


class FakeTranscriber:
    name = 'fake-model'

    def __init__(self):
        self.files = []

    def __call__(self, path, on_progress):
        self.files.append((path.suffix, path.read_bytes()))
        on_progress(50)
        return [{'start': 0.0, 'end': 1.5, 'text': '猫が魚を食べた。'}]


class Files(unittest.TestCase):
    def setUp(self):
        folder = Path(tempfile.mkdtemp(prefix='minerr-test-'))
        self.saved = whisper_server.CACHE, whisper_server.UPLOADS, media.AUDIO
        whisper_server.CACHE, whisper_server.UPLOADS, media.AUDIO = folder / 'subs', folder / 'uploads', folder / 'audio'
        self.transcribe = FakeTranscriber()
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), None)
        self.port = self.server.server_address[1]
        self.server.RequestHandlerClass = handler(Jobs(self.transcribe), {'ok': True}, self.port)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        whisper_server.CACHE, whisper_server.UPLOADS, media.AUDIO = self.saved

    def request(self, method, path, body=None, headers=None):
        request = urllib.request.Request(f'http://127.0.0.1:{self.port}{path}', data=body, method=method, headers=headers or {})
        try:
            with urllib.request.urlopen(request) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            with error:
                return error.code, json.loads(error.read())

    def upload(self, data, name='%E7%8C%AB.mp4'):
        return self.request('POST', '/files', data, {'Content-Type': 'application/octet-stream', 'X-Filename': name})

    def wait_done(self, job_id):
        for _ in range(100):
            status, job = self.request('GET', f'/jobs/{job_id}')
            if job.get('state') in ('done', 'error'):
                return status, job
            time.sleep(0.02)
        self.fail('the job did not end')

    def test_upload_is_transcribed_once_and_cached_by_sha256(self):
        data = bytes(range(256)) * 9000
        sha256 = hashlib.sha256(data).hexdigest()
        self.assertEqual(self.request('GET', f'/files/{sha256}'), (404, {'error': 'No subtitles yet.'}))
        status, reply = self.upload(data)
        self.assertEqual((status, reply['sha256']), (200, sha256))
        segments = [{'start': 0.0, 'end': 1.5, 'text': '猫が魚を食べた。'}]
        self.assertEqual(self.wait_done(reply['id']), (200, {'state': 'done', 'progress': 50, 'segments': segments}))
        self.assertEqual(self.transcribe.files, [('.mp4', data)])
        self.assertEqual(self.request('GET', f'/files/{sha256}'), (200, segments))
        self.assertEqual(sorted(p.name for p in whisper_server.CACHE.iterdir()), [f'{sha256}.fake-model.json'])
        self.assertEqual(list(whisper_server.UPLOADS.iterdir()), [], 'the job deletes the upload')

        status, again = self.upload(data, 'copy.webm')
        self.assertNotEqual(again['id'], reply['id'])
        self.assertEqual(self.wait_done(again['id']), (200, {'state': 'done', 'segments': segments}))
        self.assertEqual(len(self.transcribe.files), 1, 'the second upload uses the cache')
        self.assertEqual(list(whisper_server.UPLOADS.iterdir()), [])

    def test_upload_rejects(self):
        self.assertEqual(self.request('POST', '/files', b'x', {'Content-Type': 'application/json', 'X-Filename': 'a.mp4'}),
                         (415, {'error': 'Send the file as application/octet-stream.'}))
        self.assertEqual(self.request('POST', '/files', b'x', {'Content-Type': 'application/octet-stream'}),
                         (400, {'error': 'Send the file name in X-Filename.'}))
        self.assertEqual(self.upload(b'x', 'a.mp4')[0], 200)
        self.assertEqual(self.request('GET', '/files/../subs'), (404, {'error': 'Not found.'}))
        self.assertEqual(self.request('GET', '/files/ABC'), (404, {'error': 'Not found.'}))
        request = urllib.request.Request(f'http://127.0.0.1:{self.port}/files', data=b'x', method='POST',
                                         headers={'Content-Type': 'application/octet-stream', 'X-Filename': 'a.mp4', 'Host': 'evil.example:8766'})
        with self.assertRaises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(request)
        with caught.exception as error:
            self.assertEqual((error.code, json.loads(error.read())), (403, {'error': 'Forbidden host.'}))

    def test_youtube_job_downloads_then_caches_by_video_id(self):
        def fake_download(url, key):
            media.AUDIO.mkdir(parents=True, exist_ok=True)
            path = media.AUDIO / f'{key}.webm'
            path.write_bytes(key.encode())
            return path
        saved, media.download_audio = media.download_audio, fake_download
        try:
            status, reply = self.request('POST', '/jobs', json.dumps({'url': 'https://youtu.be/KfQPZZ5JmXw'}).encode(),
                                         {'Content-Type': 'application/json'})
            self.assertEqual(status, 200)
            self.assertEqual(self.wait_done(reply['id'])[1]['state'], 'done')
        finally:
            media.download_audio = saved
        self.assertEqual(self.transcribe.files, [('.webm', b'KfQPZZ5JmXw')])
        self.assertEqual(self.request('GET', '/subs/KfQPZZ5JmXw'), (200, [{'start': 0.0, 'end': 1.5, 'text': '猫が魚を食べた。'}]))

    def post(self, path, body):
        return self.request('POST', path, json.dumps(body).encode(), {'Content-Type': 'application/json'})

    def test_captions_come_from_yt_dlp_once_and_a_video_without_them_is_404(self):
        calls = []
        def fake_fetch(url, key, lang):
            calls.append((url, key, lang))
            return {'ext': 'vtt', 'text': 'WEBVTT'} if lang == 'ja' else None
        saved, media.fetch_captions = media.fetch_captions, fake_fetch
        try:
            url = 'https://www.youtube.com/watch?v=KfQPZZ5JmXw&t=3'
            self.assertEqual(self.post('/captions', {'url': url, 'lang': 'ja'}), (200, {'ext': 'vtt', 'text': 'WEBVTT'}))
            self.assertEqual(self.post('/captions', {'url': url, 'lang': 'ja'}), (200, {'ext': 'vtt', 'text': 'WEBVTT'}))
            self.assertEqual(self.post('/captions', {'url': url, 'lang': 'en'}), (404, {'error': 'The video has no en subtitles.'}))
            self.assertEqual(self.post('/captions', {'url': url, 'lang': 'en'})[0], 404)
            self.assertEqual(self.post('/captions', {'url': url, 'lang': '../x'}), (400, {'error': 'Send a language code such as ja.'}))
            self.assertEqual(self.post('/captions', {'url': 'file:///etc/passwd', 'lang': 'ja'}), (400, {'error': 'Use an http or https URL.'}))
        finally:
            media.fetch_captions = saved
        self.assertEqual(calls, [(url, 'KfQPZZ5JmXw', 'ja'), (url, 'KfQPZZ5JmXw', 'en')], 'each language runs yt-dlp one time')

    def test_clip_cuts_mp3_from_the_audio_of_an_uploaded_file(self):
        wav = subprocess.run(['ffmpeg', '-nostdin', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-f', 'wav', 'pipe:1'],
                             check=True, capture_output=True).stdout
        sha256 = hashlib.sha256(wav).hexdigest()
        self.assertEqual(self.post('/clip', {'sha256': sha256, 'start': 1, 'end': 2}),
                         (404, {'error': 'The server has no audio of this file. Generate subtitles with WhisperX first.'}))
        self.wait_done(self.upload(wav, 'tone.wav')[1]['id'])
        self.assertEqual([p.name for p in media.AUDIO.iterdir()], [f'{sha256}.mka'], 'the job keeps the audio of the upload')
        request = urllib.request.Request(f'http://127.0.0.1:{self.port}/clip', method='POST', headers={'Content-Type': 'application/json'},
                                         data=json.dumps({'sha256': sha256, 'start': 1.5, 'end': 3}).encode())
        with urllib.request.urlopen(request) as response:
            mp3 = response.read()
            self.assertEqual(response.headers['Content-Type'], 'audio/mpeg')
        path = media.AUDIO / 'clip.mp3'
        path.write_bytes(mp3)
        probe = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=format_name,duration', '-of', 'json', str(path)],
                               check=True, capture_output=True).stdout
        found = json.loads(probe)['format']
        self.assertEqual(found['format_name'], 'mp3')
        self.assertAlmostEqual(float(found['duration']), 1.5, delta=0.1)
        for body in ({'sha256': sha256, 'start': 2, 'end': 1}, {'sha256': sha256, 'start': 0, 'end': 61}, {'sha256': sha256, 'start': True, 'end': 2}):
            self.assertEqual(self.post('/clip', body)[0], 400, body)

    def test_clip_of_a_url_downloads_the_audio_in_the_background_and_answers_404_until_then(self):
        started = []
        saved, media.start_download = media.start_download, lambda url, key: started.append((url, key))
        try:
            url = 'https://videos.example/ep/1'
            self.assertEqual(self.post('/clip', {'url': url, 'start': 1, 'end': 2}),
                             (404, {'error': 'The server is downloading the audio of this video. Until then, the tab records the line.'}))
        finally:
            media.start_download = saved
        self.assertEqual(started, [(url, hashlib.sha256(url.encode()).hexdigest())])

    def test_captions_without_subtitles_expire_after_a_day(self):
        calls = []
        def fake_fetch(url, key, lang):
            calls.append(lang)
            return None
        saved, media.fetch_captions = media.fetch_captions, fake_fetch
        try:
            body = {'url': 'https://youtu.be/KfQPZZ5JmXw', 'lang': 'ja'}
            self.assertEqual(self.post('/captions', body)[0], 404)
            self.assertEqual(self.post('/captions', body)[0], 404)
            path = whisper_server.CACHE / 'KfQPZZ5JmXw.captions.ja.v2.json'
            day_ago = time.time() - 24 * 3600 - 60
            os.utime(path, (day_ago, day_ago))
            self.assertEqual(self.post('/captions', body)[0], 404)
        finally:
            media.fetch_captions = saved
        self.assertEqual(calls, ['ja', 'ja'], 'the second request uses the cache, the third finds it too old')

    def test_receive_streams_in_chunks_and_rejects_a_short_body(self):
        data = b'v' * (whisper_server.CHUNK * 2 + 5)
        stream = Reader(data)
        path, sha256 = receive(stream, len(data), 'clip.mkv')
        self.assertEqual((path.suffix, path.read_bytes(), sha256), ('.mkv', data, hashlib.sha256(data).hexdigest()))
        self.assertEqual(stream.reads, [whisper_server.CHUNK, whisper_server.CHUNK, 5])
        with self.assertRaisesRegex(ValueError, 'ended before Content-Length'):
            receive(io.BytesIO(b'short'), 10, 'clip.mkv')
        self.assertEqual(list(whisper_server.UPLOADS.iterdir()), [path], 'a short upload leaves no file')


class Failure(unittest.TestCase):
    def test_a_failed_program_has_its_name_also_when_its_file_has_another_name(self):
        programs = {'YT_DLP': r'C:\env\Scripts\yt-dlp.exe', 'FFMPEG': r'C:\env\Lib\site-packages\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-v7.1.exe'}
        with mock.patch.multiple(media, **programs):
            yt_dlp = subprocess.CalledProcessError(1, [programs['YT_DLP'], '--quiet', '-J', '--', 'https://youtu.be/KfQPZZ5JmXw'],
                                                   stderr='ERROR: [youtube] KfQPZZ5JmXw: Video unavailable\n')
            ffmpeg = subprocess.CalledProcessError(1, [programs['FFMPEG'], '-i', 'a.mka'], stderr=b'a.mka: Invalid data found when processing input\n')
            self.assertEqual([whisper_server.failure(yt_dlp), whisper_server.failure(ffmpeg)],
                             ['yt-dlp failed: ERROR: [youtube] KfQPZZ5JmXw: Video unavailable',
                              'ffmpeg failed: a.mka: Invalid data found when processing input'])


class Start(unittest.TestCase):
    def test_main_exits_with_a_clear_message_when_the_port_is_in_use(self):
        with socket.socket() as taken:
            taken.bind(('127.0.0.1', 0))
            taken.listen()
            port = taken.getsockname()[1]
            with mock.patch.object(whisper_server, 'PORT', port), self.assertRaises(SystemExit) as caught:
                whisper_server.main([])
        self.assertEqual(caught.exception.code, f'Port {port} is in use: the WhisperX server already runs, or another program uses the port.')

    def test_every_line_of_the_windows_batch_files_ends_with_crlf_for_cmd_exe(self):
        root = Path(__file__).parents[1]
        for batch in (root / 'Start WhisperX server.cmd', root / 'server' / 'start-from-chrome.cmd'):
            self.assertEqual({line[-2:] for line in batch.read_bytes().splitlines(keepends=True)}, {b'\r\n'}, batch.name)


if __name__ == '__main__':
    unittest.main()
