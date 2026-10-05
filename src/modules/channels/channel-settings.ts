import { randomBytes } from 'node:crypto';
import { z } from 'zod';

export const DEFAULT_ACCENT = '#2563eb';

/**
 * Website chat settings live in Channel.settings (JSON). Parsing with defaults
 * means a channel created before a field existed still reads correctly.
 */
export const webChatSettingsSchema = z.object({
  greeting: z.string().max(280).catch('Hi! How can we help?'),
  accentColor: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .catch(DEFAULT_ACCENT),
  /** Origins like "https://shop.example.com" or "https://*.example.com". Empty allows any site. */
  allowedOrigins: z.array(z.string()).catch([]),
  /** Ask for a name and email before the first message. */
  askForEmail: z.boolean().catch(true),
});

export type WebChatSettings = z.infer<typeof webChatSettingsSchema>;

export function readWebChatSettings(raw: unknown): WebChatSettings {
  return webChatSettingsSchema.parse(typeof raw === 'object' && raw !== null ? raw : {});
}

export function newPublicKey(): string {
  return `wk_${randomBytes(15).toString('base64url')}`;
}

/** "https://Shop.Example.com/" → "https://shop.example.com"; null when it is not an http(s) origin. */
export function normalizeOrigin(value: string): string | null {
  const wildcard = value.trim().match(/^(https?):\/\/\*\.(.+?)\/?$/i);
  if (wildcard) {
    const base = normalizeOrigin(`${wildcard[1]}://${wildcard[2]}`);
    return base && base.replace('://', '://*.');
  }
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function originAllowed(allowed: string[], origin: string | null): boolean {
  if (allowed.length === 0) return true;
  const actual = origin && normalizeOrigin(origin);
  if (!actual) return false;
  return allowed.some((rule) => {
    if (!rule.includes('://*.')) return rule === actual;
    const [scheme, host] = rule.split('://*.') as [string, string];
    const { protocol, hostname, port } = new URL(actual);
    const actualHost = port ? `${hostname}:${port}` : hostname;
    return protocol === `${scheme}:` && actualHost.endsWith(`.${host}`);
  });
}
