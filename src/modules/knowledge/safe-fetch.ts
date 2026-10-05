import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { BlockList, isIP } from 'node:net';
import { Agent, fetch } from 'undici';
import { ExtractionError } from './extract.js';

const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

/**
 * Addresses a public web page can never be on. Fetching a user-supplied URL
 * from the server would otherwise let anyone read our cloud metadata service,
 * Redis, or other machines on the private network (SSRF).
 */
const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  blocked.addSubnet(net, prefix, 'ipv6');
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  // IPv4 written as IPv6 (::ffff:10.0.0.1) is checked as the IPv4 it is.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return !blocked.check(mapped[1]!, 'ipv4');
  return !blocked.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

/**
 * The check runs at connect time, on the address actually dialled, for the
 * first request and every redirect. Checking the hostname up front instead
 * would lose to DNS that answers differently the second time.
 */
const guardedAgent = new Agent({
  connect: {
    lookup(hostname, options, callback) {
      dnsLookup(hostname, { ...options, all: true }, (err, addresses: LookupAddress[]) => {
        if (err) return callback(err, '', 4);
        const unsafe = addresses.find((a) => !isPublicAddress(a.address));
        if (unsafe || addresses.length === 0) {
          return callback(new ExtractionError(`${hostname} is not a public website.`), '', 4);
        }
        if ((options as { all?: boolean }).all) {
          return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, addresses);
        }
        callback(null, addresses[0]!.address, addresses[0]!.family);
      });
    },
  },
  headersTimeout: TIMEOUT_MS,
  bodyTimeout: TIMEOUT_MS,
});

export interface FetchedPage {
  url: string;
  contentType: string;
  body: string;
}

export async function fetchPublicPage(raw: string): Promise<FetchedPage> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ExtractionError('That is not a web address.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ExtractionError('Only http and https pages can be added.');
  }
  if (url.username || url.password) {
    throw new ExtractionError('Remove the username and password from the address.');
  }
  // An IP literal never goes through DNS, so the connect-time check would not see it.
  const literal = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(literal) && !isPublicAddress(literal)) {
    throw new ExtractionError(`${url.hostname} is not a public website.`);
  }

  let res: Awaited<ReturnType<typeof fetch>>;
  try {
    res = await fetch(url, {
      dispatcher: guardedAgent,
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'user-agent': 'TaskNestBot/1.0 (+knowledge base import)',
        accept: 'text/html,text/plain;q=0.9',
      },
    });
  } catch (err) {
    const cause = (err as { cause?: unknown }).cause;
    if (cause instanceof ExtractionError) throw cause;
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new ExtractionError('The page took too long to load.');
    }
    throw new ExtractionError('The page could not be reached.');
  }

  if (!res.ok) throw new ExtractionError(`The page answered with an error (${res.status}).`);
  const contentType = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  if (!['text/html', 'application/xhtml+xml', 'text/plain'].includes(contentType)) {
    throw new ExtractionError('That address is not a web page. Upload files on the File tab.');
  }

  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of res.body ?? []) {
    size += (chunk as Uint8Array).byteLength;
    if (size > MAX_BYTES) throw new ExtractionError('The page is larger than 2 MB.');
    chunks.push(chunk as Uint8Array);
  }
  return { url: res.url, contentType, body: Buffer.concat(chunks).toString('utf8') };
}
