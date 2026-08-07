import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '@catchbox/config';
import type { Db } from '@catchbox/db';
import type { ObjectStore } from '@catchbox/store';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';

export interface AppContext {
  cfg: AppConfig;
  db: Db;
  store: ObjectStore;
  redis: Redis;
  outboundQueue: Queue;
}

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  totpEnabled: boolean;
  theme: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
    ctx?: AppContext;
  }
}

export type App = FastifyInstance & { ctx: AppContext };
