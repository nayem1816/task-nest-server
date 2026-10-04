import { slugify, withSuffix } from './slug.js';

describe('slugify', () => {
  it.each([
    ['Northstar Coffee', 'northstar-coffee'],
    ['  UrbanNest & Co. ', 'urbannest-co'],
    ['Café Lumière', 'cafe-lumiere'],
    ['!!!', 'workspace'],
    ['A'.repeat(60), 'a'.repeat(40)],
  ])('%s → %s', (name, expected) => {
    expect(slugify(name)).toBe(expected);
  });

  it('never ends in a dash after truncation', () => {
    expect(slugify(`${'a'.repeat(39)} b`)).toBe('a'.repeat(39));
  });
});

describe('withSuffix', () => {
  it('appends a short hex suffix', () => {
    expect(withSuffix('northstar-coffee')).toMatch(/^northstar-coffee-[0-9a-f]{4}$/);
  });
});
