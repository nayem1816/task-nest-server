/**
 * The wire contract between the gateway and the web app. Events carry ids, not
 * records: the client refetches through the REST API, which applies the same
 * permission checks as everywhere else, so nothing here can leak a field the
 * HTTP layer would have hidden.
 */
export interface ServerToClientEvents {
  'message.created': (event: {
    conversationId: string;
    messageId: string;
    internal: boolean;
    sender: 'CONTACT' | 'MEMBER' | 'AI' | 'SYSTEM';
  }) => void;
  'conversation.updated': (event: { conversationId: string; changes: string[] }) => void;
  typing: (event: { conversationId: string; memberId: string; name: string }) => void;
  'knowledge.source.updated': (event: { sourceId: string; status: string }) => void;
}

export interface ClientToServerEvents {
  /** Hands the connection a fresh access token so it is not closed at expiry. */
  'auth.renew': (payload: { token: string }, ack: (result: { ok: boolean }) => void) => void;
  typing: (payload: { conversationId: string }) => void;
}

/** Codes sent with a rejected handshake (`connect_error` → `err.data.code`). */
export type RealtimeRejection =
  'UNAUTHENTICATED' | 'SESSION_EXPIRED' | 'ORGANIZATION_REQUIRED' | 'ORGANIZATION_ACCESS_DENIED';

export interface SocketData {
  userId: string;
  sessionId: string;
  organizationId: string;
  memberId: string;
  name: string;
  canReadInbox: boolean;
  expiresAt: number;
}

export const rooms = {
  organization: (id: string) => `org:${id}`,
  inbox: (organizationId: string) => `inbox:${organizationId}`,
  session: (id: string) => `session:${id}`,
  member: (id: string) => `member:${id}`,
};
