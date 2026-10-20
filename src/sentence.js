// Sentence ends: 。！？ (full and half width) and line breaks. Closing quotes stay with their sentence.
const BOUNDARY = /(?<=[。｡！!？?\n][」』）)〉］\]]*)/;
const TAIL = /^[^。｡！!？?\n]*[。｡！!？?]*[」』）)〉］\]]*/;
const MAX_SIDE = 150;

const tidy = text => text.replace(/\s+/g, ' ');

// before/after are the block's text on each side of the word; returns the sentence that contains the word.
export function sentenceAround(before, word, after) {
  const start = tidy(before.split(BOUNDARY).at(-1)).slice(-MAX_SIDE).trimStart();
  const end = tidy(after.match(TAIL)[0]).slice(0, MAX_SIDE).trimEnd();
  return { start, word, end };
}
