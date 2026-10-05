import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Redis } from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';

/**
 * Socket.IO over a Redis pub/sub pair, so a broadcast or a forced disconnect
 * issued on one API instance reaches sockets held by the others.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly pub: Redis;
  private readonly sub: Redis;
  private readonly adapter: ReturnType<typeof createAdapter>;

  constructor(
    app: INestApplicationContext,
    redis: Redis,
    private readonly origins: string[],
    onError: (err: Error) => void,
  ) {
    super(app);
    // Subscribing takes a connection over, so the shared client cannot be used.
    this.pub = redis.duplicate();
    this.sub = redis.duplicate();
    this.pub.on('error', onError);
    this.sub.on('error', onError);
    this.adapter = createAdapter(this.pub, this.sub, { key: 'tasknest:realtime' });
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    // Nest always passes the gateway's options; the parameter is only optional
    // because the base signature says so.
    const server = super.createIOServer(port, {
      ...(options as ServerOptions),
      serveClient: false,
      cors: { origin: this.origins, credentials: true },
    });
    server.adapter(this.adapter);
    return server;
  }

  override async close(server: Server): Promise<void> {
    await super.close(server);
    await Promise.allSettled([this.pub.quit(), this.sub.quit()]);
  }
}
