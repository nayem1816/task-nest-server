import { normalizeOrigin, originAllowed, readWebChatSettings } from './channel-settings.js';

describe('normalizeOrigin', () => {
  it.each([
    ['https://Shop.Example.com/', 'https://shop.example.com'],
    ['https://shop.example.com/checkout?x=1', 'https://shop.example.com'],
    ['http://localhost:5173', 'http://localhost:5173'],
    ['https://*.example.com', 'https://*.example.com'],
    ['ftp://example.com', null],
    ['example.com', null],
  ])('%s → %s', (input, expected) => {
    expect(normalizeOrigin(input)).toBe(expected);
  });
});

describe('originAllowed', () => {
  it('allows any site when the list is empty', () => {
    expect(originAllowed([], null)).toBe(true);
  });

  it('matches exact origins and subdomain wildcards, nothing looser', () => {
    const rules = ['https://northstarcoffee.co', 'https://*.northstarcoffee.co'];
    expect(originAllowed(rules, 'https://northstarcoffee.co')).toBe(true);
    expect(originAllowed(rules, 'https://shop.northstarcoffee.co')).toBe(true);
    expect(originAllowed(rules, 'http://shop.northstarcoffee.co')).toBe(false);
    expect(originAllowed(rules, 'https://evilnorthstarcoffee.co')).toBe(false);
    expect(originAllowed(rules, 'https://northstarcoffee.co.evil.io')).toBe(false);
    expect(originAllowed(rules, null)).toBe(false);
  });
});

describe('readWebChatSettings', () => {
  it('fills defaults and drops bad values instead of failing', () => {
    expect(readWebChatSettings({ greeting: 'Hello', accentColor: 'red' })).toEqual({
      greeting: 'Hello',
      accentColor: '#2563eb',
      allowedOrigins: [],
      askForEmail: true,
    });
    expect(readWebChatSettings(null).greeting).toBe('Hi! How can we help?');
  });
});
