// The design tokens of every Minerr surface (docs/design.md). light-dark() takes the value for the color-scheme
// of the element, so one declaration list serves both themes. Declare TOKENS on the root of a surface:
// :root of an extension page (dist/theme.css), the popup box, the subtitle layer.
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
