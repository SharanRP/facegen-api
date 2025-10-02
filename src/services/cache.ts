import { AvatarRequest } from '../types';
import { PerformanceTimer, MonitoringAggregator } from '../utils/logger';

export interface CacheConfig {
  successTtl: number; // 1 hour for successful responses
  errorTtl: number;   // 5 minutes for 404 responses
}

export interface CacheMetrics {
  hits: number;
  misses: number;
  hitRate: number;
}

export interface CacheResult {
  hit: boolean;
  response?: Response;
  key: string;
}

export class CacheService {
  private config: CacheConfig;
  private metrics: CacheMetrics;

  constructor(config?: Partial<CacheConfig>) {
    this.config = {
      successTtl: 3600, // 1 hour
      errorTtl: 300,    // 5 minutes
      ...config
    };

    this.metrics = {
      hits: 0,
      misses: 0,
      hitRate: 0
    };
  }

  generateCacheKey(request: AvatarRequest): string {
    const { description, scale, format } = request;

    const keywords = this.extractKeywords(description);

    return `avatar:${keywords.join('-')}:${scale}:${format}`;
  }

  private extractKeywords(description: string): string[] {
    return description
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s]/g, '') // Remove special characters
      .split(/\s+/)
      .filter(word => word.length > 2) // Filter out short words
      .slice(0, 10) // Limit to 10 keywords for performance
      .sort(); // Sort for consistency
  }

  async get(request: Request): Promise<CacheResult> {
    const timer = new PerformanceTimer('cache-get', 'cache_lookup');

    try {
      const cache = caches.default;
      const cachedResponse = await cache.match(request);

      if (cachedResponse) {
        this.metrics.hits++;
        this.updateHitRate();

        const duration = timer.finish(true, undefined, {
          cacheHit: true,
          key: this.getCacheKeyFromRequest(request)
        });

        MonitoringAggregator.recordResponseTime('cache_hit', duration);

        return {
          hit: true,
          response: cachedResponse,
          key: this.getCacheKeyFromRequest(request)
        };
      }

      this.metrics.misses++;
      this.updateHitRate();

      const duration = timer.finish(true, undefined, {
        cacheHit: false,
        key: this.getCacheKeyFromRequest(request)
      });

      MonitoringAggregator.recordResponseTime('cache_miss', duration);

      return {
        hit: false,
        key: this.getCacheKeyFromRequest(request)
      };
    } catch (error) {
      timer.finish(false, error instanceof Error ? error.message : String(error));
      MonitoringAggregator.recordError('cache_lookup_error');

      console.error('Cache get error:', error);
      this.metrics.misses++;
      this.updateHitRate();

      return {
        hit: false,
        key: this.getCacheKeyFromRequest(request)
      };
    }
  }

  async put(request: Request, response: Response): Promise<void> {
    const timer = new PerformanceTimer('cache-put', 'cache_storage');

    try {
      const cache = caches.default;
      const ttl = this.getTtlForResponse(response);
      const responseToCache = response.clone();

      const headers = new Headers(responseToCache.headers);
      headers.set('Cache-Control', `public, max-age=${ttl}`);
      headers.set('X-Cache-TTL', ttl.toString());
      headers.set('X-Cached-At', new Date().toISOString());

      const cachedResponse = new Response(responseToCache.body, {
        status: responseToCache.status,
        statusText: responseToCache.statusText,
        headers
      });

      await cache.put(request, cachedResponse);

      const duration = timer.finish(true, undefined, {
        ttl,
        status: response.status,
        key: this.getCacheKeyFromRequest(request)
      });

      MonitoringAggregator.recordResponseTime('cache_store', duration);

    } catch (error) {
      timer.finish(false, error instanceof Error ? error.message : String(error));
      MonitoringAggregator.recordError('cache_storage_error');
      console.error('Cache put error:', error);
    }
  }

  private getTtlForResponse(response: Response): number {
    if (response.status === 200) {
      return this.config.successTtl;
    } else if (response.status === 404) {
      return this.config.errorTtl;
    } else {
      return 0;
    }
  }

  private getCacheKeyFromRequest(request: Request): string {
    const url = new URL(request.url);
    const description = url.searchParams.get('description') || '';
    const scale = parseInt(url.searchParams.get('scale') || '256') as 128 | 256 | 512;
    const format = (url.searchParams.get('format') || 'webp') as 'webp' | 'png';

    return this.generateCacheKey({ description, scale, format });
  }

  private updateHitRate(): void {
    const total = this.metrics.hits + this.metrics.misses;
    this.metrics.hitRate = total > 0 ? (this.metrics.hits / total) * 100 : 0;
  }

  getMetrics(): CacheMetrics {
    return { ...this.metrics };
  }

  resetMetrics(): void {
    this.metrics = {
      hits: 0,
      misses: 0,
      hitRate: 0
    };
  }

  createCacheRequest(originalRequest: Request, avatarRequest: AvatarRequest): Request {
    const url = new URL(originalRequest.url);

    url.searchParams.set('description', avatarRequest.description.trim());
    url.searchParams.set('scale', avatarRequest.scale.toString());
    url.searchParams.set('format', avatarRequest.format);

    return new Request(url.toString(), {
      method: originalRequest.method,
      headers: originalRequest.headers
    });
  }

  shouldCache(response: Response): boolean {
    return response.status === 200 || response.status === 404;
  }

  addCacheHeaders(response: Response, cacheHit: boolean, cacheKey: string): Response {
    const headers = new Headers(response.headers);

    headers.set('X-Cache', cacheHit ? 'HIT' : 'MISS');
    headers.set('X-Cache-Key', cacheKey);

    if (cacheHit) {
      const cachedAt = headers.get('X-Cached-At');
      if (cachedAt) {
        headers.set('X-Cache-Age', Math.floor((Date.now() - new Date(cachedAt).getTime()) / 1000).toString());
      }
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }
}

export const cacheService = new CacheService();