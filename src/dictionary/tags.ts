// Chip color per Yomitan tag category. A category that is not here (JMdict '' and the categories
// of other dictionaries) gets the default color. White text on each color has a contrast of 4.5:1 or more.
const TAG_COLORS = {
  popular: '#b45309',
  frequent: '#15803d',
  partOfSpeech: '#2557c7',
  archaism: '#737373',
  name: '#7e3fb8',
  expression: '#0f766e',
};
const DEFAULT_COLOR = '#565b6b';

export const tagClass = (category: string): string => (Object.hasOwn(TAG_COLORS, category) ? `tag tag-${category}` : 'tag');

// Sizes are in em, so the chips fit the popup and the Anki card.
export const TAG_CSS = `
.tag { display: inline-block; padding: 0 .4em; border-radius: .3em; background: ${DEFAULT_COLOR}; color: #fff;
  font: 600 .75em/1.6 system-ui, sans-serif; white-space: nowrap; vertical-align: .1em; cursor: help; }
${Object.entries(TAG_COLORS).map(([category, color]) => `.tag-${category} { background: ${color}; }`).join('\n')}
`;
