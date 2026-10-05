import { chunkText } from './chunk.js';

describe('chunkText', () => {
  it('keeps sections apart and labels each chunk with its heading path', () => {
    const chunks = chunkText(
      [
        'Northstar ships from Austin.',
        '# Shipping',
        'Orders leave within 2 business days.',
        '## International',
        'We ship to Canada and the UK.',
        '# Returns',
        'Unopened bags can be returned within 30 days.',
      ].join('\n'),
    );
    expect(chunks.map((c) => [c.heading, c.content])).toEqual([
      [null, 'Northstar ships from Austin.'],
      ['Shipping', 'Orders leave within 2 business days.'],
      ['Shipping > International', 'We ship to Canada and the UK.'],
      ['Returns', 'Unopened bags can be returned within 30 days.'],
    ]);
    expect(chunks.map((c) => c.position)).toEqual([0, 1, 2, 3]);
  });

  it('splits a long section with overlap and never exceeds the size limit', () => {
    const paragraph = (n: number) => `Paragraph ${n}. ${'Coffee is roasted to order. '.repeat(20)}`;
    const chunks = chunkText(
      ['# Guide', ...Array.from({ length: 12 }, (_, i) => paragraph(i))].join('\n\n'),
    );

    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) {
      expect(c.heading).toBe('Guide');
      expect(c.content.length).toBeLessThanOrEqual(3200);
    }
    // The end of one chunk reappears at the start of the next.
    const lastWords = chunks[0]!.content.slice(-60);
    expect(chunks[1]!.content).toContain(lastWords.slice(lastWords.indexOf(' ') + 1));
  });

  it('cuts a wall of text without paragraph breaks', () => {
    const wall = 'Our cold brew is steeped for 18 hours. '.repeat(300);
    const chunks = chunkText(wall);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.every((c) => c.content.length <= 3200)).toBe(true);
  });

  it('returns nothing for blank input', () => {
    expect(chunkText('  \n\n  ')).toEqual([]);
  });
});
