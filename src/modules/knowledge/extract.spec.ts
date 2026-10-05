import { extractFile, htmlToText } from './extract.js';
import { fetchPublicPage, isPublicAddress } from './safe-fetch.js';

describe('htmlToText', () => {
  it('keeps the main content with headings and lists, and drops the chrome', () => {
    const { title, text } = htmlToText(`
      <html><head><title>Shipping | Northstar</title><style>p{}</style></head>
      <body>
        <nav><a href="/">Home</a> <a href="/shop">Shop</a></nav>
        <main>
          <h1>Shipping</h1>
          <p>Orders leave within <strong>2 business days</strong>.</p>
          <h2>Carriers</h2>
          <ul><li>UPS Ground</li><li>USPS Priority</li></ul>
          <p>Questions?&nbsp;Email us.</p>
          <script>track()</script>
        </main>
        <footer>© Northstar Coffee</footer>
      </body></html>`);

    expect(title).toBe('Shipping | Northstar');
    expect(text).toBe(
      [
        '# Shipping',
        '',
        'Orders leave within 2 business days.',
        '',
        '## Carriers',
        '',
        '- UPS Ground',
        '- USPS Priority',
        'Questions? Email us.',
      ].join('\n'),
    );
  });
});

describe('extractFile', () => {
  it('reads plain text and markdown as they are', async () => {
    const res = await extractFile(Buffer.from('# Returns\n\n30 days.'), 'text/markdown');
    expect(res.text).toBe('# Returns\n\n30 days.');
  });

  it('refuses types it cannot read', async () => {
    await expect(extractFile(Buffer.from('x'), 'image/png')).rejects.toThrow('not supported');
  });
});

describe('isPublicAddress', () => {
  it.each([
    ['93.184.215.14', true],
    ['2606:4700::6810:85e5', true],
    ['127.0.0.1', false],
    ['10.1.2.3', false],
    ['172.20.0.5', false],
    ['192.168.1.1', false],
    ['169.254.169.254', false],
    ['100.64.0.1', false],
    ['0.0.0.0', false],
    ['::1', false],
    ['fd00::1', false],
    ['fe80::1', false],
    ['::ffff:10.0.0.1', false],
    ['not-an-ip', false],
  ])('%s → %s', (address, expected) => {
    expect(isPublicAddress(address)).toBe(expected);
  });
});

describe('fetchPublicPage', () => {
  it.each([
    ['http://127.0.0.1:4100/api', 'not a public website'],
    ['http://[::1]/', 'not a public website'],
    ['http://169.254.169.254/latest/meta-data/', 'not a public website'],
    ['http://localhost:6380/', 'not a public website'],
    ['file:///etc/passwd', 'Only http and https'],
    ['https://user:pass@example.com/', 'username and password'],
    ['not a url', 'not a web address'],
  ])('refuses %s', async (url, message) => {
    await expect(fetchPublicPage(url)).rejects.toThrow(message);
  });
});
