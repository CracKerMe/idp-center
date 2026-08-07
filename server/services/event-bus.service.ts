import crypto from 'crypto';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { Counter, register } from 'prom-client';

// ── Event Types ────────────────────────────────────────────────────────────

export type EventType =
  | 'auth.login.success'
  | 'auth.login.fail'
  | 'auth.login.blocked'
  | 'auth.logout'
  | 'auth.password.change'
  | 'auth.password.reset'
  | 'mfa.enroll'
  | 'mfa.challenge'
  | 'mfa.verify.success'
  | 'mfa.verify.fail'
  | 'mfa.recovery.used'
  | 'token.issued'
  | 'token.refreshed'
  | 'token.revoked'
  | 'token.introspected'
  | 'session.created'
  | 'session.terminated'
  | 'session.risk.elevated'
  | 'user.created'
  | 'user.updated'
  | 'user.role.changed'
  | 'user.group.changed'
  | 'user.deactivated'
  | 'client.created'
  | 'client.updated'
  | 'risk.scored'
  | 'risk.policy.matched'
  | 'risk.alert.triggered'
  | 'system.key.rotated'
  | 'system.job.completed'
  | 'system.health.degraded';

export interface DomainEvent {
  id: string;
  type: EventType;
  tenantId: string;
  userId?: string;
  clientId?: string;
  timestamp: Date;
  payload: Record<string, unknown>;
  metadata?: {
    ip?: string;
    userAgent?: string;
    requestId?: string;
    sessionId?: string;
  };
}

// ── Event Bus ──────────────────────────────────────────────────────────────

type EventHandler = (event: DomainEvent) => Promise<void>;

const STREAM_KEY = config.EVENT_STREAM_KEY ?? 'idp:events';
const DLQ_KEY = 'idp:events:dlq';
const MAX_STREAM_LEN = config.EVENT_STREAM_MAXLEN ?? 100_000;
const CONSUMER_GROUP = config.EVENT_CONSUMER_GROUP ?? 'idp-workers';

// ── Prometheus Metrics (§2.1 requirement) ─────────────────────────────────

const eventsPublished = new Counter({
  name: 'event_bus_publish_total',
  help: 'Total events published to the event bus',
  labelNames: ['type', 'tenant_id'],
});

const eventsConsumed = new Counter({
  name: 'event_bus_consume_total',
  help: 'Total events consumed from the event bus',
  labelNames: ['type', 'consumer'],
});

const eventsFailed = new Counter({
  name: 'event_bus_failed_total',
  help: 'Total events that failed processing',
  labelNames: ['type', 'error_type'],
});

const eventsDlq = new Counter({
  name: 'event_bus_dlq_total',
  help: 'Total events moved to dead letter queue',
});

class EventBus {
  private handlers = new Map<EventType, EventHandler[]>();
  private globalHandlers: EventHandler[] = [];
  private redis: any = null;
  private redisReady = false;
  private initPromise: Promise<void> | null = null;
  private consumerRunning = false;
  private consumerName = `${process.env.HOSTNAME ?? 'local'}-${process.pid}`;

  /** Register a handler for a specific event type */
  on(type: EventType, handler: EventHandler): void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler);
    this.handlers.set(type, list);
  }

  /** Register a handler for all events */
  onAll(handler: EventHandler): void {
    this.globalHandlers.push(handler);
  }

  /** Emit an event — local dispatch + optional Redis Stream publish */
  async emit(event: DomainEvent): Promise<void> {
    // Track publish metric
    eventsPublished.inc({ type: event.type, tenant_id: event.tenantId });

    // 1. Local dispatch — always run. The consumer skips events whose origin
    //    matches this consumerName, so cross-instance dedup is preserved.
    //    Without this, a single instance with Redis configured would never
    //    process its own events (both emit and consumer skip each other).
    await this.dispatchLocal(event);

    // 2. Redis Stream publish (if available)
    if (this.redisReady && this.redis) {
      try {
        await this.redis.xadd(
          STREAM_KEY,
          'MAXLEN', '~', String(MAX_STREAM_LEN),
          '*',
          'id', event.id,
          'type', event.type,
          'tenantId', event.tenantId,
          'userId', event.userId ?? '',
          'clientId', event.clientId ?? '',
          'timestamp', event.timestamp.toISOString(),
          'payload', JSON.stringify(event.payload),
          'metadata', JSON.stringify(event.metadata ?? {}),
          'origin', this.consumerName,
        );
      } catch (err: any) {
        logger.warn(`EventBus Redis publish failed: ${err.message}`);
        // No fallback dispatch needed — local dispatch already ran above.
        // Re-dispatching here would duplicate handlers when Redis is flaky.
      }
    }
  }

  /** Dispatch event to registered local handlers */
  private async dispatchLocal(event: DomainEvent): Promise<void> {
    const typedHandlers = this.handlers.get(event.type) ?? [];
    const allHandlers = [...typedHandlers, ...this.globalHandlers];
    for (const handler of allHandlers) {
      try {
        await handler(event);
      } catch (err: any) {
        logger.error(`EventBus handler error for ${event.type}: ${err.message}`, { eventId: event.id });
      }
    }
  }

  /** Create a convenience emitter that fills common fields */
  createEmitter(req?: { tenantId?: string; ip?: string; requestId?: string }) {
    return async (type: EventType, payload: Record<string, unknown>, opts?: {
      userId?: string;
      clientId?: string;
    }) => {
      await this.emit({
        id: crypto.randomUUID(),
        type,
        tenantId: req?.tenantId ?? 'default',
        userId: opts?.userId,
        clientId: opts?.clientId,
        timestamp: new Date(),
        payload,
        metadata: {
          ip: req?.ip,
          requestId: req?.requestId,
        },
      });
    };
  }

  /** Initialize Redis connection for cross-process events */
  async init(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._initRedis();
    return this.initPromise;
  }

  private async _initRedis(): Promise<void> {
    if (!config.REDIS_URL) {
      logger.info('EventBus: REDIS_URL not set, running in-process only');
      return;
    }

    try {
      const IORedis = (await import('ioredis')).default as any;
      this.redis = new IORedis(config.REDIS_URL, {
        maxRetriesPerRequest: 2,
        lazyConnect: true,
      });
      this.redis.on('error', (err: Error) => {
        logger.warn(`EventBus Redis error: ${err.message}`);
        this.redisReady = false;
      });
      this.redis.on('connect', () => {
        this.redisReady = true;
        logger.info('EventBus: Redis connected');
      });
      // Wait for actual connection before marking ready
      await this.redis.connect();
      this.redisReady = true;
    } catch (err: any) {
      logger.warn(`EventBus: Failed to init Redis (${err.message}), in-process only`);
      this.redisReady = false;
    }
  }

  /** Start consuming from Redis Stream (one consumer per instance) */
  async startConsumer(groupName: string = CONSUMER_GROUP): Promise<void> {
    if (!this.redisReady || !this.redis || this.consumerRunning) return;

    try {
      // Create consumer group (ignore if already exists)
      try {
        await this.redis.xgroup('CREATE', STREAM_KEY, groupName, '0', 'MKSTREAM');
      } catch (_e) { /* group already exists */ }

      this.consumerRunning = true;
      logger.info(`EventBus: Consumer ${this.consumerName} started in group ${groupName}`);

      // Consume loop
      while (this.consumerRunning) {
        try {
          const results = await this.redis.xreadgroup(
            'GROUP', groupName, this.consumerName,
            'COUNT', 10,
            'BLOCK', 5000,
            'STREAMS', STREAM_KEY, '>',
          );

          if (!results) continue;

          for (const [, messages] of results as any[]) {
            for (const [id, fields] of messages) {
              try {
                const event = this.parseStreamMessage(id, fields);
                const fieldMap = new Map<string, string>();
                for (let i = 0; i < fields.length; i += 2) {
                  fieldMap.set(fields[i], fields[i + 1]);
                }
                const origin = fieldMap.get('origin');

                if (event) {
                  eventsConsumed.inc({ type: event.type, consumer: this.consumerName });

                  // Skip events that originated from this same consumer
                  // to avoid double-dispatch (emit() already dispatched locally)
                  if (origin !== this.consumerName) {
                    await this.dispatchLocal(event);
                  }
                }
                await this.redis.xack(STREAM_KEY, groupName, id);
              } catch (err: any) {
                logger.error(`EventBus: Failed to process message ${id}: ${err.message}`);
                eventsFailed.inc({ type: 'consumer_error', error_type: 'process' });
                // Move to DLQ after 3 retries (fixed: hincrby not hincrAll)
                try {
                  const retries = await this.redis.hincrby(`event:retries:${id}`, 'count', 1);
                  if (retries >= 3) {
                    await this.redis.xadd(DLQ_KEY, '*', 'original_id', id, 'error', err.message);
                    await this.redis.xack(STREAM_KEY, groupName, id);
                    await this.redis.del(`event:retries:${id}`);
                    eventsDlq.inc();
                  }
                } catch (dlqErr: any) {
                  logger.error(`EventBus: DLQ handling failed for ${id}: ${dlqErr.message}`);
                }
              }
            }
          }
        } catch (err: any) {
          if (this.consumerRunning) {
            logger.error(`EventBus: Consumer error: ${err.message}`);
            await new Promise(r => setTimeout(r, 5000));
          }
        }
      }
    } catch (err: any) {
      logger.error(`EventBus: Consumer startup failed: ${err.message}`);
    }
  }

  private parseStreamMessage(id: string, fields: string[]): DomainEvent | null {
    const map = new Map<string, string>();
    for (let i = 0; i < fields.length; i += 2) {
      map.set(fields[i], fields[i + 1]);
    }
    const type = map.get('type') as EventType;
    if (!type) return null;

    return {
      id: map.get('id') ?? id,
      type,
      tenantId: map.get('tenantId') ?? 'default',
      userId: map.get('userId') || undefined,
      clientId: map.get('clientId') || undefined,
      timestamp: new Date(map.get('timestamp') ?? Date.now()),
      payload: JSON.parse(map.get('payload') ?? '{}'),
      metadata: JSON.parse(map.get('metadata') ?? '{}'),
    };
  }

  /** Get backlog size from Redis Stream */
  async getBacklogSize(): Promise<number> {
    if (!this.redisReady || !this.redis) return 0;
    try {
      const info = await this.redis.xlen(STREAM_KEY);
      return Number(info);
    } catch { return 0; }
  }

  /** Stop the consumer loop and disconnect Redis */
  async stopConsumer(): Promise<void> {
    this.consumerRunning = false;
    // Give the XREADGROUP BLOCK time to unblock naturally (max 5s)
    // then force-disconnect
    if (this.redis) {
      try {
        await this.redis.quit();
      } catch (_e) { /* ignore */ }
      this.redisReady = false;
    }
  }

  /** Check if Redis is available */
  isRedisReady(): boolean {
    return this.redisReady;
  }
}

export const eventBus = new EventBus();
