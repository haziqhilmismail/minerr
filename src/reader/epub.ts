// Reads the text of an EPUB file: META-INF/container.xml -> the package (OPF) -> the spine -> the XHTML of each chapter.
// The file is untrusted. The chapters are new DOM nodes from an allowlist of tags, without attributes, so no script,
// style, link, or event handler of the file reaches the page.
import { zipPath } from './book.ts';
import { type Bytes, unzip, type ZipMembers } from '../dictionary/zip.ts';

export interface Chapter {
  title: string;
  content: DocumentFragment;
}

export interface Book {
  title: string;
  chapters: Chapter[];
}

const KEEP = new Set([
  'p', 'div', 'section', 'article', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li',
  'br', 'hr', 'em', 'strong', 'b', 'i', 'span', 'small', 'sub', 'sup', 'ruby', 'rb', 'table', 'tbody', 'thead', 'tr', 'td', 'th',
]);
// Elements whose content is not text of the book. Other elements (a, font, unknown tags) keep only their content.
const DROP = new Set(['head', 'script', 'style', 'noscript', 'template', 'iframe', 'object', 'embed', 'svg', 'math', 'rp', 'img', 'video', 'audio']);
const HTML_TYPES = new Set(['application/xhtml+xml', 'text/html']);

// The reading of ruby goes in an attribute that CSS shows (rt::before), so the words of the page and the card sentence get only the base text.
function sanitize(source: Node, into: Node): void {
  for (const node of source.childNodes) {
    if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) {
      into.appendChild(document.createTextNode(node.textContent ?? ''));
      continue;
    }
    if (!(node instanceof Element)) continue;
    const tag = node.localName.toLowerCase();
    if (DROP.has(tag)) continue;
    if (tag === 'rt') {
      const rt = document.createElement('rt');
      rt.dataset.rt = node.textContent ?? '';
      into.appendChild(rt);
    } else if (KEEP.has(tag)) {
      const copy = document.createElement(tag);
      sanitize(node, copy);
      into.appendChild(copy);
    } else {
      sanitize(node, into);
    }
  }
}

async function readText(members: ZipMembers, path: string): Promise<string> {
  const read = members.get(path);
  if (!read) throw new Error(`The EPUB file has no ${path}.`);
  return new TextDecoder().decode(await read());
}

function parseXml(text: string, path: string): Document {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error(`The EPUB file has a damaged ${path}.`);
  return doc;
}

const byTag = (root: Document | Element, tag: string) => [...root.getElementsByTagNameNS('*', tag)];

// A chapter that is not well-formed XML often is HTML; the HTML parser reads it.
function parseChapter(text: string): Document {
  const doc = new DOMParser().parseFromString(text, 'application/xhtml+xml');
  return doc.querySelector('parsererror') ? new DOMParser().parseFromString(text, 'text/html') : doc;
}

export async function readEpub(bytes: Bytes, fallbackTitle: string): Promise<Book> {
  const members = unzip(bytes);
  const container = parseXml(await readText(members, 'META-INF/container.xml'), 'META-INF/container.xml');
  const opfPath = byTag(container, 'rootfile')[0]?.getAttribute('full-path');
  if (!opfPath) throw new Error('The EPUB file names no package file in META-INF/container.xml.');
  const opf = parseXml(await readText(members, opfPath), opfPath);
  const items = new Map(byTag(opf, 'item').map(item => [item.getAttribute('id'), item]));
  const chapters: Chapter[] = [];
  for (const ref of byTag(opf, 'itemref')) {
    const item = items.get(ref.getAttribute('idref'));
    const href = item?.getAttribute('href');
    if (!href || !HTML_TYPES.has(item?.getAttribute('media-type') ?? '')) continue;
    // A missing chapter or a bad link (a raw % in the href) drops only that chapter.
    let doc: Document;
    try {
      doc = parseChapter(await readText(members, zipPath(opfPath, href)));
    } catch {
      continue;
    }
    const body = byTag(doc, 'body')[0];
    if (!body?.textContent?.trim()) continue;
    const content = document.createDocumentFragment();
    sanitize(body, content);
    const heading = content.querySelector('h1, h2, h3, h4, h5, h6')?.textContent?.trim();
    chapters.push({ title: heading || `Section ${chapters.length + 1}`, content });
  }
  if (!chapters.length) throw new Error('The EPUB file has no chapter with text.');
  return { title: byTag(opf, 'title')[0]?.textContent?.trim() || fallbackTitle, chapters };
}
