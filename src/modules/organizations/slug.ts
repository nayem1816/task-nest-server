import { randomBytes } from 'node:crypto';

/** "Northstar Coffee Co." → "northstar-coffee-co" */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return slug || 'workspace';
}

/** Used when the plain slug is taken: "northstar-coffee-k3f9". */
export function withSuffix(slug: string): string {
  return `${slug}-${randomBytes(2).toString('hex')}`;
}
