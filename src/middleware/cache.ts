import { CacheService } from '../services/cache';
import { AvatarRequest } from '../types';

export interface CacheMiddlewareOptions {
  cacheService?: CacheService;
  skipCache?: boolean;
}

export class CacheMiddleware {
  private cacheService: CacheService;

  constructor(cacheService: CacheService) {
    this.cacheService = cacheService;
  }

  async checkCache(request: Request, avatarRequest: AvatarRequest): Promise<Response | null> {
    try {
      const cacheRequest = this.cacheService.createCacheRequest(request, avatarRequest);
      
      const cacheResult = await this.cacheService.get(cacheRequest);
      
      if (cacheResult.hit && cacheResult.response) {
        return this.cacheService.addCacheHeaders(cacheResult.response, true, cacheResult.key);
      }
      
      return null;
    } catch (error) {
      console.error('Cache check error:', error);
      return null;
    }
  }

  async storeInCache(request: Request, response: Response, avatarRequest: AvatarRequest): Promise<Response> {
    try {
      if (!this.cacheService.shouldCache(response)) {
        return response;
      }
      const cacheRequest = this.cacheService.createCacheRequest(request, avatarRequest);
      
      await this.cacheService.put(cacheRequest, response);
      
      const cacheKey = this.cacheService.generateCacheKey(avatarRequest);
      return this.cacheService.addCacheHeaders(response, false, cacheKey);
    } catch (error) {
      console.error('Cache store error:', error);
      return response;
    }
  }

  getMetrics() {
    return this.cacheService.getMetrics();
  }
}

export function createCacheMiddleware(cacheService?: CacheService): CacheMiddleware {
  if (!cacheService) {
    const { cacheService: defaultCacheService } = require('../services/cache');
    return new CacheMiddleware(defaultCacheService);
  }
  return new CacheMiddleware(cacheService);
}