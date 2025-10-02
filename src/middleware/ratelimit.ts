import { RateLimitConfig, RateLimitResult, ErrorResponse, ErrorType } from '../types';

export class RateLimitTracker {
  private kv: KVNamespace;
  private config: RateLimitConfig;

  constructor(kv: KVNamespace, config: RateLimitConfig) {
    this.kv = kv;
    this.config = config;
  }

  async checkLimit(ip: string): Promise<RateLimitResult> {
    const now = Date.now();
    const currentMinute = Math.floor(now / 60000); // Current minute bucket
    const currentHour = Math.floor(now / 3600000); // Current hour bucket

    const minuteKey = `${this.config.keyPrefix}:${ip}:min:${currentMinute}`;
    const hourKey = `${this.config.keyPrefix}:${ip}:hour:${currentHour}`;

    try {
      const [minuteCount, hourCount] = await Promise.all([
        this.kv.get(minuteKey),
        this.kv.get(hourKey)
      ]);

      const currentMinuteCount = parseInt(minuteCount || '0');
      const currentHourCount = parseInt(hourCount || '0');

      if (currentMinuteCount >= this.config.perMinute) {
        return {
          allowed: false,
          remaining: 0,
          resetTime: (currentMinute + 1) * 60000 // Next minute
        };
      }

      if (currentHourCount >= this.config.perHour) {
        return {
          allowed: false,
          remaining: 0,
          resetTime: (currentHour + 1) * 3600000 // Next hour
        };
      }

      await Promise.all([
        this.kv.put(minuteKey, (currentMinuteCount + 1).toString(), {
          expirationTtl: 120 // Keep for 2 minutes to handle clock skew
        }),
        this.kv.put(hourKey, (currentHourCount + 1).toString(), {
          expirationTtl: 7200 // Keep for 2 hours to handle clock skew
        })
      ]);

      return {
        allowed: true,
        remaining: Math.min(
          this.config.perMinute - currentMinuteCount - 1,
          this.config.perHour - currentHourCount - 1
        ),
        resetTime: (currentMinute + 1) * 60000
      };

    } catch (error) {
      console.error('Rate limit check failed:', error);
      return {
        allowed: true,
        remaining: this.config.perMinute - 1,
        resetTime: (currentMinute + 1) * 60000
      };
    }
  }

  async cleanup(ip: string): Promise<void> {
    const now = Date.now();
    const currentMinute = Math.floor(now / 60000);
    const currentHour = Math.floor(now / 3600000);

    const oldMinuteKey = `${this.config.keyPrefix}:${ip}:min:${currentMinute - 2}`;
    const oldHourKey = `${this.config.keyPrefix}:${ip}:hour:${currentHour - 2}`;

    try {
      await Promise.all([
        this.kv.delete(oldMinuteKey),
        this.kv.delete(oldHourKey)
      ]);
    } catch (error) {
      console.error('Rate limit cleanup failed:', error);
    }
  }
}

export function createRateLimitMiddleware(kv: KVNamespace, config?: Partial<RateLimitConfig>) {
  const defaultConfig: RateLimitConfig = {
    perMinute: 100,
    perHour: 1000,
    keyPrefix: 'ratelimit'
  };

  const rateLimitConfig = { ...defaultConfig, ...config };
  const tracker = new RateLimitTracker(kv, rateLimitConfig);

  return async (c: any, next: () => Promise<void>) => {
    const ip = c.req.header('CF-Connecting-IP') ||
      c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
      c.req.header('X-Real-IP') ||
      'unknown';

    const result = await tracker.checkLimit(ip);

    c.header('X-RateLimit-Remaining', result.remaining.toString());
    c.header('X-RateLimit-Reset', Math.ceil(result.resetTime / 1000).toString());

    if (!result.allowed) {
      const errorResponse: ErrorResponse = {
        error: ErrorType.RATE_LIMIT_ERROR,
        details: 'Rate limit exceeded. Please try again later.',
        correlationId: crypto.randomUUID(),
        timestamp: Date.now()
      };

      c.header('Retry-After', Math.ceil((result.resetTime - Date.now()) / 1000).toString());

      return c.json(errorResponse, 429);
    }

    await next();
  };
}

export const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  perMinute: 100,  // 100 requests per minute per IP
  perHour: 1000,   // 1000 requests per hour per IP
  keyPrefix: 'avatar-api'
};