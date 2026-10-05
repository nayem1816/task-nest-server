/**
 * Emitted when someone loses (or may have lost) access. Long-lived connections
 * such as the realtime gateway listen for these, because a check made when the
 * connection opened is not re-run for every message pushed down it.
 */
export const AccessEvents = {
  sessionsRevoked: 'access.sessions.revoked',
  memberChanged: 'access.member.changed',
} as const;

export interface SessionsRevokedEvent {
  sessionIds: string[];
}

/** Role change, disable or removal: anything that alters what the member may see. */
export interface MemberChangedEvent {
  organizationId: string;
  memberId: string;
}
