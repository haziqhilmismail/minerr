Download the WhisperX add-on of Minerr here. Minerr itself comes from the Chrome Web Store. See [Get Minerr](#get-minerr).

## What the WhisperX add-on does

The add-on makes Japanese subtitles for videos that have none. It transcribes the audio with [WhisperX](https://github.com/m-bain/whisperX), in a small server on your computer. Minerr shows the subtitles in its overlay, and you mine the words as usual.

The add-on is free. It uses the CPU, so it does not need a GPU. It needs about 4 GB of free memory.

## Install the add-on

1. Download `minerr-whisperx-v<version>.zip` from the assets of this release.
2. Unzip it. The zip has one folder, `minerr-whisperx`.
3. Put the folder in a place where it can stay, for example your user folder.
4. Do the steps for your computer.

If you loaded Minerr from `minerr-v<version>.zip` or from the source code, you do not need this zip. Your `minerr` folder already holds the add-on. Use that folder in the steps.

### Windows (recommended)

These steps are for Windows on an x64 processor. You do not need WSL.

1. In the `minerr-whisperx` folder, double-click `Start WhisperX server (Windows).cmd`. A window opens.
2. If the window asks to download uv, press Y. uv is a free program that installs Python and the packages of the server. The download is 15 MB.
3. Wait until the window shows `Minerr WhisperX server on http://127.0.0.1:8766`. The first start downloads about 3.7 GB.

### Windows with WSL

Use these steps on Windows on ARM, or if you want the server in WSL.

1. In WSL, install [uv](https://docs.astral.sh/uv/getting-started/installation/).
2. In the `minerr-whisperx` folder, double-click `Start WhisperX server (WSL).cmd`. A window opens.
3. Wait until the window shows `Minerr WhisperX server on http://127.0.0.1:8766`. The first start downloads about 2.6 GB.

### Linux

These steps are for Linux on x64 or ARM64.

1. Install [uv](https://docs.astral.sh/uv/getting-started/installation/).
2. Open a terminal in the `minerr-whisperx` folder.
3. Run `uv run server/whisper_server.py`.
4. Wait until the terminal shows `Minerr WhisperX server on http://127.0.0.1:8766`. The first start downloads about 2.6 GB.

### macOS on Apple silicon

Do the steps for Linux. This platform is not tested. The add-on does not work on a Mac with an Intel processor, because PyTorch 2.8 has no package for it.

## Make your first subtitles

1. Open a YouTube video in Chrome.
2. Click the Minerr button in the toolbar.
3. Click **Generate with WhisperX**.

The first job downloads the speech model, about 1.6 GB. On Windows, the first job can also wait about 5 minutes before the transcription starts. These waits occur one time only.

## Start the server later

The server runs only while its window or terminal is open. To stop the server, close the window or the terminal.

- On Windows, click the Minerr button in the toolbar, then click **Start the server**. The button works after the first double-click of a launcher. You can also double-click the launcher again.
- On Linux and macOS, run `uv run server/whisper_server.py` in the `minerr-whisperx` folder again.

If you move the `minerr-whisperx` folder on Windows, double-click the launcher in the new place one time. To update the add-on, download and unzip the new zip. Then start the server in the new folder one time, as the steps above show.

## Get Minerr

Install Minerr from the Chrome Web Store: `https://chromewebstore.google.com/detail/<item id>`

<!-- TODO(owner): After the first upload, replace <item id> with the item ID from the Developer Dashboard, and make the address a link. Do the same in README.md (docs/chrome-web-store.md, step 3). -->

You can also load Minerr unpacked:

1. Download `minerr-v<version>.zip` from the assets of this release, and unzip it. The zip has one folder, `minerr`.
2. Put the `minerr` folder in a place where it can stay. Chrome gives the extension an ID from the folder path. If you move the folder later, Minerr starts again with no data.
3. Open `chrome://extensions`, and turn on **Developer mode**.
4. Click **Load unpacked**, and select the `minerr` folder.
5. Import a dictionary, and install AnkiConnect. See [Install](https://github.com/haziqhilmismail/minerr#install) in the README.

To update an unpacked Minerr, replace the files in the same `minerr` folder. Then click the reload button on the Minerr card in `chrome://extensions`.

`minerr-v<version>.zip` works on Windows, Linux, and macOS, on x64 and on ARM, because the extension has no native code.

## Check the download

Each zip has a `.sha256` file with its SHA-256. On Linux, WSL, or macOS, put the zip and its `.sha256` file in one folder, and run `sha256sum -c` with the name of the `.sha256` file. On macOS, use `shasum -a 256 -c`. On Windows, run `certutil -hashfile minerr-whisperx-v<version>.zip SHA256` with the name of your zip. Then compare the result with the text of the `.sha256` file.

## Third-party data

`vendor/kuromoji` in `minerr-v<version>.zip` contains kuromoji.js and its dictionary, built from mecab-ipadic, with their license and notice. Minerr does not include a dictionary for definitions. JMdict has its own [license](https://www.edrdg.org/edrdg/licence.html).
