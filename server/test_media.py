"""Run: python3 -I -B -m unittest discover -s server -v."""

import os
import re
import subprocess
import sys
import sysconfig
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

import media


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


if __name__ == '__main__':
    unittest.main()
