// The element with this id on an extension page. The pages are static, so a missing element is a bug.
export function byId<T extends HTMLElement>(id: string, type: new () => T): T {
  const element = document.getElementById(id);
  if (!(element instanceof type)) throw new Error(`The page has no #${id} of the expected type`);
  return element;
}

// The nearest ancestor-or-self of element that is not inline: the block that holds a sentence.
// cache keeps the answer for each element that the walk visits, for callers that ask for many elements.
export function blockOf(element: Element, cache = new Map<Element, Element>()): Element {
  const known = cache.get(element);
  if (known) return known;
  const parent = element.parentElement;
  const block = parent && /^(inline|contents)/.test(getComputedStyle(element).display) ? blockOf(parent, cache) : element;
  cache.set(element, block);
  return block;
}
