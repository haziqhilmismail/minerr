"""Run: python3 -I -B -m unittest discover -s server -v."""

import re
import subprocess
import tempfile
import unittest
from pathlib import Path

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


if __name__ == '__main__':
    unittest.main()
