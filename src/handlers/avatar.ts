import { Context } from 'hono';
import { AvatarRequest, WorkerEnvironment, ErrorResponse, ErrorType, AvatarDocument } from '../types';
import { validateAvatarRequest } from '../middleware/validation';
import { RateLimitTracker, DEFAULT_RATE_LIMIT_CONFIG } from '../middleware/ratelimit';
import { cacheService } from '../services/cache';
import { createAppwriteService, AppwriteError } from '../services/appwrite';

export interface AvatarHandlerContext extends Context {
  env: WorkerEnvironment;
}

export class AvatarHandler {
  private appwriteService: ReturnType<typeof createAppwriteService>;
  private rateLimitTracker: RateLimitTracker;

  constructor(env: WorkerEnvironment) {
    this.appwriteService = createAppwriteService(env);
    this.rateLimitTracker = new RateLimitTracker(env.RATE_LIMIT, DEFAULT_RATE_LIMIT_CONFIG);
  }

  private extractKeywords(description: string): string[] {
    return description
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s]/g, '') // Remove special characters
      .split(/\s+/)
      .filter(word => word.length > 2) // Filter out short words like "a", "an", "the"
      .slice(0, 10); // Limit to 10 keywords for performance
  }

  private generateCorrelationId(): string {
    return crypto.randomUUID();
  }

  private getClientIP(c: AvatarHandlerContext): string {
    return c.req.header('CF-Connecting-IP') ||
      c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
      c.req.header('X-Real-IP') ||
      'unknown';
  }

  private createErrorResponse(
    error: string,
    details?: string,
    correlationId?: string
  ): ErrorResponse {
    return {
      error,
      details,
      correlationId: correlationId || this.generateCorrelationId(),
      timestamp: Date.now()
    };
  }

  private async checkRateLimit(c: AvatarHandlerContext): Promise<Response | null> {
    const ip = this.getClientIP(c);
    const rateLimitResult = await this.rateLimitTracker.checkLimit(ip);

    c.header('X-RateLimit-Remaining', rateLimitResult.remaining.toString());
    c.header('X-RateLimit-Reset', Math.ceil(rateLimitResult.resetTime / 1000).toString());

    if (!rateLimitResult.allowed) {
      const errorResponse = this.createErrorResponse(
        ErrorType.RATE_LIMIT_ERROR,
        'Rate limit exceeded. Please try again later.'
      );

      c.header('Retry-After', Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000).toString());
      return c.json(errorResponse, 429);
    }

    return null; // No rate limit violation
  }

  private validateRequest(c: AvatarHandlerContext): { valid: boolean; response?: Response; request?: AvatarRequest } {
    const description = c.req.query('description');
    const scale = c.req.query('scale');
    const format = c.req.query('format');

    const validationResult = validateAvatarRequest({
      description,
      scale,
      format
    });

    if (!validationResult.valid) {
      const errorResponse = this.createErrorResponse(
        ErrorType.VALIDATION_ERROR,
        validationResult.errors.join('; ')
      );

      return {
        valid: false,
        response: c.json(errorResponse, 400)
      };
    }

    return {
      valid: true,
      request: validationResult.sanitized
    };
  }

  private async checkCache(originalRequest: Request, avatarRequest: AvatarRequest): Promise<Response | null> {
    const cacheRequest = cacheService.createCacheRequest(originalRequest, avatarRequest);
    const cacheResult = await cacheService.get(cacheRequest);

    if (cacheResult.hit && cacheResult.response) {
      return cacheService.addCacheHeaders(cacheResult.response, true, cacheResult.key);
    }

    return null;
  }

  private async searchAvatars(avatarRequest: AvatarRequest): Promise<AvatarDocument[]> {
    const keywords = this.extractKeywords(avatarRequest.description);
    
    if (keywords.length === 0) {
      throw new AppwriteError(
        'No valid keywords found in description',
        ErrorType.VALIDATION_ERROR,
        400
      );
    }

    return await this.appwriteService.searchAvatars(keywords, avatarRequest.scale);
  }

  private async streamImageResponse(
    avatar: AvatarDocument,
    format: 'webp' | 'png'
  ): Promise<Response> {
    const fileUrl = await this.appwriteService.getFileUrl(avatar.bucketId, avatar.fileId);
    
    const imageResponse = await fetch(fileUrl);
    
    if (!imageResponse.ok) {
      throw new AppwriteError(
        'Failed to fetch image from storage',
        ErrorType.STORAGE_ACCESS_ERROR,
        imageResponse.status
      );
    }

    const headers = new Headers();
    headers.set('Content-Type', `image/${format}`);
    headers.set('Cache-Control', 'public, max-age=3600');
    headers.set('X-Avatar-Id', avatar.$id);
    
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type');
    headers.set('Access-Control-Max-Age', '86400');

    const contentLength = imageResponse.headers.get('Content-Length');
    if (contentLength) {
      headers.set('Content-Length', contentLength);
    }

    return new Response(imageResponse.body, {
      status: 200,
      headers
    });
  }

  async handle(c: AvatarHandlerContext): Promise<Response> {
    const correlationId = this.generateCorrelationId();
    const startTime = Date.now();

    try {
      const rateLimitResponse = await this.checkRateLimit(c);
      if (rateLimitResponse) {
        return rateLimitResponse;
      }

      const validation = this.validateRequest(c);
      if (!validation.valid || !validation.request) {
        return validation.response!;
      }

      const avatarRequest = validation.request;

      const cachedResponse = await this.checkCache(c.req.raw, avatarRequest);
      if (cachedResponse) {
        return cachedResponse;
      }

      const avatars = await this.searchAvatars(avatarRequest);
      
      if (avatars.length === 0) {
        const errorResponse = this.createErrorResponse(
          ErrorType.NOT_FOUND_ERROR,
          'No avatars found matching the description and scale',
          correlationId
        );

        const notFoundResponse = c.json(errorResponse, 404);
        
        const cacheRequest = cacheService.createCacheRequest(c.req.raw, avatarRequest);
        await cacheService.put(cacheRequest, notFoundResponse.clone());
        
        return notFoundResponse;
      }

      const selectedAvatar = avatars[0];

      const imageResponse = await this.streamImageResponse(selectedAvatar, avatarRequest.format);
      
      const cacheRequest = cacheService.createCacheRequest(c.req.raw, avatarRequest);
      await cacheService.put(cacheRequest, imageResponse.clone());

      const finalResponse = cacheService.addCacheHeaders(imageResponse, false, cacheService.generateCacheKey(avatarRequest));
      
      console.log(JSON.stringify({
        timestamp: Date.now(),
        correlationId,
        ip: this.getClientIP(c),
        userAgent: c.req.header('User-Agent'),
        description: avatarRequest.description,
        scale: avatarRequest.scale,
        format: avatarRequest.format,
        cacheHit: false,
        avatarId: selectedAvatar.$id,
        totalResponseMs: Date.now() - startTime,
        status: 200
      }));

      return finalResponse;

    } catch (error) {
      if (error instanceof AppwriteError) {
        const errorResponse = this.createErrorResponse(
          error.type,
          error.message,
          correlationId
        );

        console.error(JSON.stringify({
          timestamp: Date.now(),
          correlationId,
          ip: this.getClientIP(c),
          error: error.type,
          message: error.message,
          statusCode: error.statusCode,
          totalResponseMs: Date.now() - startTime
        }));

        return c.json(errorResponse, error.statusCode);
      }

      const errorResponse = this.createErrorResponse(
        ErrorType.INTERNAL_ERROR,
        'An unexpected error occurred',
        correlationId
      );

      console.error(JSON.stringify({
        timestamp: Date.now(),
        correlationId,
        ip: this.getClientIP(c),
        error: ErrorType.INTERNAL_ERROR,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        totalResponseMs: Date.now() - startTime
      }));

      return c.json(errorResponse, 500);
    }
  }
}

export function createAvatarHandler(env: WorkerEnvironment) {
  const handler = new AvatarHandler(env);
  return (c: AvatarHandlerContext) => handler.handle(c);
}