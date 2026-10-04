import { ALL_PERMISSIONS, isPermission } from './permissions.js';
import { SYSTEM_ROLES } from './system-roles.js';

const role = (key: string) => {
  const found = SYSTEM_ROLES.find((r) => r.key === key);
  if (!found) throw new Error(`missing role ${key}`);
  return found;
};

describe('system roles', () => {
  it('only reference permissions from the catalog', () => {
    for (const { key, permissions } of SYSTEM_ROLES) {
      const unknown = permissions.filter((p) => !isPermission(p));
      expect(unknown, key).toEqual([]);
    }
  });

  it('never list a permission twice', () => {
    for (const { key, permissions } of SYSTEM_ROLES) {
      expect(new Set(permissions).size, key).toBe(permissions.length);
    }
  });

  it('give the owner every permission', () => {
    expect([...role('owner').permissions].sort()).toEqual([...ALL_PERMISSIONS].sort());
  });

  it('keep billing with the owner only', () => {
    const withBilling = SYSTEM_ROLES.filter((r) => r.permissions.includes('billing.manage'));
    expect(withBilling.map((r) => r.key)).toEqual(['owner']);
  });

  it('give the viewer no write access', () => {
    const writes = role('viewer').permissions.filter((p) => !/\.(read|view)$/.test(p));
    expect(writes).toEqual([]);
  });

  it('do not let agents or sales manage the team or delete data', () => {
    for (const key of ['agent', 'sales']) {
      const perms = role(key).permissions;
      expect(perms).not.toContain('team.manage');
      expect(perms.filter((p) => p.endsWith('.delete'))).toEqual([]);
    }
  });
});
