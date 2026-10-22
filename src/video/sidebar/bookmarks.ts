// The bookmarked lines of each video, by the start times of the lines, in chrome.storage.local under bm:<video id>.
// The B key in the tab (src/video/video.ts) and the ★ of a card in the side panel both change them; the panel follows the storage.
const PREFIX = 'bm:';
const keyOf = (id: string) => PREFIX + id;

const starts = (value: unknown): Set<number> => new Set(Array.isArray(value) ? value.filter((start): start is number => typeof start === 'number') : []);

export async function getBookmarks(id: string): Promise<Set<number>> {
  return starts((await chrome.storage.local.get(keyOf(id)))[keyOf(id)]);
}

// Bookmarks the line that starts at start, or removes its bookmark, and gives the text that tells the user which.
export async function toggleBookmark(id: string, start: number): Promise<string> {
  const marks = await getBookmarks(id);
  if (!marks.delete(start)) marks.add(start);
  await chrome.storage.local.set({ [keyOf(id)]: [...marks] });
  return marks.has(start) ? 'Bookmarked the line.' : 'Removed the bookmark.';
}

// Calls listener with the bookmarks of a video each time they change, from any tab or page.
export function onBookmarksChange(listener: (id: string, marks: Set<number>) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    for (const [key, change] of Object.entries(changes)) if (key.startsWith(PREFIX)) listener(key.slice(PREFIX.length), starts(change.newValue));
  });
}
