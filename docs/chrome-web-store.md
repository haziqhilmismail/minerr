# Publish Minerr in the Chrome Web Store

This guide is for the owner of Minerr. It gives the state of the changes for the store, and the steps in the Chrome Web Store Developer Dashboard. The facts come from the Chrome Web Store documentation of October 2026. The dashboard can change, so do what the dashboard shows when it differs from this guide.

## Changes for the store

| Change | State |
| --- | --- |
| PNG icons (16, 32, 48, and 128 pixels) and the `icons` field in `manifest.json`. The store needs a 128 x 128 PNG icon in the ZIP file. | Done. `scripts/logo.py` draws the icons. |
| A store ZIP with `manifest.json` at the root, without `server/` and the launcher. The store does not accept a ZIP with the manifest in a folder. A store install has no folder where a launcher can start. | Done. `node scripts/package.ts` writes `release/minerr-store-v<version>.zip`. |
| A `LICENSE` file. Without a license, other people have no right to use or change the code. | Done. The MIT License. |
| A privacy policy. The Privacy practices tab asks for its URL. | Done. `PRIVACY.md`. See [Privacy practices](#4-fill-in-the-privacy-practices-tab). |
| Texts for a store install. A store install has no Minerr folder, so the popup must not tell the user to open it. | Done. The popup tells a store install to get the WhisperX add-on from GitHub (`src/video/server-status.ts`). |
| The item ID in `STORE_EXTENSION_ID` in `server/chrome_start.py`. The store gives Minerr a fixed ID, and Chrome refuses the Start button for an ID that the host manifest does not name. | Left. Fill it in after the first upload, then make a new release of the add-on. See [step 3](#3-upload-the-zip-and-fill-in-the-store-listing). |
| The store address in `README.md` and `docs/release-notes.md`. | Left. Both say that Minerr comes to the store soon. When the store listing is live, put its address there. |

## 1. Register a developer account

1. Choose the Google account for the store. You cannot change the email address of a developer account later, so Google suggests a new account only for the store.
2. Turn on 2-Step Verification for that account. The store needs it before you can publish or update an item.
3. Open the [Developer Dashboard](https://chrome.google.com/webstore/devconsole).
4. Read the developer agreement and the program policies, then accept them.
5. Pay the one-time registration fee. It was US$5 for many years. The dashboard shows the current amount.
6. Set the publisher name. It shows under "Offered by" on the store page.
7. Verify the contact email. The store sends a link to it.
8. Declare if you are a trader or a non-trader. The EU Digital Services Act needs this declaration. A trader must show contact details to users in the EU. Google does not decide this for you. A free hobby project with no income is often a non-trader, but you must make the decision.

## 2. Make the store ZIP

1. Set a new version in `manifest.json` and `package.json`. Each upload needs a higher version than the upload before it.
2. Run all tests.
3. Make the ZIP in one of these ways:
   - Run `npm run build`, then `node scripts/package.ts`. The store ZIP is `release/minerr-store-v<version>.zip`.
   - Push the version tag (README: Make a release). The release workflow keeps the store ZIP on the page of its run, as the artifact `minerr-store-v<version>`. GitHub puts the artifact in a ZIP of its own, so unzip the download one time to get `minerr-store-v<version>.zip`.
4. Check that `manifest.json` is at the root of the ZIP: `python3 -m zipfile -l release/minerr-store-v<version>.zip | grep manifest.json` must show `manifest.json`, not `minerr/manifest.json`.

## 3. Upload the ZIP and fill in the store listing

1. In the dashboard, click **Add new item**, then upload `minerr-store-v<version>.zip`. The largest package that the store accepts is 2 GB.
2. Write down the item ID that the dashboard shows. The ID does not change.
3. Put the item ID in `STORE_EXTENSION_ID` in `server/chrome_start.py`.
4. When the store listing is live, put its address in `README.md` and `docs/release-notes.md`, where they say that Minerr comes to the store soon, and remove the TODO comments. Until the review ends, the address shows no page.
5. Set a higher version, and make a new release (README: Make a release). The WhisperX add-on of that release lets the store version use the Start button of the popup.
6. On the **Package** tab, upload the store ZIP of the new version.
7. On the **Store listing** tab, fill in these fields:

| Field | Value |
| --- | --- |
| Name | `Minerr`, from `manifest.json`. Do not put the name of another product in it. |
| Summary | The `description` of `manifest.json`, 132 characters at most. |
| Description | See the text below. |
| Category | Education. |
| Language | English. |
| Screenshots | At least 1, and up to 5. Size 1280 x 800 (or 640 x 400), square corners, no padding. |
| Small promo tile | 440 x 280. Google's image guide says that it is necessary. |
| Marquee promo tile | 1400 x 560. Optional. Without it, the store cannot show Minerr in the marquee. |
| Homepage and support | `https://github.com/haziqhilmismail/minerr` and its Issues page. |

Google's image guide is from 2018. Use the sizes that the dashboard shows.

The description, as plain text for the **Description** field. It obeys the store policies on impersonation, keyword spam, and misleading listings, and it names no other learning tool:

```text
Minerr helps you read Japanese on web pages and in videos, and turn the words you meet into Anki cards.

What it does:
• Status colors. Each Japanese word gets an underline that shows whether it is unknown, learning, or known. Point at a word and press 1 to 4 to change its status.
• Hover lookup. Rest the mouse on a word to see its reading and meaning from the dictionaries you import, such as JMdict. With the right dictionaries, you also see pitch accent and word frequency.
• One-key Anki cards. Press A, and the card gets the word, the sentence, the definition, a screenshot, and audio. Press E to edit the card before it goes to Anki.
• Video subtitles. On YouTube, on Netflix, and in your own video files, Minerr shows the Japanese subtitles in its own overlay, so you can look up every word. A sidebar lists all lines, and you can turn many of them into cards at once. Netflix protects its video, so cards from Netflix have no screenshot or audio.
• Reader. Open EPUB, TXT, and SRT files, or paste text. Vertical text works too.
• Comprehension score. See how much of a page you already know. Sentences with exactly one unknown word get a soft highlight, because they make the best cards.

Minerr reads a website only after you turn it on for that site. Video subtitles work everywhere.

WhisperX add-on (optional and free): for a video with no Japanese subtitles, the add-on makes them on your own computer. Get it from GitHub: https://github.com/haziqhilmismail/minerr/releases

Privacy: your word statuses and dictionaries stay in your browser. Minerr has no account, no ads, and no analytics.

To add cards, you need Anki with the AnkiConnect add-on.

Minerr is free and open source under the MIT License: https://github.com/haziqhilmismail/minerr
Minerr is not affiliated with YouTube, Netflix, or Anki.
```

The images: `icons/icon-128.png` is the store icon (96 x 96 art and 16 pixels of padding). `node test/readme-shots.ts page` makes `docs/page.png`, and `STORE=1 node test/screenshots.ts` makes the video player, the subtitle sidebar, the reader in vertical text, and the word browser, all at 1280 x 800. `node test/store-tiles.ts` makes both promo tiles. Set `CJK_FONT_DIR` to a folder with Japanese fonts and Segoe UI, for example `/mnt/c/Windows/Fonts`.

If you name another product, name it one time, say only true things about it, and add that Minerr is not affiliated with it. Do not put the name of another product in the name, the summary, the icon, or the screenshots of Minerr.

## 4. Fill in the Privacy practices tab

**Single purpose.** For example: "Minerr helps people read Japanese text on web pages and in videos, and make Anki cards from it."

**Permission justification.** One text for each permission:

| Permission | Justification |
| --- | --- |
| `storage` | Keeps the settings, the word statuses, and the bookmarks in the browser. |
| `unlimitedStorage` | Keeps the dictionaries that the user imports, such as JMdict, in IndexedDB. They are larger than the default quota. |
| `offscreen` | Runs the Japanese word splitter (kuromoji) and the dictionary lookups in an offscreen document. |
| `nativeMessaging` | On Windows, the Start button of the popup starts the user's local WhisperX server, which makes subtitles. |
| `sidePanel` | Shows the subtitle sidebar, the list of the lines of a video, in the side panel next to the video tab. |
| Host permission `<all_urls>` and the content script on all sites | Reads the Japanese text of the pages where the user turns on Minerr, and shows the popup there. Page text is off by default. The user turns it on for each site. |
| Host permissions `http://127.0.0.1:8765/*` and `http://127.0.0.1:8766/*` | Connect to AnkiConnect and to the local WhisperX server on the user's computer. |
| Content scripts in the page world on YouTube and Netflix | Read the subtitle track that the video player loads, for the subtitle overlay. |
| Optional `clipboardRead` | Lets the reader page paste text from the clipboard. Minerr asks for it only when the user wants it. |

The store reviews items with broad host permissions, such as `<all_urls>`, for longer.

**Remote code.** Select "No, I am not using remote code". Minerr has all of its code in the package.

**Data usage.** Minerr has no account, no analytics, and no server of its own. Declare what leaves the computer:

- The word audio sends the word and its reading to JapanesePod101 (`assets.languagepod101.com`). This word comes from the page, so declare **Website content**.
- The Lapis note type downloads from GitHub one time, when the user installs it.
- All other connections go to the user's own computer: AnkiConnect on port 8765 and the WhisperX server on port 8766.

Then certify the statements about the use of data, including the limited use policy.

**Privacy policy.** Give the URL of the privacy policy: `https://github.com/haziqhilmismail/minerr/blob/main/PRIVACY.md`. It must agree with the data usage that you declare. `PRIVACY.md` says what the list above says, and what the WhisperX add-on downloads. If the data usage changes, change `PRIVACY.md` too.

## 5. Set the distribution

1. Keep the item free.
2. Choose the visibility. **Public** shows Minerr in the store. **Unlisted** lets only people with the link install it, which is good for a first test.
3. Choose the regions. All regions is the default.

## 6. Submit for review

1. Click **Submit for review**.
2. To publish at a time that you choose, clear the box for automatic publication in the dialog. After the review, you have 30 days to publish. After that, the item goes back to a draft.
3. Wait for the result. Most reviews take a few days, but a review can take some weeks. Broad host permissions and powerful permissions make a review longer. If a review takes more than three weeks, contact the developer support of the store.
4. If the store rejects Minerr, the email gives the policy and the cause. Fix the cause, upload a new version, and submit again.

## 7. Move your own data to the store version

The store version has a different extension ID from the folder version, so it starts with no data.

1. In the folder version, open the options page and export the word statuses.
2. Install the store version.
3. Import the word statuses, and import the dictionaries again.
4. Remove the folder version.

## 8. Update the store version

1. Set a higher version in `manifest.json` and `package.json`, and run all tests.
2. Make the store ZIP again (step 2).
3. In the dashboard, open Minerr, open the **Package** tab, and upload the new ZIP.
4. Click **Submit for review**.
5. Push the version tag for the GitHub release too (README: Make a release), so both releases have the same version.
