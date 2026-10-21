# Minerr design: teal and coral

Minerr uses the teal and coral colors of its own, and the feel of the Apple Human Interface Guidelines: the system font, a short type scale, a 4 px grid, large continuous corners, soft layered shadows, frosted glass on floating parts, and short motion. `src/shared/design-tokens.ts` holds the one list of tokens (`TOKENS`) and the shared CSS that uses them.

- `npm run build` writes `PAGE_CSS` to `dist/theme.css` for the extension pages: the tokens and the base rules of the pages (body, titles, buttons, fields, switches, segmented controls, grouped lists `.group`, keys, focus rings, and the classes `.muted`, `.ok`, `.error`, `.dot`, and `.column`).
- `tokensOn(selector)` puts the tokens on the root of a surface, with the rules for reduced motion and reduced transparency. The word popup uses it on its shadow host. The subtitle layer `.minerr-subs` uses it with `color-scheme: dark`.
- `themed(selector)` is `tokensOn()` plus the theme of `applyTheme(root)` (`src/shared/theme.ts`). The extension pages and the subtitle sidebar `.minerr-lines` use it. The sidebar follows the Minerr theme, not the theme of the host page.
- The `.primary` class gives a button the coral to amber gradient (`PRIMARY_BUTTON`), on the pages and in the word popup.
- `GLASS` holds the declarations of frosted glass, for the popup, the toasts, and the button bar on other sites.

Each color value is `light-dark(light, dark)`. The `color-scheme` of the element selects the value.

## Colors

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--bg` | `#f2f6f7` | `#0f1d24` | The page background, and the background of the grouped lists. |
| `--card` | `#ffffff` | `#152730` | Groups, cards, the popup, and the selected part of a segmented control. |
| `--field` | `#ffffff` | `#0f1d24` | The background of an input. |
| `--text` | `#0f1d24` | `#e7f2f1` | The one text color. |
| `--muted` | `--text` at 64% | same | Secondary text (5.0:1 on `--bg`, 6.3:1 on the dark card). |
| `--raised` | `--text` at 7% | same | Segmented tracks, secondary buttons, hover. |
| `--line` | `--text` at 16% | same | Borders of fields, and the off track of a switch. |
| `--separator` | `--text` at 11% | same | The lines between the rows of a group and between the parts of the popup. |
| `--accent` | `#0f766e` | `#2dd4bf` | Teal for text, links, borders, and focus rings (5.5:1 and 8.3:1). |
| `--accent-fill` | `#14b8a6` | `#2dd4bf` | Teal for large fills: switches, the site card, progress bars, Create N cards. |
| `--on-accent` | `#042f2e` | `#042f2e` | Text on `--accent-fill` (5.8:1). |
| `--accent-soft` | `--accent-fill` at 16% | same | Icon wells, hover fills, the field focus halo. |
| `--brand` | coral `#ff6f61` to amber `#ffb238`, 135deg | same | The primary button: Add to Anki, Send, Generate. |
| `--on-brand` | `#2a1208` | same | Text on `--brand` (6.5:1 or more). |
| `--star` | `#b26a00` | `#ffb238` | The bookmark star in the subtitle sidebar and the frequency stars in the popup. |
| `--i-plus-one` | yellow `rgba(250, 204, 21, 0.3)` | same | The i+1 highlight (`I_PLUS_ONE`), also in the toolbar popup. |
| `--ok`, `--warn`, `--error` | `#1d7a36`, `#8f5600`, `#c22a2a` | `#74d68f`, `#f2b65a`, `#ff8f8f` | Status messages and the score. |

## Type

| Token | Value | Use |
| --- | --- | --- |
| `--font-ui` | `-apple-system`, `BlinkMacSystemFont`, Segoe UI Variable Text, Segoe UI, `system-ui`, then Hiragino Sans, Noto Sans JP, Yu Gothic UI, Meiryo | All UI text. San Francisco on macOS, Segoe UI Variable on Windows 11. Japanese characters fall back to the Japanese fonts. |
| `--font-display` | The same, with Segoe UI Variable Display | Titles of 17 px and more (`h1`, `h2`, numbers). |
| `--font-jp` | Hiragino Sans, Noto Sans JP, Yu Gothic UI, Meiryo, then the UI fonts | Japanese text: the headword, subtitles, sidebar lines, words. |
| `--font-mono` | `ui-monospace`, Cascadia Mono, Consolas, Menlo | The markers of the note fields. |
| `--text-caption` | 12px | Tags, key hints, the time of a line, small notes. |
| `--text-footnote` | 13px | Help text, secondary text, segmented controls, status messages. |
| `--text-body` | 15px | Body text, buttons, definitions. |
| `--text-headline` | 17px | Section titles, the reading in the popup, the title of the sidebar. |
| `--text-title2` | 22px | Page titles of the toolbar popup and the player, large numbers. |
| `--text-title1` | 28px | The headword in the popup, the title of the options page, the score. |

Weights are 400 for text, 600 for labels and buttons, and 700 for titles. Sizes are in px, because a surface on a web page must not follow the root font size of that page. No font file is in the extension.

## Space, shape, depth, motion

| Token | Value | Use |
| --- | --- | --- |
| `--space-1` to `--space-6` | 4, 8, 12, 16, 24, 32 px | All padding, margins, and gaps. |
| `--radius-xs`, `-s`, `-m`, `-l`, `-pill` | 6, 10, 14, 20, 999 px | Keys and chips; fields and segmented controls; groups, cards and sidebar lines; the popup and other floating surfaces; buttons. |
| `--corner` | `superellipse(1.6)` | The `corner-shape` of large corners, a continuous curve like the corners of Apple hardware. Browsers without `corner-shape` show round corners. |
| `--shadow-1` | 0.5 px and 3 px, slate at 10% and 6% | Sidebar lines, the selected segment. |
| `--shadow-2` | 2 px and 16 px | Toasts, the subtitle line, the video stage, the hover of a line. |
| `--shadow-3` | A 0.5 px outline and three soft layers | The word popup. |
| `--edge` | A 0.5 px inner highlight | The edge of glass surfaces. |
| `--material`, `--material-subs`, `--blur` | `--card` at 94% (thick, because the popup holds text to read), `--bg` at 64%, `blur(24px) saturate(180%)` | Frosted glass: the popup, the toasts, and the button bar on other sites; the subtitle line. |
| `--switch-w`, `--switch-h` | 46 px, 28 px | The size of every switch. |
| `--ease`, `--fast`, `--normal` | `cubic-bezier(0.22, 1, 0.36, 1)`, 150, 200 ms | Hover and pressed states, switches, the entry of the popup and the toasts. |

With `prefers-reduced-motion: reduce`, the durations are 0. With `prefers-contrast: more`, `--muted`, `--line`, and `--separator` are stronger. With `prefers-reduced-transparency: reduce`, the glass is the solid `--card`, and the subtitle line is the solid `--bg`.

## Rules

1. Text has one color. Secondary text and greys are opacity steps of that color.
2. Each accent has a fill value and a high-contrast value for text.
3. Buttons are pills. Icon buttons are round. The primary button has the coral to amber gradient. A button gets 3% smaller while you press it.
4. Content sits flat in groups on `--bg`. Shadows and glass are for the parts that float over content: the popup, toasts, the subtitle line.
5. Settings are rows of at least 44 px in grouped lists. A setting that is on or off is a switch (`role="switch"`). A choice of two to four values is a segmented control.
6. Focus rings are 2px `--accent`. A field in focus gets an `--accent` border and a soft halo.
7. Motion is 150 or 200 ms with an ease-out curve, and only answers an action of the user.

The word status colors do not change: unknown `#e5383b`, learning `#f59f00`, known `#2f9e44`, ignored `#8a8f98` (`src/status/status.ts`). They show on any page, so they do not use the theme. The i+1 highlight stays yellow.
