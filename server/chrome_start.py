import hashlib
import json
import os
import subprocess
from pathlib import Path

HOST = 'com.minerr.whisperx'
REGISTRY_KEY = rf'HKCU\Software\Google\Chrome\NativeMessagingHosts\{HOST}'


def extension_id(windows_path):
    """The id of the unpacked extension at windows_path: Chrome hashes the UTF-16 path, with an upper-case drive letter,
    and writes the first 128 bits of the SHA-256 with the letters a to p. The hash takes the exact spelling of the path
    that Chrome loaded: a junction, another letter case, or a moved folder gives another id, and Chrome refuses the host."""
    if len(windows_path) > 1 and windows_path[1] == ':':
        windows_path = windows_path[0].upper() + windows_path[1:]
    digest = hashlib.sha256(windows_path.encode('utf-16-le')).hexdigest()[:32]
    return ''.join(chr(ord('a') + int(digit, 16)) for digit in digest)


def windows_path(path):
    return subprocess.run(['wslpath', '-w', str(path)], check=True, capture_output=True, text=True).stdout.strip()


def host_manifest(extension, host_path):
    return {'name': HOST, 'description': 'Starts the Minerr WhisperX server.', 'path': host_path, 'type': 'stdio',
            'allowed_origins': [f'chrome-extension://{extension}/']}


def register(extension_folder, local_app_data):
    manifest = Path(local_app_data) / 'Minerr' / f'{HOST}.json'
    manifest.parent.mkdir(parents=True, exist_ok=True)
    extension = extension_id(windows_path(extension_folder))
    host = windows_path(Path(extension_folder) / 'server' / 'start-from-chrome.cmd')
    manifest.write_text(json.dumps(host_manifest(extension, host), indent=2) + '\n')
    manifest_path = windows_path(manifest)
    subprocess.run(['reg.exe', 'add', REGISTRY_KEY, '/ve', '/d', manifest_path, '/f'], check=True, capture_output=True)
    return extension, manifest_path


def main():
    double_click = 'Start the server with a double-click of "Start WhisperX server.cmd".'
    local_app_data = os.environ.get('LOCALAPPDATA')
    if not local_app_data:
        print(f'Minerr could not set up the Start button of the popup, because WSL did not get LOCALAPPDATA from Windows. {double_click}', flush=True)
        return
    try:
        extension, manifest_path = register(Path(__file__).resolve().parent.parent, local_app_data)
    except (OSError, subprocess.CalledProcessError) as error:
        print(f'Minerr could not set up the Start button of the popup. {double_click} The error: {error}', flush=True)
        return
    print(f'The Start button of the Minerr popup is ready for the extension {extension}: {REGISTRY_KEY} -> {manifest_path}', flush=True)


if __name__ == '__main__':
    main()
