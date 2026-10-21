// The design tokens of every Minerr surface (docs/design.md), and the shared CSS that reads them. light-dark() takes
// the value for the color-scheme of the element, so one declaration list serves both themes. Put tokensOn() or themed()
// in the CSS of a surface, with the selector of its root: :root of an extension page (dist/theme.css), the popup, the
// subtitle layer, the subtitle sidebar. Sizes are in px, not rem: a surface on a web page must not follow the root font
// size of that page.
// The i+1 highlight: a translucent yellow, like a highlighter pen. The page text (src/page-text/iplusone.ts) has no tokens, so it reads this.
export const I_PLUS_ONE = 'rgba(250, 204, 21, 0.3)';

export const TOKENS = `
  --bg: light-dark(#f2f6f7, #0f1d24); --card: light-dark(#ffffff, #152730); --field: light-dark(#ffffff, #0f1d24);
  --text: light-dark(#0f1d24, #e7f2f1);
  --muted: color-mix(in srgb, var(--text) 64%, transparent);
  --raised: color-mix(in srgb, var(--text) 7%, transparent);
  --line: color-mix(in srgb, var(--text) 16%, transparent);
  --separator: color-mix(in srgb, var(--text) 11%, transparent);
  --accent: light-dark(#0f766e, #2dd4bf); --accent-fill: light-dark(#14b8a6, #2dd4bf); --on-accent: #042f2e;
  --accent-soft: color-mix(in srgb, var(--accent-fill) 16%, transparent);
  --brand: linear-gradient(135deg, #ff6f61, #ffb238); --on-brand: #2a1208;
  --star: light-dark(#b26a00, #ffb238);
  --i-plus-one: ${I_PLUS_ONE};
  --ok: light-dark(#1d7a36, #74d68f); --error: light-dark(#c22a2a, #ff8f8f); --warn: light-dark(#8f5600, #f2b65a);

  --font-ui: -apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI Variable", "Segoe UI", system-ui,
    "Hiragino Sans", "Noto Sans JP", "Yu Gothic UI", Meiryo, sans-serif;
  --font-display: -apple-system, BlinkMacSystemFont, "Segoe UI Variable Display", "Segoe UI Variable", "Segoe UI", system-ui,
    "Hiragino Sans", "Noto Sans JP", "Yu Gothic UI", Meiryo, sans-serif;
  --font-jp: "Hiragino Sans", "Noto Sans JP", "Yu Gothic UI", Meiryo, -apple-system, "Segoe UI Variable Text", "Segoe UI", sans-serif;
  --font-mono: ui-monospace, "Cascadia Mono", Consolas, Menlo, monospace;
  --text-caption: 12px; --text-footnote: 13px; --text-body: 15px; --text-headline: 17px; --text-title2: 22px; --text-title1: 28px;

  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px; --space-5: 24px; --space-6: 32px;
  --radius-xs: 6px; --radius-s: 10px; --radius-m: 14px; --radius-l: 20px; --radius-pill: 999px;
  --corner: superellipse(1.6);

  --shade: light-dark(#0f1d24, #000000);
  --shadow-1: 0 0.5px 1px color-mix(in srgb, var(--shade) 10%, transparent), 0 1px 3px color-mix(in srgb, var(--shade) 6%, transparent);
  --shadow-2: 0 1px 2px color-mix(in srgb, var(--shade) 8%, transparent), 0 6px 16px color-mix(in srgb, var(--shade) 10%, transparent);
  --shadow-3: 0 0 0 0.5px light-dark(rgb(15 29 36 / 8%), rgb(0 0 0 / 50%)), 0 2px 6px light-dark(rgb(15 29 36 / 6%), rgb(0 0 0 / 20%)),
    0 12px 28px light-dark(rgb(15 29 36 / 12%), rgb(0 0 0 / 32%)), 0 32px 64px light-dark(rgb(15 29 36 / 10%), rgb(0 0 0 / 28%));
  --edge: inset 0 0 0 0.5px light-dark(rgb(255 255 255 / 60%), rgb(255 255 255 / 10%));

  --material: color-mix(in srgb, var(--card) 94%, transparent);
  --material-subs: color-mix(in srgb, var(--bg) 64%, transparent);
  --blur: blur(24px) saturate(180%);

  --switch-w: 46px; --switch-h: 28px;
  --ease: cubic-bezier(0.22, 1, 0.36, 1); --fast: 150ms; --normal: 200ms;
`;

// TOKENS on root, and the user preferences that change them: no motion, more contrast, and solid surfaces in place of glass.
export const tokensOn = (root: string) => `
  ${root} { ${TOKENS} }
  @media (prefers-reduced-motion: reduce) { ${root} { --fast: 0s; --normal: 0s; } }
  @media (prefers-contrast: more) { ${root} { --muted: color-mix(in srgb, var(--text) 80%, transparent);
    --line: color-mix(in srgb, var(--text) 45%, transparent); --separator: color-mix(in srgb, var(--text) 30%, transparent); } }
  @media (prefers-reduced-transparency: reduce) { ${root} { --material: var(--card); --material-subs: var(--bg); --blur: none; } }
`;

// The tokens on the root of a surface, in the theme that applyTheme() (src/shared/theme.ts) writes to its data-theme.
// Before applyTheme() runs, the surface follows the system.
export const themed = (root: string) => `
  ${tokensOn(root)}
  ${root} { color-scheme: light dark; }
  ${root}[data-theme="light"] { color-scheme: light; }
  ${root}[data-theme="dark"] { color-scheme: dark; }
`;

// The primary button (docs/design.md rule 3): the coral to amber gradient. Each surface gives the button its shape.
export const PRIMARY_BUTTON = `
  .primary { border-color: transparent; background: var(--brand); color: var(--on-brand); box-shadow: var(--shadow-1); }
  .primary:hover:not(:disabled) { filter: brightness(1.05) saturate(1.1); }
  .primary:active:not(:disabled) { filter: brightness(0.95); }
`;

// The declarations of frosted glass, for a surface that floats over content (docs/design.md rule 4).
export const GLASS = 'background: var(--material); backdrop-filter: var(--blur);';

// dist/theme.css: the tokens and the base rules of the extension pages. :where() gives the rules no specificity, so
// any rule of a page <style> wins over them. A ::before outside :where() adds the specificity of one element.
export const PAGE_CSS = `${themed(':root')}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: var(--text-body)/1.45 var(--font-ui);
  -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
[hidden] { display: none !important; }
p { margin: 0; }
:where(h1) { margin: 0; font: 700 var(--text-title2)/1.2 var(--font-display); letter-spacing: -.01em; }
:where(h2) { font-family: var(--font-display); }
:where(a) { color: var(--accent); }
:where(.muted) { color: var(--muted); font-size: var(--text-footnote); }
:where(.ok) { color: var(--ok); font-weight: 600; }
:where(.error) { color: var(--error); font-weight: 600; }
:where(.dot) { display: inline-block; width: 8px; height: 8px; margin-right: 6px; border-radius: 50%; vertical-align: 1px; }
:where(.column) { max-width: 760px; margin: 0 auto; padding: var(--space-6) var(--space-5) calc(2 * var(--space-6)); }
:where(:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
:where(button) { min-height: 40px; padding: 0 var(--space-4); border: 0; border-radius: var(--radius-pill); background: var(--raised);
  color: inherit; font: inherit; font-weight: 600; cursor: pointer; user-select: none;
  transition: background-color var(--fast) var(--ease), color var(--fast) var(--ease), filter var(--fast) var(--ease), scale var(--fast) var(--ease); }
:where(button:hover:not(:disabled)) { background: var(--accent-soft); }
:where(button:active:not(:disabled)) { scale: 0.97; }
:where(button:disabled) { cursor: default; opacity: .5; }
:where(select, textarea, input:is([type="text"], [type="number"], [type="search"])) { min-height: 36px; padding: 0 var(--space-3);
  border: 1px solid var(--line); border-radius: var(--radius-s); corner-shape: var(--corner); background: var(--field);
  color: inherit; font: inherit; transition: border-color var(--fast) var(--ease), box-shadow var(--fast) var(--ease); }
:where(textarea) { padding: var(--space-2) var(--space-3); }
:where(select:focus-visible, textarea:focus-visible, input:is([type="text"], [type="number"], [type="search"]):focus-visible) { outline: none;
  border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
:where(input[type="checkbox"], input[type="radio"], input[type="range"], progress) { accent-color: var(--accent-fill); }
:where(progress) { display: block; width: 100%; height: 6px; }
:where(input[type="checkbox"][role="switch"]) { appearance: none; position: relative; flex: none; width: var(--switch-w); height: var(--switch-h);
  margin: 0; border-radius: var(--radius-pill); background: var(--line); cursor: pointer; transition: background-color var(--normal) var(--ease); }
:where(input[type="checkbox"][role="switch"])::before { content: ""; position: absolute; top: 2px; left: 2px;
  width: calc(var(--switch-h) - 4px); height: calc(var(--switch-h) - 4px); border-radius: 50%; background: #fff;
  box-shadow: 0 1px 3px rgb(0 0 0 / 25%), 0 0 0 0.5px rgb(0 0 0 / 6%); transition: translate var(--normal) var(--ease); }
:where(input[type="checkbox"][role="switch"]:checked) { background: var(--accent-fill); }
:where(input[type="checkbox"][role="switch"]:checked)::before { translate: calc(var(--switch-w) - var(--switch-h)) 0; }
:where(.segmented) { display: inline-grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 2px; margin: 0; padding: 2px; border: 0;
  border-radius: var(--radius-s); corner-shape: var(--corner); background: var(--raised); }
:where(.segmented > label, .segmented > button) { position: relative; display: grid; place-items: center; min-height: 32px; padding: 0 var(--space-4);
  border-radius: calc(var(--radius-s) - 2px); corner-shape: var(--corner); background: none; color: var(--muted); font-size: var(--text-footnote);
  font-weight: 600; white-space: nowrap; cursor: pointer; transition: background-color var(--fast) var(--ease), color var(--fast) var(--ease); }
:where(.segmented > label:hover, .segmented > button:hover:not(:disabled)) { background: none; color: var(--text); }
:where(.segmented input) { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
:where(.segmented > label:has(input:checked), .segmented > button[aria-pressed="true"]) { background: var(--card); color: var(--text);
  opacity: 1; box-shadow: var(--shadow-1); }
:where(.segmented > label:has(input:focus-visible)) { outline: 2px solid var(--accent); outline-offset: 2px; }
:where(.group) { overflow: hidden; border-radius: var(--radius-m); corner-shape: var(--corner); background: var(--card); }
:where(.group > * + *, .group > .rows > li + li) { background: linear-gradient(var(--separator), var(--separator)) no-repeat var(--space-4) 0 / calc(100% - var(--space-4)) 1px; }
:where(kbd) { display: inline-block; min-width: 22px; padding: 0 var(--space-1); border: 1px solid var(--line); border-bottom-width: 2px;
  border-radius: var(--radius-xs); background: var(--field); font: 600 var(--text-caption)/18px var(--font-ui); text-align: center; }
${PRIMARY_BUTTON}`;
