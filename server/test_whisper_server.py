"""Run: python3 -I -B -m unittest discover -s server -v (needs no WhisperX install)."""

import hashlib
import io
import json
import subprocess
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

import whisper_server
from whisper_server import Jobs, handler, media_key, pick_track, receive, split_segment, subtitle_segments, video_id


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
        self.assertEqual(pick_track({'automatic_captions': {'ja': auto['ja']}}, 'ja'), ('auto-json3', 'json3'))
        self.assertIsNone(pick_track({'subtitles': {'ja': [{'ext': 'ass', 'url': 'x'}]}}, 'ja'))


class FetchCaptions(unittest.TestCase):
    def test_reads_the_info_of_yt_dlp_then_downloads_the_track(self):
        calls = []
        def fake_yt_dlp(*args, timeout):
            calls.append(args)
            return json.dumps({'subtitles': {'ja': [{'ext': 'vtt', 'url': 'data:text/vtt;charset=utf-8,WEBVTT%0A%0A00:01.000 --> 00:02.000%0A%E7%8C%AB'}]}})
        saved, whisper_server.yt_dlp = whisper_server.yt_dlp, fake_yt_dlp
        try:
            found = whisper_server.fetch_captions('https://youtu.be/KfQPZZ5JmXw', 'KfQPZZ5JmXw', 'ja')
            none = whisper_server.fetch_captions('https://youtu.be/KfQPZZ5JmXw', 'KfQPZZ5JmXw', 'en')
        finally:
            whisper_server.yt_dlp = saved
        self.assertEqual(found, {'ext': 'vtt', 'text': 'WEBVTT\n\n00:01.000 --> 00:02.000\n猫'})
        self.assertIsNone(none)
        self.assertEqual(calls[0], ('-J', '--', 'https://www.youtube.com/watch?v=KfQPZZ5JmXw'))


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
        self.saved = whisper_server.CACHE, whisper_server.UPLOADS, whisper_server.AUDIO
        whisper_server.CACHE, whisper_server.UPLOADS, whisper_server.AUDIO = folder / 'subs', folder / 'uploads', folder / 'audio'
        self.transcribe = FakeTranscriber()
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), None)
        self.port = self.server.server_address[1]
        self.server.RequestHandlerClass = handler(Jobs(self.transcribe), {'ok': True}, self.port)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        whisper_server.CACHE, whisper_server.UPLOADS, whisper_server.AUDIO = self.saved

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
            whisper_server.AUDIO.mkdir(parents=True, exist_ok=True)
            path = whisper_server.AUDIO / f'{key}.webm'
            path.write_bytes(key.encode())
            return path
        saved, whisper_server.download_audio = whisper_server.download_audio, fake_download
        try:
            status, reply = self.request('POST', '/jobs', json.dumps({'url': 'https://youtu.be/KfQPZZ5JmXw'}).encode(),
                                         {'Content-Type': 'application/json'})
            self.assertEqual(status, 200)
            self.assertEqual(self.wait_done(reply['id'])[1]['state'], 'done')
        finally:
            whisper_server.download_audio = saved
        self.assertEqual(self.transcribe.files, [('.webm', b'KfQPZZ5JmXw')])
        self.assertEqual(self.request('GET', '/subs/KfQPZZ5JmXw'), (200, [{'start': 0.0, 'end': 1.5, 'text': '猫が魚を食べた。'}]))

    def post(self, path, body):
        return self.request('POST', path, json.dumps(body).encode(), {'Content-Type': 'application/json'})

    def test_captions_come_from_yt_dlp_once_and_a_video_without_them_is_404(self):
        calls = []
        def fake_fetch(url, key, lang):
            calls.append((url, key, lang))
            return {'ext': 'vtt', 'text': 'WEBVTT'} if lang == 'ja' else None
        saved, whisper_server.fetch_captions = whisper_server.fetch_captions, fake_fetch
        try:
            url = 'https://www.youtube.com/watch?v=KfQPZZ5JmXw&t=3'
            self.assertEqual(self.post('/captions', {'url': url, 'lang': 'ja'}), (200, {'ext': 'vtt', 'text': 'WEBVTT'}))
            self.assertEqual(self.post('/captions', {'url': url, 'lang': 'ja'}), (200, {'ext': 'vtt', 'text': 'WEBVTT'}))
            self.assertEqual(self.post('/captions', {'url': url, 'lang': 'en'}), (404, {'error': 'The video has no en subtitles.'}))
            self.assertEqual(self.post('/captions', {'url': url, 'lang': 'en'})[0], 404)
            self.assertEqual(self.post('/captions', {'url': url, 'lang': '../x'}), (400, {'error': 'Send a language code such as ja.'}))
            self.assertEqual(self.post('/captions', {'url': 'file:///etc/passwd', 'lang': 'ja'}), (400, {'error': 'Use an http or https URL.'}))
        finally:
            whisper_server.fetch_captions = saved
        self.assertEqual(calls, [(url, 'KfQPZZ5JmXw', 'ja'), (url, 'KfQPZZ5JmXw', 'en')], 'each language runs yt-dlp one time')

    def test_clip_cuts_mp3_from_the_audio_of_an_uploaded_file(self):
        wav = subprocess.run(['ffmpeg', '-nostdin', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-f', 'wav', 'pipe:1'],
                             check=True, capture_output=True).stdout
        sha256 = hashlib.sha256(wav).hexdigest()
        self.assertEqual(self.post('/clip', {'sha256': sha256, 'start': 1, 'end': 2}),
                         (404, {'error': 'The server has no audio of this file. Generate subtitles with WhisperX first.'}))
        self.wait_done(self.upload(wav, 'tone.wav')[1]['id'])
        self.assertEqual([p.name for p in whisper_server.AUDIO.iterdir()], [f'{sha256}.mka'], 'the job keeps the audio of the upload')
        request = urllib.request.Request(f'http://127.0.0.1:{self.port}/clip', method='POST', headers={'Content-Type': 'application/json'},
                                         data=json.dumps({'sha256': sha256, 'start': 1.5, 'end': 3}).encode())
        with urllib.request.urlopen(request) as response:
            mp3 = response.read()
            self.assertEqual(response.headers['Content-Type'], 'audio/mpeg')
        path = whisper_server.AUDIO / 'clip.mp3'
        path.write_bytes(mp3)
        probe = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=format_name,duration', '-of', 'json', str(path)],
                               check=True, capture_output=True).stdout
        found = json.loads(probe)['format']
        self.assertEqual(found['format_name'], 'mp3')
        self.assertAlmostEqual(float(found['duration']), 1.5, delta=0.1)
        for body in ({'sha256': sha256, 'start': 2, 'end': 1}, {'sha256': sha256, 'start': 0, 'end': 61}, {'sha256': sha256, 'start': True, 'end': 2}):
            self.assertEqual(self.post('/clip', body)[0], 400, body)

    def test_receive_streams_in_chunks_and_rejects_a_short_body(self):
        data = b'v' * (whisper_server.CHUNK * 2 + 5)
        stream = Reader(data)
        path, sha256 = receive(stream, len(data), 'clip.mkv')
        self.assertEqual((path.suffix, path.read_bytes(), sha256), ('.mkv', data, hashlib.sha256(data).hexdigest()))
        self.assertEqual(stream.reads, [whisper_server.CHUNK, whisper_server.CHUNK, 5])
        with self.assertRaisesRegex(ValueError, 'ended before Content-Length'):
            receive(io.BytesIO(b'short'), 10, 'clip.mkv')
        self.assertEqual(list(whisper_server.UPLOADS.iterdir()), [path], 'a short upload leaves no file')


if __name__ == '__main__':
    unittest.main()
