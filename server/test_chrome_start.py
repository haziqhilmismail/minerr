"""Run: python3 -I -B -m unittest discover -s server -v (needs no Windows: reg.exe is mocked)."""

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

STORE = 'abcdefghijklmnopabcdefghijklmnop'
FOLDER = r'C:\Users\haziq\minerr'


class ExtensionId(unittest.TestCase):
    def test_is_the_id_that_chrome_gives_the_unpacked_folder_with_any_case_of_the_drive_letter(self):
        self.assertEqual(extension_id(r'C:\Users\haziq\minerr'), 'lfmbihboldmlhbolbfdfdpdcnajbmkbo')
        self.assertEqual(extension_id(r'c:\Users\haziq\minerr'), 'lfmbihboldmlhbolbfdfdpdcnajbmkbo')


class Register(unittest.TestCase):
    """The Windows launcher runs chrome_start.py in the folder of the add-on, or in the folder of the unpacked extension, which has manifest.json."""

    def setUp(self):
        local = tempfile.TemporaryDirectory()
        self.addCleanup(local.cleanup)
        self.local = local.name
        self.manifest = str(Path(self.local, 'Minerr', 'com.minerr.whisperx.json'))
        self.reg_add = ['reg.exe', 'add', r'HKCU\Software\Google\Chrome\NativeMessagingHosts\com.minerr.whisperx', '/ve', '/d', self.manifest, '/f']
        self.commands = []
        self.reg_error = None
        self.unpacked = False

        def run(args, check, capture_output):
            self.commands.append(args)
            if self.reg_error:
                raise self.reg_error
            return subprocess.CompletedProcess(args, 0, '', '')
        mock.patch.object(chrome_start.subprocess, 'run', run).start()
        mock.patch.object(chrome_start.Path, 'is_file', lambda path: self.unpacked and path.name == 'manifest.json').start()
        self.addCleanup(mock.patch.stopall)

    def allowed(self):
        return json.loads(Path(self.manifest).read_text())['allowed_origins']

    def main_output(self, environ):
        with mock.patch.dict(os.environ, environ, clear=True), contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertIsNone(chrome_start.main())
        return out.getvalue()

    def test_writes_the_manifest_for_this_extension_and_points_the_registry_value_at_it(self):
        self.unpacked = True
        self.assertEqual(register(FOLDER, self.local), (['lfmbihboldmlhbolbfdfdpdcnajbmkbo'], self.manifest))
        self.assertEqual(json.loads(Path(self.manifest).read_text()), {
            'name': 'com.minerr.whisperx',
            'description': 'Starts the Minerr WhisperX server.',
            'path': r'C:\Users\haziq\minerr\server\start-from-chrome-windows.cmd',
            'type': 'stdio',
            'allowed_origins': ['chrome-extension://lfmbihboldmlhbolbfdfdpdcnajbmkbo/'],
        })
        self.assertEqual(self.commands, [self.reg_add])

    def test_allows_the_store_id_and_the_unpacked_extension_only_in_a_folder_with_manifest_json(self):
        with mock.patch.object(chrome_start, 'STORE_EXTENSION_ID', STORE):
            self.assertEqual(register(FOLDER, self.local), ([STORE], self.manifest))
            self.assertEqual(self.allowed(), [f'chrome-extension://{STORE}/'])
            self.unpacked = True
            self.assertEqual(register(FOLDER, self.local), ([STORE, 'lfmbihboldmlhbolbfdfdpdcnajbmkbo'], self.manifest))
            self.assertEqual(self.allowed(), [f'chrome-extension://{STORE}/', 'chrome-extension://lfmbihboldmlhbolbfdfdpdcnajbmkbo/'])

    def test_registers_nothing_without_a_store_id_in_the_folder_of_the_add_on(self):
        self.assertEqual(self.main_output({'LOCALAPPDATA': self.local}),
                         'Minerr could not set up the Start button of the popup, because this folder has no extension and STORE_EXTENSION_ID in '
                         'chrome_start.py is empty. Start the server with a double-click of "Start WhisperX server (Windows).cmd".\n')
        self.assertEqual(self.commands, [])
        self.assertFalse(Path(self.local, 'Minerr').exists(), 'no manifest')

    def test_main_prints_one_line_with_the_id_on_success_and_one_line_with_the_double_click_on_failure(self):
        with mock.patch.object(chrome_start, 'STORE_EXTENSION_ID', STORE):
            self.assertEqual(self.main_output({'LOCALAPPDATA': self.local}),
                             f'The Start button of the Minerr popup is ready for the extension {STORE}: '
                             f'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.minerr.whisperx -> {self.manifest}\n')
            self.unpacked = True
            self.assertEqual(self.main_output({'LOCALAPPDATA': self.local}),
                             f'The Start button of the Minerr popup is ready for the extension {STORE} and the extension '
                             f'{extension_id(str(Path(chrome_start.__file__).resolve().parents[1]))}: '
                             f'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.minerr.whisperx -> {self.manifest}\n')
            self.reg_error = subprocess.CalledProcessError(1, self.reg_add)
            self.assertEqual(self.main_output({'LOCALAPPDATA': self.local}),
                             'Minerr could not set up the Start button of the popup. Start the server with a double-click of '
                             f'"Start WhisperX server (Windows).cmd". The error: Command \'{self.reg_add}\' returned non-zero exit status 1.\n')
        self.assertEqual(self.main_output({}), 'Minerr could not set up the Start button of the popup, because LOCALAPPDATA is not set. '
                         'Start the server with a double-click of "Start WhisperX server (Windows).cmd".\n')


class Host(unittest.TestCase):
    def test_the_host_starts_the_launcher(self):
        root = Path(__file__).parents[1]
        self.assertTrue((root / chrome_start.LAUNCHER).is_file())
        self.assertIn(f'cmd /c ""{chrome_start.LAUNCHER}""', (root / 'server' / chrome_start.HOST_FILE).read_text())


if __name__ == '__main__':
    unittest.main()
