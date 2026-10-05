import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { OnEvent } from '@nestjs/event-emitter';
import { PinoLogger } from 'nestjs-pino';
import type { Server, Socket } from 'socket.io';
import {
  AccessEvents,
  type MemberChangedEvent,
  type SessionsRevokedEvent,
} from '../../common/events/access.events.js';
import { MemberStatus } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { AccessTokenService } from '../auth/access-token.service.js';
import { SessionService } from '../auth/session.service.js';
import {
  type ConversationUpdatedEvent,
  InboxEvents,
  type MessageCreatedEvent,
} from '../inbox/inbox.events.js';
import {
  type ClientToServerEvents,
  type RealtimeRejection,
  rooms,
  type ServerToClientEvents,
  type SocketData,
} from './realtime.contract.js';

type RealtimeServer = Server<ClientToServerEvents, ServerToClientEvents, object, SocketData>;
type RealtimeSocket = Socket<ClientToServerEvents, ServerToClientEvents, object, SocketData>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPING_MIN_INTERVAL_MS = 1_000;

class Rejection extends Error {
  readonly data: { code: RealtimeRejection };
  constructor(code: RealtimeRejection) {
    super(code);
    this.data = { code };
  }
}

/**
 * One connection per signed-in tab and workspace. The handshake does the same
 * checks as the HTTP guards (valid token, live session, active membership);
 * after that the connection is kept honest by closing it when the token runs
 * out, the session is revoked, or the member's access changes.
 */
@WebSocketGateway()
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() private readonly server?: RealtimeServer;

  private readonly expiryTimers = new WeakMap<RealtimeSocket, NodeJS.Timeout>();
  private readonly knownConversations = new WeakMap<RealtimeSocket, Set<string>>();
  private readonly lastTyping = new WeakMap<RealtimeSocket, number>();

  constructor(
    private readonly accessTokens: AccessTokenService,
    private readonly sessions: SessionService,
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {}

  afterInit(server: RealtimeServer): void {
    server.use((socket, next) => {
      this.authenticate(socket).then(
        () => next(),
        (err: unknown) => {
          if (err instanceof Rejection) return next(err);
          this.logger.error({ err }, 'Realtime handshake failed');
          next(new Error('Could not open the realtime connection.'));
        },
      );
    });
  }

  async handleConnection(socket: RealtimeSocket): Promise<void> {
    const { organizationId, sessionId, memberId, canReadInbox } = socket.data;
    await socket.join([
      rooms.organization(organizationId),
      rooms.session(sessionId),
      rooms.member(memberId),
      ...(canReadInbox ? [rooms.inbox(organizationId)] : []),
    ]);
    this.scheduleExpiry(socket);
  }

  handleDisconnect(socket: RealtimeSocket): void {
    clearTimeout(this.expiryTimers.get(socket));
  }

  @SubscribeMessage('auth.renew')
  async renew(
    @ConnectedSocket() socket: RealtimeSocket,
    @MessageBody() payload: unknown,
  ): Promise<{ ok: boolean }> {
    const token = isRecord(payload) && typeof payload.token === 'string' ? payload.token : null;
    const claims = token ? await this.accessTokens.verify(token) : null;
    // Only a token for the same session may extend it; anything else would
    // let one connection hop between users.
    if (
      !claims ||
      claims.sessionId !== socket.data.sessionId ||
      claims.userId !== socket.data.userId ||
      (await this.sessions.isAccessRevoked(claims.sessionId))
    ) {
      return { ok: false };
    }
    socket.data.expiresAt = claims.expiresAt;
    this.scheduleExpiry(socket);
    return { ok: true };
  }

  @SubscribeMessage('typing')
  async typing(
    @ConnectedSocket() socket: RealtimeSocket,
    @MessageBody() payload: unknown,
  ): Promise<void> {
    const conversationId =
      isRecord(payload) && typeof payload.conversationId === 'string'
        ? payload.conversationId
        : null;
    if (!conversationId || !UUID.test(conversationId) || !socket.data.canReadInbox) return;

    const now = Date.now();
    if (now - (this.lastTyping.get(socket) ?? 0) < TYPING_MIN_INTERVAL_MS) return;
    this.lastTyping.set(socket, now);

    if (!(await this.belongsToWorkspace(socket, conversationId))) return;
    socket.to(rooms.inbox(socket.data.organizationId)).emit('typing', {
      conversationId,
      memberId: socket.data.memberId,
      name: socket.data.name,
    });
  }

  @OnEvent(InboxEvents.messageCreated)
  onMessageCreated(event: MessageCreatedEvent): void {
    this.server?.to(rooms.inbox(event.organizationId)).emit('message.created', {
      conversationId: event.conversationId,
      messageId: event.messageId,
      internal: event.internal,
      sender: event.sender,
    });
  }

  @OnEvent(InboxEvents.conversationUpdated)
  onConversationUpdated(event: ConversationUpdatedEvent): void {
    this.server?.to(rooms.inbox(event.organizationId)).emit('conversation.updated', {
      conversationId: event.conversationId,
      changes: event.changes,
    });
  }

  @OnEvent(AccessEvents.sessionsRevoked)
  onSessionsRevoked(event: SessionsRevokedEvent): void {
    for (const id of event.sessionIds) this.server?.in(rooms.session(id)).disconnectSockets(true);
  }

  /** The client reconnects on its own, and the handshake re-reads role and status. */
  @OnEvent(AccessEvents.memberChanged)
  onMemberChanged(event: MemberChangedEvent): void {
    this.server?.in(rooms.member(event.memberId)).disconnectSockets(true);
  }

  private async authenticate(socket: RealtimeSocket): Promise<void> {
    const auth: unknown = socket.handshake.auth;
    const token = isRecord(auth) && typeof auth.token === 'string' ? auth.token : null;
    const organizationId =
      isRecord(auth) && typeof auth.organizationId === 'string' ? auth.organizationId : null;

    const claims = token ? await this.accessTokens.verify(token) : null;
    if (!claims) throw new Rejection('UNAUTHENTICATED');
    if (await this.sessions.isAccessRevoked(claims.sessionId)) {
      throw new Rejection('SESSION_EXPIRED');
    }
    if (!organizationId || !UUID.test(organizationId)) {
      throw new Rejection('ORGANIZATION_REQUIRED');
    }

    const member = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId: claims.userId } },
      select: {
        id: true,
        status: true,
        user: { select: { name: true } },
        role: { select: { permissions: true } },
        organization: { select: { deletedAt: true } },
      },
    });
    if (!member || member.organization.deletedAt || member.status !== MemberStatus.ACTIVE) {
      throw new Rejection('ORGANIZATION_ACCESS_DENIED');
    }

    socket.data = {
      userId: claims.userId,
      sessionId: claims.sessionId,
      organizationId,
      memberId: member.id,
      name: member.user.name,
      canReadInbox: member.role.permissions.includes('conversation.read'),
      expiresAt: claims.expiresAt,
    };
  }

  private scheduleExpiry(socket: RealtimeSocket): void {
    clearTimeout(this.expiryTimers.get(socket));
    const delay = Math.max(0, socket.data.expiresAt - Date.now());
    this.expiryTimers.set(
      socket,
      setTimeout(() => socket.disconnect(true), delay),
    );
  }

  private async belongsToWorkspace(socket: RealtimeSocket, conversationId: string) {
    let known = this.knownConversations.get(socket);
    if (known?.has(conversationId)) return true;

    const found = await this.prisma.conversation.findFirst({
      where: { id: conversationId, organizationId: socket.data.organizationId },
      select: { id: true },
    });
    if (!found) return false;
    if (!known) this.knownConversations.set(socket, (known = new Set()));
    known.add(conversationId);
    return true;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
