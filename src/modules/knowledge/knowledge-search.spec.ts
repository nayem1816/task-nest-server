import { keywordQuery } from './knowledge-search.service.js';

describe('keywordQuery', () => {
  it.each([
    ['Where can I park?', 'park:*'],
    ['Do you ship to Canada?', 'ship:* | canada:*'],
    ['Where is order #10482', 'order:* | 10482:*'],
    ['UPS or USPS', 'ups | usps:*'],
    ['Is it?', ''],
    ["café's opening hours", 'cafés:* | opening:* | hours:*'],
  ])('%s → %s', (query, expected) => {
    expect(keywordQuery(query)).toBe(expected);
  });
});
