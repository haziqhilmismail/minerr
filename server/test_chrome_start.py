"""Run: python3 -I -B -m unittest discover -s server -v (needs no WSL: wslpath and reg.exe are mocked)."""

import contextlib
import io
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import chrome_start
from chrome_start import extension_id, register

EXTENSION = '/mnt/c/Users/haziq/minerr'
MANIFEST = r'C:\Users\haziq\AppData\Local\Minerr\com.minerr.whisperx.json'
REG_ADD = ['reg.exe', 'add', r'HKCU\Software\Google\Chrome\NativeMessagingHosts\com.minerr.whisperx', '/ve', '/d', MANIFEST, '/f']


class ExtensionId(unittest.TestCase):
    def test_is_the_id_that_chrome_gives_the_unpacked_folder_with_any_case_of_the_drive_letter(self):
        self.assertEqual(extension_id(r'C:\Users\haziq\minerr'), 'lfmbihboldmlhbolbfdfdpdcnajbmkbo')
        self.assertEqual(extension_id(r'c:\Users\haziq\minerr'), 'lfmbihboldmlhbolbfdfdpdcnajbmkbo')


class Register(unittest.TestCase):
    """The fake wslpath maps the temp folder to the LOCALAPPDATA of the user, so the expected values are literal Windows paths."""

    def setUp(self):
        self.local = tempfile.mkdtemp()
        self.addCleanup(__import__('shutil').rmtree, self.local)
        self.commands = []
        self.reg_error = None
        windows = {self.local: r'C:\Users\haziq\AppData\Local', EXTENSION: r'C:\Users\haziq\minerr'}

        def run(args, check, capture_output, text=False):
            self.commands.append(args)
            if args[0] == 'reg.exe':
                if self.reg_error:
                    raise self.reg_error
                return subprocess.CompletedProcess(args, 0, '', '')
            root = next(root for root in windows if args[2].startswith(root))
            return subprocess.CompletedProcess(args, 0, windows[root] + args[2][len(root):].replace('/', '\\') + '\n', '')
        mock.patch.object(chrome_start.subprocess, 'run', run).start()
        mock.patch.object(chrome_start, '__file__', f'{EXTENSION}/server/chrome_start.py').start()
        self.addCleanup(mock.patch.stopall)

    def test_writes_the_manifest_for_this_extension_and_points_the_registry_value_at_it(self):
        self.assertEqual(register(EXTENSION, self.local), MANIFEST)
        self.assertEqual(json.loads(Path(self.local, 'Minerr', 'com.minerr.whisperx.json').read_text()), {
            'name': 'com.minerr.whisperx',
            'description': 'Starts the Minerr WhisperX server.',
            'path': r'C:\Users\haziq\minerr\server\start-from-chrome.cmd',
            'type': 'stdio',
            'allowed_origins': ['chrome-extension://lfmbihboldmlhbolbfdfdpdcnajbmkbo/'],
        })
        self.assertEqual(self.commands[-1], REG_ADD)

    def main_output(self, environ):
        with mock.patch.dict(os.environ, environ, clear=True), contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertIsNone(chrome_start.main())
        return out.getvalue()

    def test_main_prints_one_line_on_success_and_one_on_failure(self):
        self.assertEqual(self.main_output({'LOCALAPPDATA': self.local}),
                         f'The Start button of the Minerr popup is ready: HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.minerr.whisperx -> {MANIFEST}\n')
        self.reg_error = subprocess.CalledProcessError(1, REG_ADD)
        self.assertEqual(self.main_output({'LOCALAPPDATA': self.local}),
                         f"Minerr could not set up the Start button of the popup: Command '{REG_ADD}' returned non-zero exit status 1.. "
                         'Start the server with this file instead.\n')
        self.assertEqual(self.main_output({}), "Minerr could not set up the Start button of the popup: 'LOCALAPPDATA'. Start the server with this file instead.\n")


if __name__ == '__main__':
    unittest.main()
