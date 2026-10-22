"""Run: python3 -I -B -m unittest discover -s server -v (needs no WSL and no Windows: wslpath and reg.exe are mocked)."""

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

MANIFEST = r'C:\Users\haziq\AppData\Local\Minerr\com.minerr.whisperx.json'
STORE = 'abcdefghijklmnopabcdefghijklmnop'
REG_ADD = ['reg.exe', 'add', r'HKCU\Software\Google\Chrome\NativeMessagingHosts\com.minerr.whisperx', '/ve', '/d', MANIFEST, '/f']


class ExtensionId(unittest.TestCase):
    def test_is_the_id_that_chrome_gives_the_unpacked_folder_with_any_case_of_the_drive_letter(self):
        self.assertEqual(extension_id(r'C:\Users\haziq\minerr'), 'lfmbihboldmlhbolbfdfdpdcnajbmkbo')
        self.assertEqual(extension_id(r'c:\Users\haziq\minerr'), 'lfmbihboldmlhbolbfdfdpdcnajbmkbo')


class Register(unittest.TestCase):
    """WSL runs chrome_start.py in the folder of the add-on, or in the folder of the unpacked extension, which has manifest.json."""

    def setUp(self):
        local, extension = tempfile.TemporaryDirectory(), tempfile.TemporaryDirectory()
        self.addCleanup(local.cleanup)
        self.addCleanup(extension.cleanup)
        self.local = local.name
        self.extension = str(Path(extension.name).resolve())
        self.commands = []
        self.reg_error = None
        windows_paths = {self.local: r'C:\Users\haziq\AppData\Local', self.extension: r'C:\Users\haziq\minerr'}

        def run(args, check, capture_output, text=False):
            self.commands.append(args)
            if args[0] == 'reg.exe':
                if self.reg_error:
                    raise self.reg_error
                return subprocess.CompletedProcess(args, 0, '', '')
            root = next(root for root in windows_paths if args[2].startswith(root))
            return subprocess.CompletedProcess(args, 0, windows_paths[root] + args[2][len(root):].replace('/', '\\') + '\n', '')
        mock.patch.object(chrome_start.subprocess, 'run', run).start()
        mock.patch.object(chrome_start, '__file__', f'{self.extension}/server/chrome_start.py').start()
        mock.patch.object(chrome_start, 'NATIVE', False).start()
        self.addCleanup(mock.patch.stopall)

    def unpacked(self):
        Path(self.extension, 'manifest.json').write_text('{}')

    def allowed(self):
        return json.loads(Path(self.local, 'Minerr', 'com.minerr.whisperx.json').read_text())['allowed_origins']

    def test_writes_the_manifest_for_this_extension_and_points_the_registry_value_at_it(self):
        self.unpacked()
        self.assertEqual(register(self.extension, self.local), (['lfmbihboldmlhbolbfdfdpdcnajbmkbo'], MANIFEST))
        self.assertEqual(json.loads(Path(self.local, 'Minerr', 'com.minerr.whisperx.json').read_text()), {
            'name': 'com.minerr.whisperx',
            'description': 'Starts the Minerr WhisperX server.',
            'path': r'C:\Users\haziq\minerr\server\start-from-chrome.cmd',
            'type': 'stdio',
            'allowed_origins': ['chrome-extension://lfmbihboldmlhbolbfdfdpdcnajbmkbo/'],
        })
        self.assertEqual(self.commands[-1], REG_ADD)

    def test_allows_the_store_id_and_the_unpacked_extension_only_in_a_folder_with_manifest_json(self):
        with mock.patch.object(chrome_start, 'STORE_EXTENSION_ID', STORE):
            self.assertEqual(register(self.extension, self.local), (['abcdefghijklmnopabcdefghijklmnop'], MANIFEST))
            self.assertEqual(self.allowed(), ['chrome-extension://abcdefghijklmnopabcdefghijklmnop/'])
            self.unpacked()
            self.assertEqual(register(self.extension, self.local), (['abcdefghijklmnopabcdefghijklmnop', 'lfmbihboldmlhbolbfdfdpdcnajbmkbo'], MANIFEST))
            self.assertEqual(self.allowed(), ['chrome-extension://abcdefghijklmnopabcdefghijklmnop/', 'chrome-extension://lfmbihboldmlhbolbfdfdpdcnajbmkbo/'])

    def test_registers_nothing_without_a_store_id_in_the_folder_of_the_add_on(self):
        self.assertEqual(self.main_output({'LOCALAPPDATA': self.local}),
                         'Minerr could not set up the Start button of the popup, because this folder has no extension and STORE_EXTENSION_ID in '
                         'chrome_start.py is empty. Start the server with a double-click of "Start WhisperX server (WSL).cmd".\n')
        self.assertNotIn('reg.exe', [command[0] for command in self.commands])
        self.assertFalse(Path(self.local, 'Minerr').exists(), 'no manifest')

    def main_output(self, environ):
        with mock.patch.dict(os.environ, environ, clear=True), contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertIsNone(chrome_start.main())
        return out.getvalue()

    def test_main_prints_one_line_with_the_id_on_success_and_one_line_with_the_double_click_on_failure(self):
        self.unpacked()
        self.assertEqual(self.main_output({'LOCALAPPDATA': self.local}),
                         'The Start button of the Minerr popup is ready for the extension lfmbihboldmlhbolbfdfdpdcnajbmkbo: '
                         f'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.minerr.whisperx -> {MANIFEST}\n')
        with mock.patch.object(chrome_start, 'STORE_EXTENSION_ID', STORE):
            self.assertEqual(self.main_output({'LOCALAPPDATA': self.local}),
                             'The Start button of the Minerr popup is ready for the extension abcdefghijklmnopabcdefghijklmnop and the extension '
                             f'lfmbihboldmlhbolbfdfdpdcnajbmkbo: HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.minerr.whisperx -> {MANIFEST}\n')
        self.reg_error = subprocess.CalledProcessError(1, REG_ADD)
        self.assertEqual(self.main_output({'LOCALAPPDATA': self.local}),
                         'Minerr could not set up the Start button of the popup. Start the server with a double-click of "Start WhisperX server (WSL).cmd". '
                         f"The error: Command '{REG_ADD}' returned non-zero exit status 1.\n")
        self.assertEqual(self.main_output({}), 'Minerr could not set up the Start button of the popup, because WSL did not get LOCALAPPDATA '
                         'from Windows. Start the server with a double-click of "Start WhisperX server (WSL).cmd".\n')


class RegisterNative(unittest.TestCase):
    """Python of Windows runs chrome_start.py for the native launcher. The paths are Windows paths already. The folder has no
    manifest.json on Linux, so only the store id is allowed."""

    def setUp(self):
        local = tempfile.TemporaryDirectory()
        self.addCleanup(local.cleanup)
        self.local = local.name
        self.manifest = str(Path(self.local, 'Minerr', 'com.minerr.whisperx.json'))
        self.reg_add = ['reg.exe', 'add', r'HKCU\Software\Google\Chrome\NativeMessagingHosts\com.minerr.whisperx', '/ve', '/d', self.manifest, '/f']
        self.commands = []
        self.reg_error = None
        def run(args, check, capture_output, text=False):
            self.commands.append(args)
            if self.reg_error:
                raise self.reg_error
            return subprocess.CompletedProcess(args, 0, '', '')
        mock.patch.object(chrome_start.subprocess, 'run', run).start()
        mock.patch.object(chrome_start, 'NATIVE', True).start()
        mock.patch.object(chrome_start, 'STORE_EXTENSION_ID', STORE).start()
        self.addCleanup(mock.patch.stopall)

    def test_registers_the_host_of_the_native_launcher_with_the_paths_as_they_are(self):
        self.assertEqual(register(r'C:\Users\haziq\minerr', self.local), (['abcdefghijklmnopabcdefghijklmnop'], self.manifest))
        self.assertEqual(json.loads(Path(self.manifest).read_text())['path'], r'C:\Users\haziq\minerr\server\start-from-chrome-windows.cmd')
        self.assertEqual(self.commands, [self.reg_add], 'no wslpath')

    def test_main_names_the_native_launcher(self):
        self.reg_error = subprocess.CalledProcessError(1, self.reg_add)
        with mock.patch.dict(os.environ, {'LOCALAPPDATA': self.local}, clear=True), contextlib.redirect_stdout(io.StringIO()) as out:
            chrome_start.main()
        self.assertEqual(out.getvalue(), 'Minerr could not set up the Start button of the popup. Start the server with a double-click of '
                         f'"Start WhisperX server (Windows).cmd". The error: Command \'{self.reg_add}\' returned non-zero exit status 1.\n')


class Hosts(unittest.TestCase):
    def test_the_host_of_each_launcher_starts_that_launcher(self):
        root = Path(__file__).parents[1]
        for native in (True, False):
            with mock.patch.object(chrome_start, 'NATIVE', native):
                name, host = chrome_start.launcher()
            self.assertTrue((root / name).is_file(), name)
            self.assertIn(f'cmd /c ""{name}""', (root / 'server' / host).read_text(), host)


if __name__ == '__main__':
    unittest.main()
