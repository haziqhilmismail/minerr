# Developing Minerr

The code is TypeScript, with no framework and no bundler. `npm run build` copies `manifest.json`, the HTML pages, `vendor`, the WhisperX server (`server/whisper_server.py`, `server/media.py`, `server/chrome_start.py`, and the `server/*.cmd` hosts) and the Windows launcher (`*.cmd`) to `dist`. Then `tsc` compiles each `.ts` file to a `.js` file next to it in `dist`. `npm run typecheck` checks the types of the extension, the tests and the scripts.

## Code map

The extension code lives in `src/`, one folder per concern, and the extension pages live in `pages/`. Only `manifest.json`, `background.ts` and `content.ts` stay at the top level, because that's where Chrome starts.

| Folder | What's in it |
| --- | --- |
| `pages/` | The extension pages: the toolbar menu, the options, the video player, the subtitle sidebar, the reader, the word browser, and the offscreen document that parses text. Each page is an `.html` file plus a `.ts` file. |
| `src/text/` | Japanese text to words: kuromoji tokens to words, each word's dictionary entry, inflections, sentences, and the word spans of parsed text, on a page and in a subtitle line. |
| `src/dictionary/` | Yomitan dictionaries: the zip reader, the import, IndexedDB storage, frequency and pitch data, and tag colors. |
| `src/page-text/` | A website's page text: parsing the page, the per-site switch, furigana, pitch colors, the i+1 highlight and the sentence highlight. |
| `src/popup/` | The word popup, its card form, the rule for when it opens, and the page and popup keys. |
| `src/video/` | Video subtitles: the overlay, subtitle files, play modes, video keys and settings, audio recording, and the Minerr server client. `sidebar/` holds the subtitle sidebar; `youtube/` and `netflix/` hold the parts only YouTube or Netflix uses. |
| `src/anki/` | The AnkiConnect client, the note types (Lapis), and a card's sentence audio and word audio. |
| `src/reader/` | The reader page's text files and EPUB files. |
| `src/status/` | Word statuses, the word browser's list, and the comprehension score. |
| `src/shared/` | Code every part uses: messages, settings, type guards for outside data, DOM helpers, the theme and the design tokens. |

How a word gets from a page to a card:

1. `content.ts` loads `src/page-text/`, `src/popup/`, `src/status/stats.ts` and the subtitle overlay from `src/video/` into each tab.
2. A module sends a message (`src/shared/rpc.ts`) to the service worker, `background.ts`.
3. The service worker passes the text to the offscreen document, `pages/offscreen.ts`, which parses it with kuromoji and looks the words up in the dictionaries.
4. When you add a card, the service worker sends the note to Anki through AnkiConnect (`src/anki/anki.ts`).

## Files

| Path | Purpose |
| --- | --- |
| `manifest.json` | The Manifest V3 declaration. Its paths point at the `.js` files in `dist`. |
| `background.ts` | The service worker. It routes messages and calls AnkiConnect and the WhisperX server. |
| `pages/offscreen.ts` | Runs kuromoji and the dictionary lookups in an offscreen document. |
| `src/shared/rpc.ts` | The messages between the parts of the extension, and the reply type of each message. |
| `src/page-text/page.ts` | Finds Japanese text on the page and wraps each word. When the word overrides change, it re-parses the blocks that contain that text. |
| `src/popup/popup.ts` | The dictionary popup: when it opens, its keys, and the card it adds. |
| `src/popup/popup-view.ts` | What the popup shows and where it sits. |
| `src/text/word-spans.ts` | The word spans of parsed text. A word that crosses text nodes gets one span per part. |
| `src/page-text/furigana.ts` | The furigana setting, and the CSS that puts the reading over a word. |
| `src/page-text/pitch-colors.ts` | Pitch colors for the words on a page. |
| `src/page-text/sentence-hover.ts` | Highlights the sentence of the word under the mouse. |
| `src/text/sentence-text.ts` | The sentence around a word on the page, for the highlight and the card. The walk stops at sentence ends and at a `<br>`. |
| `src/page-text/site.ts` | The per-site page text switch, and a page's state: Minerr off, video subtitles only, or page text too. |
| `src/popup/keys.ts`, `src/popup/chord.ts` | The keys that work on a page without a popup, the browser shortcuts the service worker forwards to the tab, and key names. |
| `src/dictionary/meta.ts` | Frequency and pitch accent data from Yomitan dictionaries, the stars, and the pitch patterns. |
| `src/video/youtube/youtube-overlay.ts` | The subtitle overlay on YouTube. |
| `src/video/youtube/youtube-captions.ts` | YouTube captions with times, read in the tab without the server, and the choice of caption track. |
| `src/video/youtube/youtube-main.ts` | Runs in the YouTube page itself and tells `src/video/youtube/youtube-captions.ts` the caption tracks and the player token. |
| `src/video/ask-page.ts` | Sends a question to Minerr's script inside the page (YouTube, Netflix) and gets the reply. |
| `src/video/netflix/netflix-overlay.ts` | The subtitle overlay on Netflix: the title's Japanese track with times, read in the tab. |
| `src/video/netflix/netflix-captions.ts` | A Netflix title's subtitle list, the choice of track, and the TTML reader. |
| `src/video/netflix/netflix-main.ts` | Runs in the Netflix page itself: keeps the subtitle list the player reads, asks for WebVTT, and seeks through the player. |
| `src/status/status.ts` | Word statuses, their colors and their storage. |
| `src/dictionary/tags.ts` | Dictionary tag colors, for the popup and the card. |
| `src/anki/anki.ts` | The AnkiConnect client, the note types, and a card's note draft. |
| `src/anki/lapis.ts` | The pure parts of the Lapis fields: furigana, frequency rank and pitch accent. |
| `src/anki/wordaudio.ts` | Word audio from JapanesePod101, and the check for its placeholder clip. |
| `src/popup/cardform.ts` | The popup's card form (`E`). |
| `src/video/whisper.ts` | The WhisperX server client, and `currentPlace`: whether this is Windows, and how Minerr was installed (from `chrome.management.getSelf`). |
| `src/anki/lineaudio.ts`, `src/video/record.ts` | A card's sentence audio: either the server cuts it, or the tab records the line. |
| `src/dictionary/db.ts` | Dictionary storage in IndexedDB. |
| `src/text/entry.ts` | Each word's dictionary entry and status key, and joining word overrides and compound nouns. |
| `src/text/group.ts`, `src/text/sentence.ts`, `src/dictionary/yomitan.ts`, `src/dictionary/zip.ts` | Pure functions for parsing, sentences, the dictionary format and the zip reader. |
| `src/text/inflection.ts` | Pure function: the parts of an inflected word and their labels, for the popup line. |
| `src/shared/theme.ts`, `src/shared/design-tokens.ts` | The theme setting, and the design tokens for every surface (see `docs/design.md`). The build writes the tokens and the pages' base rules (`PAGE_CSS`) to `dist/theme.css`. |
| `src/popup/hover.ts` | The word popup setting, and the rule that decides when the popup opens. |
| `pages/action.html`, `pages/action.ts` | The toolbar menu. |
| `pages/player.html`, `pages/player.ts` | The video player page. Content scripts don't run on extension pages, so the page loads `src/page-text/page.ts`, `src/popup/popup.ts`, `src/page-text/iplusone.ts` and `src/status/stats.ts` itself. |
| `src/page-text/iplusone.ts` | The i+1 highlight. The pure part is `iPlusOneSentences` in `src/text/sentence.ts`. |
| `src/video/video.ts` | A video, its subtitle lines, and the overlay on top of it. YouTube, the player and other sites all use it. |
| `src/video/overlay.ts` | The subtitle overlay line, for YouTube and the player. |
| `src/video/playback.ts`, `src/video/videokeys.ts` | Pure rules for timed lines (jumps, play modes, gaps, text clean-up), and the video key table. |
| `src/video/videosettings.ts`, `src/video/videooptions.ts` | The video settings, and their part of the options page. |
| `src/video/other-sites.ts` | The subtitle overlay and its buttons on the largest video of a non-YouTube page. |
| `pages/sidepanel.html`, `pages/sidepanel.ts` | The subtitle sidebar page, shown in Chrome's side panel next to the video tab. The service worker opens it for the `G` key. The page connects a port to the tab to get the lines and the current line. It loads `src/page-text/page.ts`, `src/popup/popup.ts` and `src/page-text/iplusone.ts` itself. |
| `src/video/sidebar/sidebar.ts` | The subtitle sidebar: a card per line, the **+** word list, and the bookmark stars. |
| `src/video/sidebar/sidebar-port.ts` | Messages between the tab and the sidebar page: the lines, the current line, and the line of the open popup. |
| `src/video/sidebar/bookmarks.ts` | Each video's bookmarked lines, in storage. |
| `src/video/sidebar/sidebar-filter.ts` | The subtitle sidebar filters. |
| `src/video/sidebar/sidebar-select.ts` | Selecting lines in the subtitle sidebar, and **Create N cards**. |
| `src/video/autopause.ts` | Minerr's pauses: while the mouse is on the line or a popup is open, and after a play-mode pause. |
| `src/video/captions.ts` | Subtitle segments, the `.srt` and `.vtt` reader, and the `.srt` writer. |
| `server/whisper_server.py`, `server/media.py` | The local server: WhisperX jobs and the HTTP routes, plus the video side (cache keys, `yt-dlp`, `ffmpeg`, the audio cache and line clips). The server uses `yt-dlp` and `ffmpeg` from the `PATH` if they're there, otherwise the `yt-dlp` package and the `ffmpeg` from `imageio-ffmpeg`. |
| `Start WhisperX server (Windows).cmd` | Starts the WhisperX server on Windows, after `server/chrome_start.py` sets up the popup's Start button. It downloads uv if it can't find it, and fetches the newest `yt-dlp` on every start. Git checks out the `.cmd` files with CRLF line endings (`.gitattributes`), because they're Windows batch files. |
| `server/chrome_start.py` | Writes the manifest of the native messaging host `com.minerr.whisperx` to `%LOCALAPPDATA%\Minerr`, plus the registry value that points at it. The manifest lets the Chrome Web Store build of Minerr use the host (`STORE_EXTENSION_ID`), and also the unpacked extension in this folder, if the folder has a `manifest.json`. The add-on folder has none. The Windows launcher runs this file with Windows Python. |
| `server/start-from-chrome-windows.cmd` | The native messaging host for the Windows launcher. Chrome runs the registered host when you click **Start the server**; the host opens its launcher in a separate window and exits. |
| `scripts/logo.py`, `docs/logo.svg`, `icons/` | `scripts/logo.py` draws the logo and the extension icons as pixel art in one palette: `docs/logo.svg` and `icons/icon-16.png`, `-32`, `-48` and `-128`, a 16 x 16 pickaxe at whole-number scales. Run `python3 scripts/logo.py`. |
| `scripts/package.ts` | Packs `dist` into three zips in `release`, each with a `.sha256` file: `minerr-whisperx-v<version>.zip` (the WhisperX add-on: the server and its launcher), `minerr-v<version>.zip` (the whole extension inside a `minerr` folder, for Load unpacked), and `minerr-store-v<version>.zip` (the extension without the add-on, with `manifest.json` at the root, for the Chrome Web Store). |
| `LICENSE`, `PRIVACY.md` | The MIT License, and the privacy policy that the Chrome Web Store listing links to. |
| `.github/workflows/release.yml`, `docs/release-notes.md` | When you push a tag such as `v0.3.0`, the workflow builds and packs the extension. It creates a draft GitHub release with the WhisperX add-on, the Load unpacked zip, the list of merged PRs and the text of `docs/release-notes.md`, and keeps the store zip on the run's page. |
| `src/video/server-status.ts` | Pure functions: the WhisperX server status shown in the toolbar menu, worked out from the last health check and the last click on **Start the server**, plus the text and buttons for each status. `serverHint` gives instructions for starting the server in places other than the toolbar menu, for example in the **Generate with WhisperX** error. The text and buttons depend on the platform and the install: Load unpacked has the Minerr folder, which already contains the add-on, while other installs, such as the Chrome Web Store, get the add-on from GitHub. |
| `src/status/stats.ts` | A tab's comprehension score, for the toolbar menu. |
| `src/status/score.ts` | Pure functions for the score and its label. |
| `pages/words.html`, `pages/words.ts` | The word browser page. |
| `src/status/wordlist.ts` | Pure functions for searching, filtering and sorting in the word browser, and for pasted word lists. |
| `pages/reader.html`, `pages/reader.ts` | The reader page, for files and pasted text. It loads `src/page-text/page.ts`, `src/popup/popup.ts`, `src/page-text/iplusone.ts` and `src/status/stats.ts` itself. |
| `src/reader/epub.ts` | The EPUB reader. It builds new DOM nodes from an allowlist of tags and copies no attributes from the file. |
| `src/reader/book.ts` | Pure functions for the reader: text parts, page keys, page turns and the saved place. |

## Tests

Node.js runs the `.ts` test files directly, without a build. To run the tests:

1. Run `npm ci`.
2. Download `JMdict_english.zip` to `test/fixtures/JMdict_english.zip`.
3. Run `npm run build`. The browser tests load the extension from `dist`.
4. Run `node test/unit.ts`, `node test/entry-unit.ts`, `node test/card-unit.ts`, `node test/video-unit.ts` and `node test/netflix-unit.ts`.
5. Close Anki, because the next tests use port 8765.
6. Run `node test/e2e.ts`, which loads the extension in Chromium with Playwright against a mock AnkiConnect. Then run `node test/spelling.ts`, which tests the shared status of a word's spellings, and `node test/card.ts`, which tests the Lapis note type, word audio and the card form against a mock AnkiConnect and a mock JapanesePod101.
7. Stop the WhisperX server, then run `node test/subtitles.ts`. It tests the subtitle overlay and the toolbar menu on a fake YouTube page, uses ports 8765 and 8766, and needs `ffmpeg` to make a test video. Then run `node test/line-audio.ts`, `node test/media.ts`, `node test/player.ts`, `node test/sites.ts` and `node test/netflix.ts`, which use the same ports. `node test/line-audio.ts` tests the sentence and sentence audio of a card from a long YouTube line. `node test/netflix.ts` tests the overlay on a fake Netflix watch page, with the player's subtitle list, and the card from a protected video.
8. Run `python3 -I -B -m unittest discover -s server` to test the WhisperX server. This doesn't need WhisperX installed.

`npm test` runs a type check and then steps 3 to 7 in one go.

More test files that `npm test` runs:

- `node test/media.ts` tests the i+1 highlight and the player against a mock AnkiConnect and a mock WhisperX server, on ports 8765 and 8766. It runs after `node test/subtitles.ts`.
- `node test/pages-unit.ts` tests the pure functions behind the comprehension score, the word browser and the reader. `node test/pages.ts` tests the same three features in Chromium, with the score in the toolbar menu. Both run after `node test/media.ts`.
- `node test/sidebar.ts` tests the player's subtitle sidebar: that `G` opens and closes Chrome's side panel, when the list follows the video, and **Create N cards**. Playwright can't reach Chrome's side panel, so the test opens the sidebar page in its own tab. It uses port 8765 and `ffmpeg`, and runs after `node test/player.ts`.

Other scripts:

- `node test/screenshots.ts` saves a light and a dark screenshot of each surface to `/tmp/minerr-ui`: the page, the popup, the card form, the toolbar menu, the options page, the video player, the subtitle sidebar, the reader and the word browser. Set `OUT_DIR` for another folder, `EXTENSION_DIR` for another build, and `SUFFIX` to add a suffix to the file names, for example `SUFFIX=before`.
- `node test/card-preview.ts` saves screenshots of the card to `/tmp/minerr-card`.
- `node test/page-perf.ts [paragraphs] [runs]` measures the first parse of a long article (2000 paragraphs and 3 runs by default): the time until the first word in the viewport shows, with the viewport at the top and in the middle of the page, the time until every word shows, and the longest tasks. With `test/fixtures/JMdict_english.zip` it installs JMdict and uses distinct words. It fails if, on a warm run, the first word in the viewport takes more than 400 ms after page load.
- `node test/parse-time.ts` imports the real JMdict and prints the parse time of a long page. Set `EXTENSION_DIR` to time another build.
- `STORE=1 node test/screenshots.ts` captures the reader (in vertical text) and the word browser at 1280 x 800, the Chrome Web Store screenshot size. `node test/store-tiles.ts` renders the store listing's two promo tiles from `docs/logo.svg` to `/tmp/minerr-store`. See [chrome-web-store.md](chrome-web-store.md).
- `node test/readme-shots.ts` saves screenshots of a Japanese Wikipedia article and a YouTube video to `docs/page.png` and `docs/video.png`. It needs the network and a WhisperX server that already has the video's subtitles. `node test/readme-shots.ts page` saves only `docs/page.png` and needs no server.
- If the system has no Japanese font, set `CJK_FONT_DIR` to a folder that has one. Put an emoji font in the same folder too, for example `seguiemj.ttf` from Windows; without it, the `⭐` tag shows up as a box.
- If Chromium won't start because a library such as `libnss3.so` is missing, set `LD_LIBRARY_PATH` to a folder with the missing libraries.
- If you update kuromoji, run `npm run vendor` and commit the `vendor/kuromoji` folder.

## WhisperX server endpoints

- `POST /files` takes a file as the request body, with `Content-Type: application/octet-stream` and the URL-encoded file name in `X-Filename`. It returns the job ID and the file's SHA-256. The player uses this one.
- `GET /files/<sha256>` returns a file's cached subtitles. The player uses this one too.
- `POST /jobs` takes `{"url": ...}` and starts a WhisperX job for the video at that URL. A non-YouTube URL gets the SHA-256 of the URL as its cache key.
- `POST /captions` takes `{"url": ..., "lang": "ja"}` and returns the site's subtitles in that language as `{"ext": ..., "text": ...}`, or 404 if the video has none. `ext` is `json3`, `vtt` or `srt`.
- `POST /clip` takes `{"url": ..., "start": ..., "end": ...}` or `{"sha256": ..., "start": ..., "end": ...}`, with times in seconds, and returns an MP3 of the audio between the two times. The server downloads a URL's audio once, to `~/.cache/minerr/audio/`. While that download runs, the reply is 404 and the extension records the line in the tab instead. The server keeps an uploaded file's audio after its WhisperX job.

## Make a release

Put `Fixes #N` in each PR, so that the issue closes at merge. Release after about 3 fixes, or at once for a bug that breaks Minerr. Use x.y.Z+1 for fixes and x.Y+1.0 for features.

1. Set the new version in `manifest.json` and `package.json`.
2. Run all the tests, then merge the version change through a PR. Don't push it to `main`.
3. Run `git tag v<version>` on the merged commit, then `git push origin v<version>`.
4. Open the [Releases](https://github.com/haziqhilmismail/minerr/releases) page. About 2 minutes later, GitHub Actions creates a draft release with `minerr-whisperx-v<version>.zip`, `minerr-v<version>.zip` and their `.sha256` files. The draft's text starts with the list of merged PRs, followed by `docs/release-notes.md`, the install guide for the WhisperX add-on. Commits that had no PR aren't in the list, so add those by hand.
5. Click **Publish release**. Do this before you submit the store update: the popup links to the release page, and a draft shows only the tag, without the list of changes.

The workflow stops if the tag doesn't match the version in `manifest.json` and `package.json`. Each zip works on every platform: the extension has no native code, and uv installs the right server packages for the platform on first start. To build the zips locally, run `npm run build`, then `node scripts/package.ts`. The zips go to the `release` folder.

To publish Minerr to the Chrome Web Store, see [chrome-web-store.md](chrome-web-store.md).
