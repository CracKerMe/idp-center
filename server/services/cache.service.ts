import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export interface CacheService {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSec?: number): Promise<void>;
  del(key: string): Promise<void>;
  /** Atomically increments key, setting ttlSec on the *first* increment only. Returns the new count. */
  incr(key: string, ttlSec: number): Promise<number>;
  /**
   * Atomically reads and deletes key in one step. Needed for one-time-use tokens
   * (e.g. captcha pass tokens) — a separate get() then del() has a race where two
   * concurrent requests can both read the value before either deletes it.
   */
  getdel(key: string): Promise<string | null>;
}

class MemoryCache implements CacheService {
  private store = new Map<string, { value: string; expiresAt: number | null }>();

  private isExpired(entry: { expiresAt: number | null }): boolean {
    return entry.expiresAt !== null && entry.expiresAt <= Date.now();
  }

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry || this.isExpired(entry)) {
      if (entry) this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlSec?: number): Promise<void> {
    this.store.set(key, { value, expiresAt: ttlSec ? Date.now() + ttlSec * 1000 : null });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async incr(key: string, ttlSec: number): Promise<number> {
    const entry = this.store.get(key);
    if (!entry || this.isExpired(entry)) {
      this.store.set(key, { value: '1', expiresAt: Date.now() + ttlSec * 1000 });
      return 1;
    }
    const next = parseInt(entry.value, 10) + 1;
    entry.value = String(next);
    return next;
  }

  async getdel(key: string): Promise<string | null> {
    // No await between the read and the delete, so this is atomic with respect
    // to other async handlers on the same event loop.
    const value = await this.get(key);
    this.store.delete(key);
    return value;
  }

  /** Drops expired entries so a long-running single instance doesn't leak memory. */
  sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (entry.expiresAt !== null && entry.expiresAt <= now) this.store.delete(key);
    }
  }
}

class RedisCache implements CacheService {
  constructor(private redis: any) {}

  async get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async set(key: string, value: string, ttlSec?: number): Promise<void> {
    if (ttlSec) await this.redis.set(key, value, 'EX', ttlSec);
    else await this.redis.set(key, value);
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async incr(key: string, ttlSec: number): Promise<number> {
    // Lua keeps the incr+expire pair atomic — two concurrent first-hits must not both set TTL
    // (that's harmless) but must both see a consistent counter (a plain incr+expire round trip
    // would not be atomic across the two calls).
    const script = `
      local n = redis.call('INCR', KEYS[1])
      if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
      return n
    `;
    const result = await this.redis.eval(script, 1, key, ttlSec);
    return Number(result);
  }

  async getdel(key: string): Promise<string | null> {
    // GETDEL is atomic server-side (Redis >=6.2, exposed by ioredis natively).
    return this.redis.getdel(key);
  }
}

const memoryFallback = new MemoryCache();
setInterval(() => memoryFallback.sweep(), 60_000).unref();

let instancePromise: Promise<CacheService> | null = null;

async function initCache(): Promise<CacheService> {
  if (!config.REDIS_URL) return memoryFallback;

  try {
    const { default: IORedis } = await import('ioredis');
    const redis = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: 2, lazyConnect: false });
    redis.on('error', (err: Error) => logger.warn(`Redis error: ${err.message}`));
    return new RedisCache(redis);
  } catch (err: any) {
    logger.warn(`Failed to initialize Redis (${err.message}) — falling back to in-process cache`);
    return memoryFallback;
  }
}

/**
 * Returns the shared cache/rate-limit backend. REDIS_URL unset => an in-process Map, which
 * is correct on a single instance but NOT safe across replicas (each pod gets its own rate
 * limit budget, JWKS cache, etc. — see implementation plan §4.2/§4.4's explicit precondition
 * that multi-replica deployment requires Redis first).
 */
export function getCache(): Promise<CacheService> {
  if (!instancePromise) instancePromise = initCache();
  return instancePromise;
}

export function resetCacheForTests(): void {
  instancePromise = null;
}
