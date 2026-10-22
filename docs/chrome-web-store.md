# Publish Minerr in the Chrome Web Store

This guide is for the owner of Minerr. It gives the changes that Minerr needs before a store release, and the steps in the Chrome Web Store Developer Dashboard. The facts come from the Chrome Web Store documentation of October 2026. The dashboard can change, so do what the dashboard shows when it differs from this guide.

## Changes that Minerr needs first

| Change | Why |
| --- | --- |
| Add PNG icons (16, 32, 48, and 128 pixels) and the `icons` field to `manifest.json`. | The store needs a 128 x 128 PNG icon in the ZIP file. Google recommends 96 x 96 artwork with 16 pixels of transparent padding on each side. At 16 and 32 pixels, use the pickaxe of `docs/logo.svg` without 日本語. |
| Make a store ZIP with `manifest.json` at the root. | The store does not accept a ZIP with the manifest in a folder. The GitHub release ZIP has the top folder `minerr`, so you cannot upload it. |
| Leave `server/` and the two launchers (`Start WhisperX server (Windows).cmd` and `Start WhisperX server (WSL).cmd`) out of the store ZIP. | A store install has no folder that the user can open, so a launcher cannot start from there. Store users get the server from the GitHub release. |
| Add the store item ID to the allowed origins in `server/chrome_start.py`, and change the hint of the popup. | The store gives Minerr a fixed ID. It is not the ID that `chrome_start.py` calculates from the folder path, so Chrome refuses the Start button for a store install. The popup hint tells the user to double-click a file in the Minerr folder, and a store install has no such folder. |
| Add a `LICENSE` file. | The store does not need a license. But without one, Minerr is not open source, and other people have no right to use or change the code. |
| Write a privacy policy, for example `PRIVACY.md`. | The Privacy practices tab asks for a privacy policy URL. See [Privacy practices](#4-fill-in-the-privacy-practices-tab). |

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
3. Make the ZIP:

   ```sh
   npm run build
   rm -rf /tmp/minerr-store && cp -r dist /tmp/minerr-store
   rm -r /tmp/minerr-store/server /tmp/minerr-store/*.cmd
   python3 -c "import shutil; shutil.make_archive('minerr-store', 'zip', '/tmp/minerr-store')"
   ```

4. Check that `manifest.json` is at the root of the ZIP: `python3 -m zipfile -l minerr-store.zip | grep manifest.json` must show `manifest.json`, not `minerr/manifest.json`.

## 3. Upload the ZIP and fill in the store listing

1. In the dashboard, click **Add new item**, then upload `minerr-store.zip`. The largest package that the store accepts is 2 GB.
2. Write down the item ID that the dashboard shows. Put it in `server/chrome_start.py` (see the table at the top), then make a new GitHub release of the server.
3. On the **Store listing** tab, fill in these fields:

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

A description that obeys the store policies on impersonation, keyword spam, and misleading listings:

> Minerr helps you read Japanese on web pages and in videos, and make Anki cards from them.
>
> - It underlines each word in the color of its status: unknown, learning, known, or ignored.
> - A popup shows the dictionary entry of a word when the mouse is on it.
> - One key adds an Anki card with the sentence, a screenshot, and audio.
> - On YouTube, Netflix, and other video sites, it shows Japanese subtitles that you can mine.
>
> Minerr supports only Japanese. It keeps all of your data in your browser and has no account or cloud sync. It needs Anki with the AnkiConnect add-on. It is free and open source: https://github.com/haziqhilmismail/minerr

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

**Privacy policy.** Give the URL of the privacy policy, for example `https://github.com/haziqhilmismail/minerr/blob/main/PRIVACY.md`. It must agree with the data usage that you declare. Write in it what the list above says, and that the WhisperX server, which the user installs separately, downloads videos with `yt-dlp` and its model from Hugging Face.

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
