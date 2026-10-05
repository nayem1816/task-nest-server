import { type HTMLElement, type Node, NodeType, parse } from 'node-html-parser';

export interface Extracted {
  title: string | null;
  /** Markdown-like text: "#" headings, "- " list items, blank lines between blocks. */
  text: string;
}

export const SUPPORTED_FILE_TYPES: Record<string, string> = {
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word',
  'text/plain': 'Text',
  'text/markdown': 'Markdown',
  'text/html': 'HTML',
};

/** Thrown when a file or page has nothing usable in it; the message is shown to the user. */
export class ExtractionError extends Error {}

export async function extractFile(buffer: Buffer, mimeType: string): Promise<Extracted> {
  switch (mimeType) {
    case 'application/pdf':
      return { title: null, text: await pdfText(buffer) };
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
      const mammoth = await import('mammoth');
      // Through HTML rather than raw text, so the document's headings survive.
      const { value } = await mammoth.convertToHtml({ buffer });
      return { title: null, text: htmlToText(value).text };
    }
    case 'text/html':
      return htmlToText(buffer.toString('utf8'));
    case 'text/plain':
    case 'text/markdown':
      return { title: null, text: buffer.toString('utf8') };
    default:
      throw new ExtractionError('That file type is not supported.');
  }
}

async function pdfText(buffer: Buffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = (Array.isArray(text) ? text : [text]).map((p) => p.trim()).filter(Boolean);
  if (pages.length === 0) {
    throw new ExtractionError(
      'No text found in this PDF. It may be a scan; upload a text version instead.',
    );
  }
  return pages.join('\n\n');
}

const DROP =
  'script, style, noscript, template, svg, canvas, iframe, form, nav, header, footer, aside';
const BLOCK = new Set([
  'p',
  'div',
  'section',
  'article',
  'main',
  'ul',
  'ol',
  'table',
  'thead',
  'tbody',
  'tr',
  'blockquote',
  'pre',
  'dl',
  'dt',
  'dd',
  'figure',
  'figcaption',
  'details',
  'summary',
  'body',
  'hr',
]);

/**
 * Turns a page into the text a customer would read: the main content, its
 * headings and lists, without menus, footers, scripts or cookie banners.
 */
export function htmlToText(html: string): Extracted {
  const root = parse(html, { comment: false });
  const title =
    root.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim() ||
    root.querySelector('title')?.text.trim() ||
    null;

  for (const node of root.querySelectorAll(DROP)) node.remove();
  for (const node of root.querySelectorAll(
    '[aria-hidden="true"], [hidden], .cookie, #cookie-banner',
  )) {
    node.remove();
  }
  const main =
    root.querySelector('main') ??
    root.querySelector('article') ??
    root.querySelector('body') ??
    root;

  const lines: string[] = [];
  let inline = '';
  const flush = () => {
    const text = inline.replace(/\s+/g, ' ').trim();
    if (text) lines.push(text, '');
    inline = '';
  };

  const walk = (node: Node) => {
    if (node.nodeType === NodeType.TEXT_NODE) {
      inline += node.text;
      return;
    }
    if (node.nodeType !== NodeType.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const tag = el.tagName?.toLowerCase() ?? '';
    const heading = /^h([1-6])$/.exec(tag);
    if (heading) {
      flush();
      const text = el.text.replace(/\s+/g, ' ').trim();
      if (text) lines.push(`${'#'.repeat(Number(heading[1]))} ${text}`, '');
    } else if (tag === 'li') {
      flush();
      const text = el.text.replace(/\s+/g, ' ').trim();
      if (text) lines.push(`- ${text}`);
    } else if (tag === 'br') {
      inline += '\n';
    } else if (tag === 'td' || tag === 'th') {
      inline += ` ${el.text.replace(/\s+/g, ' ').trim()} |`;
    } else if (BLOCK.has(tag)) {
      flush();
      for (const child of el.childNodes) walk(child);
      flush();
    } else {
      for (const child of el.childNodes) walk(child);
    }
  };
  walk(main);
  flush();

  const text = lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { title, text };
}
