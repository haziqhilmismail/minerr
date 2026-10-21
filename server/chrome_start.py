"""Registers the Chrome native messaging host that starts the WhisperX server from the Minerr popup on Windows.

Start WhisperX server.cmd runs this script in WSL before the server. The script writes the host manifest to
%LOCALAPPDATA%\\Minerr\\com.minerr.whisperx.json and points the registry value
HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.minerr.whisperx at it. The host is server/start-from-chrome.cmd.
The manifest allows one extension: the id that Chrome gives the unpacked extension in this folder.
"""

import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

HOST = 'com.minerr.whisperx'
REGISTRY_KEY = rf'HKCU\Software\Google\Chrome\NativeMessagingHosts\{HOST}'


def extension_id(windows_path):
    """The id of the unpacked extension at windows_path: Chrome hashes the UTF-16 path, with an upper-case drive letter,
    and writes the first 128 bits of the SHA-256 with the letters a to p."""
    if len(windows_path) > 1 and windows_path[1] == ':':
        windows_path = windows_path[0].upper() + windows_path[1:]
    digest = hashlib.sha256(windows_path.encode('utf-16-le')).hexdigest()[:32]
    return ''.join(chr(ord('a') + int(digit, 16)) for digit in digest)


def windows_path(path):
    return subprocess.run(['wslpath', '-w', str(path)], check=True, capture_output=True, text=True).stdout.strip()


def host_manifest(extension_folder, host_path):
    return {'name': HOST, 'description': 'Starts the Minerr WhisperX server.', 'path': host_path, 'type': 'stdio',
            'allowed_origins': [f'chrome-extension://{extension_id(extension_folder)}/']}


def register(extension_folder, local_app_data):
    """Writes the manifest for the extension in extension_folder and the registry value. Returns the Windows path of the manifest."""
    manifest = Path(local_app_data) / 'Minerr' / f'{HOST}.json'
    manifest.parent.mkdir(parents=True, exist_ok=True)
    host = windows_path(Path(extension_folder) / 'server' / 'start-from-chrome.cmd')
    manifest.write_text(json.dumps(host_manifest(windows_path(extension_folder), host), indent=2) + '\n')
    manifest_path = windows_path(manifest)
    subprocess.run(['reg.exe', 'add', REGISTRY_KEY, '/ve', '/d', manifest_path, '/f'], check=True, capture_output=True)
    return manifest_path


def main():
    try:
        manifest_path = register(Path(__file__).resolve().parent.parent, os.environ['LOCALAPPDATA'])
    except (OSError, KeyError, subprocess.CalledProcessError) as error:
        print(f'Minerr could not set up the Start button of the popup: {error}. Start the server with this file instead.', flush=True)
        return
    print(f'The Start button of the Minerr popup is ready: {REGISTRY_KEY} -> {manifest_path}', flush=True)


if __name__ == '__main__':
    sys.exit(main())
