// The element with this id on an extension page. The pages are static, so a missing element is a bug.
export function byId<T extends HTMLElement>(id: string, type: new () => T): T {
  const element = document.getElementById(id);
  if (!(element instanceof type)) throw new Error(`The page has no #${id} of the expected type`);
  return element;
}
