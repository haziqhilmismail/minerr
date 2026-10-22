import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path, PureWindowsPath

HOST = 'com.minerr.whisperx'
REGISTRY_KEY = rf'HKCU\Software\Google\Chrome\NativeMessagingHosts\{HOST}'
# The item ID of Minerr in the Chrome Web Store. Fill it in after the first upload (docs/chrome-web-store.md), then release the add-on.
STORE_EXTENSION_ID = ''
# Python of Windows runs this file for the native launcher, Python of WSL for the WSL launcher.
NATIVE = sys.platform == 'win32'


def launcher():
    """The file names of the launcher that runs this file and of its host in server/. Each launcher registers its own host, so
    the Start button starts the launcher of the last double-click."""
    if NATIVE:
        return 'Start WhisperX server (Windows).cmd', 'start-from-chrome-windows.cmd'
    return 'Start WhisperX server (WSL).cmd', 'start-from-chrome.cmd'


def extension_id(windows_path):
    """Chrome's id for an unpacked extension (GenerateIdForPath in Chromium components/crx_file/id_util.cc). Chrome hashes
    the exact path that it loaded, so a junction, another letter case in a folder name, or a moved folder gives another
    id, and then Chrome refuses the host."""
    if len(windows_path) > 1 and windows_path[1] == ':':
        windows_path = windows_path[0].upper() + windows_path[1:]
    digest = hashlib.sha256(windows_path.encode('utf-16-le')).hexdigest()[:32]
    return ''.join(chr(ord('a') + int(digit, 16)) for digit in digest)


def windows_path(path):
    if NATIVE:
        return str(path)
    return subprocess.run(['wslpath', '-w', str(path)], check=True, capture_output=True, text=True).stdout.strip()


def host_manifest(extensions, host_path):
    return {'name': HOST, 'description': 'Starts the Minerr WhisperX server.', 'path': host_path, 'type': 'stdio',
            'allowed_origins': [f'chrome-extension://{extension}/' for extension in extensions]}


def register(extension_folder, local_app_data):
    """Lets Minerr from the Chrome Web Store start the host, and the unpacked extension in this folder if it has one: the folder of
    the add-on zip has no manifest.json. With no id to allow, it registers nothing and returns no manifest path."""
    folder = windows_path(extension_folder)
    extensions = [STORE_EXTENSION_ID] if STORE_EXTENSION_ID else []
    if (Path(extension_folder) / 'manifest.json').is_file():
        extensions.append(extension_id(folder))
    if not extensions:
        return extensions, None
    manifest = Path(local_app_data) / 'Minerr' / f'{HOST}.json'
    manifest.parent.mkdir(parents=True, exist_ok=True)
    _, host_file = launcher()
    host = str(PureWindowsPath(folder, 'server', host_file))
    manifest.write_text(json.dumps(host_manifest(extensions, host), indent=2) + '\n')
    manifest_path = windows_path(manifest)
    subprocess.run(['reg.exe', 'add', REGISTRY_KEY, '/ve', '/d', manifest_path, '/f'], check=True, capture_output=True)
    return extensions, manifest_path


def main():
    name, _ = launcher()
    double_click = f'Start the server with a double-click of "{name}".'
    local_app_data = os.environ.get('LOCALAPPDATA')
    if not local_app_data:
        print(f'Minerr could not set up the Start button of the popup, because WSL did not get LOCALAPPDATA from Windows. {double_click}', flush=True)
        return
    try:
        extensions, manifest_path = register(Path(__file__).resolve().parent.parent, local_app_data)
    except (OSError, subprocess.CalledProcessError) as error:
        print(f'Minerr could not set up the Start button of the popup. {double_click} The error: {error}', flush=True)
        return
    if not extensions:
        print('Minerr could not set up the Start button of the popup, because this folder has no extension and STORE_EXTENSION_ID in '
              f'chrome_start.py is empty. {double_click}', flush=True)
        return
    ready = ' and '.join(f'the extension {extension}' for extension in extensions)
    print(f'The Start button of the Minerr popup is ready for {ready}: {REGISTRY_KEY} -> {manifest_path}', flush=True)


if __name__ == '__main__':
    main()
