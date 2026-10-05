export interface Chunk {
  position: number;
  /** Heading path, e.g. "Shipping > International". */
  heading: string | null;
  content: string;
}

// About 600 tokens: long enough to hold a whole policy section, short enough
// that a search hit points at the part that matters.
const TARGET_CHARS = 2400;
const MAX_CHARS = 3200;
// Carried into the next chunk when a section is split, so a sentence that
// straddles the cut is still findable from either side.
const OVERLAP_CHARS = 300;

const HEADING = /^(#{1,6})\s+(.+?)\s*#*$/;

/**
 * Splits markdown-like text (what the extractors produce) into passages that
 * follow its structure: a chunk never mixes two sections, and each carries
 * the headings above it so "International" is searchable as "Shipping >
 * International".
 */
export function chunkText(text: string): Chunk[] {
  const sections = splitSections(text);
  const chunks: Chunk[] = [];
  for (const section of sections) {
    for (const content of packBlocks(section.blocks)) {
      chunks.push({ position: chunks.length, heading: section.heading, content });
    }
  }
  return chunks;
}

interface Section {
  heading: string | null;
  blocks: string[];
}

function splitSections(text: string): Section[] {
  const path: string[] = [];
  const sections: Section[] = [];
  let current: Section = { heading: null, blocks: [] };
  let paragraph: string[] = [];

  const flushParagraph = () => {
    const block = paragraph.join('\n').trim();
    if (block) current.blocks.push(block);
    paragraph = [];
  };

  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const heading = HEADING.exec(line.trim());
    if (heading) {
      flushParagraph();
      if (current.blocks.length > 0) sections.push(current);
      const level = heading[1]!.length;
      path.length = Math.min(path.length, level - 1);
      path[level - 1] = heading[2]!;
      current = { heading: path.filter(Boolean).join(' > '), blocks: [] };
    } else if (line.trim() === '') {
      flushParagraph();
    } else {
      paragraph.push(line.trimEnd());
    }
  }
  flushParagraph();
  if (current.blocks.length > 0) sections.push(current);
  return sections;
}

function packBlocks(blocks: string[]): string[] {
  const pieces = blocks.flatMap((b) => (b.length > MAX_CHARS ? splitLong(b) : [b]));
  const out: string[] = [];
  let current = '';
  for (const piece of pieces) {
    if (current && current.length + piece.length + 2 > TARGET_CHARS) {
      out.push(current);
      current = `${tail(current)}\n\n${piece}`.trim();
    } else {
      current = current ? `${current}\n\n${piece}` : piece;
    }
  }
  if (current) out.push(current);
  return out;
}

/** A block with no paragraph breaks: cut at sentence ends, then at spaces. */
function splitLong(block: string): string[] {
  const sentences = block.match(/[^.!?\n]+(?:[.!?]+|\n|$)\s*/g) ?? [block];
  const out: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if (sentence.length > MAX_CHARS) {
      if (current) out.push(current.trim());
      current = '';
      for (let i = 0; i < sentence.length; i += TARGET_CHARS) {
        out.push(sentence.slice(i, i + TARGET_CHARS).trim());
      }
    } else if (current.length + sentence.length > TARGET_CHARS) {
      out.push(current.trim());
      current = sentence;
    } else {
      current += sentence;
    }
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

/** The last ~OVERLAP_CHARS of a chunk, starting at a word boundary. */
function tail(text: string): string {
  if (text.length <= OVERLAP_CHARS) return text;
  const slice = text.slice(-OVERLAP_CHARS);
  const space = slice.indexOf(' ');
  return space === -1 ? slice : slice.slice(space + 1);
}
