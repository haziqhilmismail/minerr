# Privacy policy of Minerr

Last change: 22 October 2026

Minerr is a browser extension for Japanese study. It has no account, no analytics, no ads, and no server of its own. The developer gets no data from Minerr, and does not sell or share data.

## Data that stays on your computer

Minerr keeps these data in your browser (`chrome.storage` and IndexedDB):

- Your settings.
- The status of each word: unknown, learning, known, or ignored.
- The dictionaries that you import, such as JMdict.
- Your bookmarks of subtitle lines, and your word overrides.

Minerr reads the text of the pages where you turn it on, to find the Japanese words. It reads the subtitles of the videos that you watch. It does this in your browser, and it does not send this text away, except as the next section says.

When you add an Anki card, Minerr sends the word, the sentence, the definition, a screenshot of the tab, and the audio to Anki on your computer, through the AnkiConnect add-on (`http://127.0.0.1:8765`).

## Data that leaves your computer

- **Word audio.** For the audio of a card, Minerr sends the word and its reading to JapanesePod101 (`assets.languagepod101.com`). You can turn off the word audio on the options page.
- **Subtitles.** On YouTube and Netflix, Minerr gets the subtitle file that the video player of the site uses, from that site.
- **Lapis note type.** When you install the Lapis note type, Anki downloads it from GitHub (`github.com/donkuri/lapis`).

The privacy policies of these services apply to these requests.

## The WhisperX add-on

The WhisperX add-on is a separate program. You install it yourself, and it runs on your computer at `http://127.0.0.1:8766`. Minerr sends it the address of the video, or the video file that you open in the Minerr player. The add-on downloads the audio of the video with `yt-dlp`, and its speech model from Hugging Face. It keeps the subtitles and the audio on your computer.

## Delete your data

To delete all data of Minerr, remove the extension in `chrome://extensions`. To delete one dictionary, click its **Delete** button on the options page.

## Contact

Ask questions on the [Issues page](https://github.com/haziqhilmismail/minerr/issues) of the project.
