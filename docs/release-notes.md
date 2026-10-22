Minerr is a Chrome extension to read Japanese and to mine Anki cards from web pages and videos. See the [README](https://github.com/haziqhilmismail/minerr#readme) for all features.

## Install

1. Download the `.zip` file below and unzip it. It has one folder, `minerr`.
2. Put the `minerr` folder in a place where it can stay, for example your user folder. Chrome gives the extension an ID from the folder path. If you move the folder later, Minerr starts again with no data.
3. Open `chrome://extensions` and turn on **Developer mode**.
4. Click **Load unpacked**, and select the `minerr` folder.
5. Import a dictionary and install AnkiConnect. See [Install](https://github.com/haziqhilmismail/minerr#install) in the README.

The same zip works on Windows, Linux, and macOS, on x64 and on ARM. The extension has no native code.

To update, replace the files in the same `minerr` folder. Then click the reload button on the Minerr card in `chrome://extensions`.

## WhisperX server (optional)

The server makes Japanese subtitles for videos that have none. It needs [uv](https://docs.astral.sh/uv/), `yt-dlp`, and `ffmpeg`. See [Generate subtitles with WhisperX](https://github.com/haziqhilmismail/minerr#generate-subtitles-with-whisperx) in the README.

| Platform | Start the server |
| --- | --- |
| Windows, x64 or ARM | The server runs in WSL. Double-click `Start WhisperX server.cmd` in the `minerr` folder one time. After that, the Minerr toolbar popup has a **Start the server** button. |
| Linux, x64 or ARM64 | Run `uv run server/whisper_server.py` in the `minerr` folder. |
| macOS, Apple silicon | Run `uv run server/whisper_server.py` in the `minerr` folder. This platform is not tested. |
| macOS, Intel | Not supported, because PyTorch 2.8 has no package for Intel Macs. |

The first start of the server installs about 2.6 GB of packages. The first job downloads the model, about 1.6 GB.

## Check the download

The `.sha256` file has the SHA-256 of the zip. On Linux, WSL, or macOS, put both files in one folder and run `sha256sum -c` with the name of the `.sha256` file. On macOS, use `shasum -a 256 -c`.

## Third-party data

`vendor/kuromoji` contains kuromoji.js and its dictionary, built from mecab-ipadic, with their license and notice. Minerr does not include a dictionary for definitions. JMdict has its own [license](https://www.edrdg.org/edrdg/licence.html).
