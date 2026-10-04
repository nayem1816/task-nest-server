import request from 'supertest';
import { type TestApp, uniqueEmail } from './test-app.js';

export const PASSWORD = 'correct horse battery';

export interface Person {
  email: string;
  token: string;
}

/**
 * Builders for tests that need signed-up people, workspaces and members.
 * Everything goes through the public API, the same way a client would.
 */
export function workspaceHelpers(t: TestApp) {
  const http = () => request(t.app.getHttpServer());

  async function person(label: string, name = 'Jordan Ellis'): Promise<Person> {
    const email = uniqueEmail(label);
    const res = await http()
      .post('/api/v1/auth/signup')
      .send({ name, email, password: PASSWORD })
      .expect(201);
    return { email, token: res.body.accessToken as string };
  }

  async function workspace(owner: Person, name = 'E2E Northstar') {
    const res = await http()
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name, businessType: 'ecommerce', timezone: 'America/Chicago' })
      .expect(201);
    return res.body.id as string;
  }

  /** Request builders acting as `who` inside `orgId`. */
  const as = (who: Person, orgId: string) => {
    const authed = (req: request.Test) =>
      req.set('Authorization', `Bearer ${who.token}`).set('x-organization-id', orgId);
    return {
      get: (path: string) => authed(http().get(path)),
      post: (path: string) => authed(http().post(path)),
      patch: (path: string) => authed(http().patch(path)),
      put: (path: string) => authed(http().put(path)),
      delete: (path: string) => authed(http().delete(path)),
    };
  };

  async function roleId(who: Person, orgId: string, key: string): Promise<string> {
    const res = await as(who, orgId).get('/api/v1/roles').expect(200);
    return (res.body as { id: string; key: string }[]).find((r) => r.key === key)!.id;
  }

  /** Invites `invitee` as `role` and accepts on their behalf; returns their member id. */
  async function join(owner: Person, orgId: string, invitee: Person, role: string) {
    await as(owner, orgId)
      .post('/api/v1/invitations')
      .send({ email: invitee.email, roleId: await roleId(owner, orgId, role) })
      .expect(201);
    const token = t.outbox.lastToken(invitee.email, 'invitation');
    await http()
      .post('/api/v1/invitations/accept')
      .set('Authorization', `Bearer ${invitee.token}`)
      .send({ token })
      .expect(200);
    const members = await as(owner, orgId).get('/api/v1/members').expect(200);
    return (members.body as { id: string; user: { email: string } }[]).find(
      (m) => m.user.email === invitee.email,
    )!.id;
  }

  return { http, person, workspace, as, roleId, join };
}
