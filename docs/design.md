# Minerr design: teal and coral

Minerr uses the design rules of Migaku with its own colors. `src/tokens.ts` holds the one list of tokens. `npm run build` writes it to `dist/theme.css` for the extension pages. The word popup declares it on its shadow host. The subtitle layer `.minerr-subs` declares it with `color-scheme: dark`, so the sidebar and the other children of the layer can use every token. Each value is `light-dark(light, dark)`. The `color-scheme` of the element selects the value.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--bg` | `#f2f6f7` | `#0f1d24` | The page background. |
| `--card` | `#ffffff` | `#152730` | Cards, the popup, and the pressed part of a segmented control. |
| `--field` | `#ffffff` | `#0f1d24` | The background of an input. |
| `--text` | `#0f1d24` | `#e7f2f1` | The one text color. |
| `--muted` | `--text` at 64% | same | Secondary text (5.0:1 on `--bg`, 6.3:1 on the dark card). |
| `--raised` | `--text` at 7% | same | Segmented tracks, secondary buttons, hover. |
| `--line` | `--text` at 16% | same | Dividers and borders. |
| `--accent` | `#0f766e` | `#2dd4bf` | Teal for text, links, borders, and focus rings (5.5:1 and 8.3:1). |
| `--accent-fill` | `#14b8a6` | `#2dd4bf` | Teal for large fills: switches, the site card, progress bars. |
| `--on-accent` | `#042f2e` | `#042f2e` | Text on `--accent-fill` (5.8:1). |
| `--accent-soft` | `--accent-fill` at 16% | same | Icon wells, hover fills, the current line. |
| `--brand` | coral `#ff6f61` to amber `#ffb238`, 135deg | same | The primary button: Add to Anki, Send, Generate. |
| `--on-brand` | `#2a1208` | same | Text on `--brand` (6.5:1 or more). |
| `--ok`, `--warn`, `--error` | `#1d7a36`, `#8f5600`, `#c22a2a` | `#74d68f`, `#f2b65a`, `#ff8f8f` | Status messages and the score. |
| `--shadow-1`, `-2`, `-3` | slate `#0f1d24` at 10/14/17% | black | Cards; menus and toasts; the popup. |
| `--radius-s`, `-m`, `-l`, `-pill` | 8px, 16px, 24px, 999px | same | Inputs; cards; large cards; buttons. |
| `--font-ui`, `--font-jp` | Inter, then Noto Sans JP; Noto Sans JP first | same | Local fonts only. No font file is in the extension. |

The rules from Migaku:

1. Text has one color. Secondary text and greys are opacity steps of that color.
2. Each accent has a fill value and a high-contrast value for text.
3. Buttons are pills. Icon buttons are round. The primary button has the coral to amber gradient.
4. Depth comes from three soft shadows, tinted with the slate of the background.
5. Focus rings are 2px `--accent`. Buttons in the popup are 32px high or more.

The word status colors do not change: unknown `#e5383b`, learning `#f59f00`, known `#2f9e44`, ignored `#8a8f98` (`src/status.ts`). They show on any page, so they do not use the theme. The i+1 highlight stays yellow.
