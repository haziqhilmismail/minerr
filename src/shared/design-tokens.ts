// The design tokens of every Minerr surface (docs/design.md), and the shared CSS that reads them. light-dark() takes
// the value for the color-scheme of the element, so one declaration list serves both themes. Declare TOKENS on the
// root of a surface: :root of an extension page (dist/theme.css), the popup, the subtitle layer, the subtitle sidebar.
export const TOKENS = `
  --bg: light-dark(#f2f6f7, #0f1d24); --card: light-dark(#ffffff, #152730); --field: light-dark(#ffffff, #0f1d24);
  --text: light-dark(#0f1d24, #e7f2f1);
  --muted: color-mix(in srgb, var(--text) 64%, transparent);
  --raised: color-mix(in srgb, var(--text) 7%, transparent);
  --line: color-mix(in srgb, var(--text) 16%, transparent);
  --accent: light-dark(#0f766e, #2dd4bf); --accent-fill: light-dark(#14b8a6, #2dd4bf); --on-accent: #042f2e;
  --accent-soft: color-mix(in srgb, var(--accent-fill) 16%, transparent);
  --brand: linear-gradient(135deg, #ff6f61, #ffb238); --on-brand: #2a1208;
  --star: light-dark(#b26a00, #ffb238);
  --ok: light-dark(#1d7a36, #74d68f); --error: light-dark(#c22a2a, #ff8f8f); --warn: light-dark(#8f5600, #f2b65a);
  --shade: light-dark(#0f1d24, #000000);
  --shadow-1: 0 4px 5px color-mix(in srgb, var(--shade) 10%, transparent), 0 -0.5px 2px color-mix(in srgb, var(--shade) 6%, transparent);
  --shadow-2: 0 9px 20px color-mix(in srgb, var(--shade) 14%, transparent), 0 2px 6px color-mix(in srgb, var(--shade) 8%, transparent);
  --shadow-3: 0 50px 65px color-mix(in srgb, var(--shade) 17%, transparent), 0 12px 24px color-mix(in srgb, var(--shade) 12%, transparent);
  --radius-s: 8px; --radius-m: 16px; --radius-l: 24px; --radius-pill: 999px;
  --font-ui: Inter, "Noto Sans JP", "Hiragino Sans", "Yu Gothic UI", Meiryo, system-ui, sans-serif;
  --font-jp: "Noto Sans JP", "Hiragino Sans", "Yu Gothic UI", Meiryo, system-ui, sans-serif;
`;

// The tokens on the root of a surface, in the theme that applyTheme() (src/shared/theme.ts) writes to its data-theme.
// Before applyTheme() runs, the surface follows the system.
export const themed = (root: string) => `
  ${root} { color-scheme: light dark; ${TOKENS} }
  ${root}[data-theme="light"] { color-scheme: light; }
  ${root}[data-theme="dark"] { color-scheme: dark; }
`;

// The primary button (docs/design.md rule 3): the coral to amber gradient. Each surface gives the button its shape.
export const PRIMARY_BUTTON = `
  .primary { border-color: transparent; background: var(--brand); color: var(--on-brand); box-shadow: var(--shadow-1); }
  .primary:hover:not(:disabled) { filter: brightness(1.05) saturate(1.1); }
`;

// dist/theme.css: the tokens and the base rules of the extension pages. :where() gives the control rules no
// specificity, so any rule of a page <style> wins over them.
export const PAGE_CSS = `${themed(':root')}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.6 var(--font-ui); }
[hidden] { display: none !important; }
p { margin: 0; }
:where(:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
:where(button) { min-height: 36px; padding: 7px 18px; border: 1px solid var(--line); border-radius: var(--radius-pill); background: var(--card);
  color: inherit; font: inherit; font-weight: 700; cursor: pointer; }
:where(button:hover:not(:disabled)) { border-color: var(--accent); background: var(--accent-soft); }
:where(button:disabled) { cursor: progress; opacity: .6; }
:where(select, textarea, input:is([type="text"], [type="number"], [type="search"])) { padding: 7px 12px; border: 1px solid var(--line);
  border-radius: var(--radius-s); background: var(--field); color: inherit; font: inherit; }
${PRIMARY_BUTTON}`;
