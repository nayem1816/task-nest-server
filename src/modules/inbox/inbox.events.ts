/**
 * Emitted after the change is committed. The realtime gateway forwards them to
 * the workspace's connected clients; other domains (automation, analytics) can
 * subscribe without the inbox knowing about them.
 */
export const InboxEvents = {
  messageCreated: 'inbox.message.created',
  conversationUpdated: 'inbox.conversation.updated',
} as const;

export interface MessageCreatedEvent {
  organizationId: string;
  conversationId: string;
  messageId: string;
  /** Internal notes must never reach the customer-facing side. */
  internal: boolean;
  sender: 'CONTACT' | 'MEMBER' | 'AI' | 'SYSTEM';
}

export interface ConversationUpdatedEvent {
  organizationId: string;
  conversationId: string;
  /** What changed, so listeners can skip work they do not care about. */
  changes: ('status' | 'assignee' | 'priority' | 'tags' | 'handler' | 'created')[];
}
