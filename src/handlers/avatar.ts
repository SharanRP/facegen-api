import { Context } from 'hono';
import { AvatarRequest, WorkerEnvironment, ErrorType, AvatarDocument } from '../types';
import { validateAvatarRequest } from '../middleware/validation';
import { RateLimitTracker, DEFAULT_RATE_LIMIT_CONFIG } from '../middleware/ratelimit';
import { cacheService } from '../services/cache';
import { createAppwriteService } from '../services/appwrite';
import { createImageGenerationService } from '../services/image-generation';
import { AvatarAPIError, ErrorClassifier, CorrelationIdGenerator, ErrorLogger } from '../utils/errors';
import { PerformanceTimer, RequestLogger, RequestMetrics, Logger } from '../utils/logger';
import { createVectorSearchService, VectorSearchResult } from '../services/vector-search';

export interface AvatarHandlerContext extends Context {
  env: WorkerEnvironment;
}

export class AvatarHandler {
  private appwriteService: ReturnType<typeof createAppwriteService>;
  private vectorSearchService: ReturnType<typeof createVectorSearchService>;
  private rateLimitTracker: RateLimitTracker;

  constructor(env: WorkerEnvironment) {
    this.appwriteService = createAppwriteService(env);
    this.vectorSearchService = createVectorSearchService(env);
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

  private getClientIP(c: AvatarHandlerContext): string {
    return c.req.header('CF-Connecting-IP') ||
      c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
      c.req.header('X-Real-IP') ||
      'unknown';
  }

  private getRequestContext(c: AvatarHandlerContext) {
    return {
      ip: this.getClientIP(c),
      userAgent: c.req.header('User-Agent'),
      requestPath: c.req.path,
      requestMethod: c.req.method
    };
  }

  private async checkRateLimit(c: AvatarHandlerContext, correlationId: string): Promise<Response | null> {
    try {
      const ip = this.getClientIP(c);
      const rateLimitResult = await this.rateLimitTracker.checkLimit(ip);

      c.header('X-RateLimit-Remaining', rateLimitResult.remaining.toString());
      c.header('X-RateLimit-Reset', Math.ceil(rateLimitResult.resetTime / 1000).toString());

      if (!rateLimitResult.allowed) {
        const error = ErrorClassifier.rateLimitError('Rate limit exceeded. Please try again later.');
        const errorResponse = error.toResponse(correlationId);

        ErrorLogger.logError(error, correlationId, this.getRequestContext(c));

        c.header('Retry-After', Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000).toString());
        return c.json(errorResponse, 429);
      }

      return null; // No rate limit violation
    } catch (error) {
      const classifiedError = ErrorClassifier.classify(error);
      const errorResponse = classifiedError.toResponse(correlationId);

      ErrorLogger.logError(classifiedError, correlationId, this.getRequestContext(c));

      return c.json(errorResponse, classifiedError.statusCode);
    }
  }

  private validateRequest(c: AvatarHandlerContext, correlationId: string): { valid: boolean; response?: Response; request?: AvatarRequest } {
    try {
      const description = c.req.query('description');

      const validationResult = validateAvatarRequest({
        description
      });

      if (!validationResult.valid) {
        const error = ErrorClassifier.validationError(
          'Invalid request parameters',
          validationResult.errors.join('; ')
        );
        const errorResponse = error.toResponse(correlationId);

        ErrorLogger.logError(error, correlationId, this.getRequestContext(c));

        return {
          valid: false,
          response: c.json(errorResponse, 400)
        };
      }

      return {
        valid: true,
        request: validationResult.sanitized
      };
    } catch (error) {
      const classifiedError = ErrorClassifier.classify(error);
      const errorResponse = classifiedError.toResponse(correlationId);

      ErrorLogger.logError(classifiedError, correlationId, this.getRequestContext(c));

      return {
        valid: false,
        response: c.json(errorResponse, classifiedError.statusCode)
      };
    }
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
    try {
      const vectorResults = await this.vectorSearchService.enhancedSemanticSearch(
        avatarRequest.description,
        {
          limit: 10,
          threshold: 0.6,
          includeMetadata: true
        }
      );

      if (vectorResults.length > 0) {
        return vectorResults.map(result => ({
          $id: result.id,
          description: result.metadata.description,
          tags: result.metadata.tags,
          fileId: result.metadata.fileId,
          bucketId: result.metadata.bucketId,
          width: result.metadata.width,
          height: result.metadata.height
        }));
      }

      console.log('Vector search returned no results, falling back to keyword search');
      const keywords = this.extractKeywords(avatarRequest.description);

      if (keywords.length > 0) {
        const dbResults = await this.appwriteService.searchAvatars(keywords, avatarRequest.scale);
        if (dbResults.length > 0) {
          return dbResults;
        }
      }

      return await this.appwriteService.getFallbackAvatars(avatarRequest.scale);

    } catch (error) {
      console.error('Vector search error, falling back to keyword search:', error);

      const keywords = this.extractKeywords(avatarRequest.description);

      if (keywords.length > 0) {
        const dbResults = await this.appwriteService.searchAvatars(keywords, avatarRequest.scale);
        if (dbResults.length > 0) {
          return dbResults;
        }
      }

      return await this.appwriteService.getFallbackAvatars(avatarRequest.scale);
    }
  }

  private async streamImageResponse(
    avatar: AvatarDocument
  ): Promise<Response> {
    const fileUrl = await this.appwriteService.getFileUrl(avatar.bucketId, avatar.fileId);

    const imageResponse = await fetch(fileUrl);

    if (!imageResponse.ok) {
      if (imageResponse.status === 404) {
        Logger.error('avatar-stream-404', 'Avatar file not found in storage; attempting fallback', {
          avatarId: avatar.$id,
          bucketId: avatar.bucketId,
          fileId: avatar.fileId
        });

        try {
          const fallbackAvatars = await this.appwriteService.getFallbackAvatars(avatar.width || 256);
          if (fallbackAvatars && fallbackAvatars.length > 0) {
            const fallback = fallbackAvatars[0];
            const fallbackUrl = await this.appwriteService.getFileUrl(fallback.bucketId, fallback.fileId);
            const fallbackResp = await fetch(fallbackUrl);
            if (fallbackResp.ok) {
              const headers = new Headers();
              headers.set('Content-Type', 'image/png');
              headers.set('Cache-Control', 'public, max-age=3600');
              headers.set('X-Avatar-Id', fallback.$id);
              headers.set('Access-Control-Allow-Origin', '*');
              headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
              headers.set('Access-control-allow-headers', 'Content-Type');
              headers.set('Access-Control-Max-Age', '86400');

              const contentLength = fallbackResp.headers.get('Content-Length');
              if (contentLength) {
                headers.set('Content-Length', contentLength);
              }

              return new Response(fallbackResp.body, {
                status: 200,
                headers
              });
            }
          }
        } catch (fbErr) {
          console.error('Failed to fetch fallback image after 404:', fbErr);
        }
      }
      throw new AvatarAPIError(
        'Failed to fetch image from storage',
        ErrorType.STORAGE_ACCESS_ERROR,
        imageResponse.status,
        `HTTP ${imageResponse.status}: ${imageResponse.statusText}`
      );
    }

    const headers = new Headers();
    headers.set('Content-Type', 'image/png'); // Fixed format - matches your database images
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
    const correlationId = CorrelationIdGenerator.fromRequest(c.req.raw);
    const requestTimer = new PerformanceTimer(correlationId, 'avatar_request');
    const requestContext = this.getRequestContext(c);

    c.header('X-Correlation-ID', correlationId);

    let avatarRequest: AvatarRequest | undefined;
    let rateLimitRemaining: number | undefined;
    let cacheHit = false;
    let appwriteQueryMs: number | undefined;
    let avatarId: string | undefined;
    let cacheKey: string | undefined;

    try {
      const rateLimitTimer = new PerformanceTimer(correlationId, 'rate_limit_check');
      const rateLimitResponse = await this.checkRateLimit(c, correlationId);
      rateLimitTimer.finish(rateLimitResponse === null);

      if (rateLimitResponse) {
        rateLimitRemaining = parseInt(rateLimitResponse.headers.get('X-RateLimit-Remaining') || '0');
        this.logRequestMetrics(correlationId, requestContext, avatarRequest, {
          status: 429,
          totalResponseMs: requestTimer.getDuration(),
          rateLimitRemaining,
          error: 'Rate limit exceeded'
        });
        return rateLimitResponse;
      }

      const validationTimer = new PerformanceTimer(correlationId, 'request_validation');
      const validation = this.validateRequest(c, correlationId);
      validationTimer.finish(validation.valid);

      if (!validation.valid || !validation.request) {
        this.logRequestMetrics(correlationId, requestContext, avatarRequest, {
          status: 400,
          totalResponseMs: requestTimer.getDuration(),
          error: 'Validation failed'
        });
        return validation.response!;
      }

      avatarRequest = validation.request;
      cacheKey = cacheService.generateCacheKey(avatarRequest);

      const cacheTimer = new PerformanceTimer(correlationId, 'cache_check');
      const cachedResponse = await this.checkCache(c.req.raw, avatarRequest);
      cacheTimer.finish(true);

      if (cachedResponse) {
        cacheHit = true;
        cachedResponse.headers.set('X-Correlation-ID', correlationId);

        this.logRequestMetrics(correlationId, requestContext, avatarRequest, {
          status: 200,
          totalResponseMs: requestTimer.getDuration(),
          cacheHit,
          cacheKey
        });

        return cachedResponse;
      }

      const searchTimer = new PerformanceTimer(correlationId, 'appwrite_search');
      const avatars = await this.searchAvatars(avatarRequest);
      appwriteQueryMs = searchTimer.finish(true);

      if (avatars.length === 0) {
        const error = ErrorClassifier.notFoundError(
          'No avatars found matching the description and scale'
        );
        const errorResponse = error.toResponse(correlationId);

        this.logRequestMetrics(correlationId, requestContext, avatarRequest, {
          status: 404,
          totalResponseMs: requestTimer.getDuration(),
          appwriteQueryMs,
          cacheKey,
          error: error.message
        });

        const notFoundResponse = c.json(errorResponse, 404);

        const cacheRequest = cacheService.createCacheRequest(c.req.raw, avatarRequest);
        await cacheService.put(cacheRequest, notFoundResponse.clone());

        return notFoundResponse;
      }

      const selectedAvatar = avatars[0];
      avatarId = selectedAvatar.$id;

      const streamTimer = new PerformanceTimer(correlationId, 'image_streaming');
      const imageResponse = await this.streamImageResponse(selectedAvatar);
      streamTimer.finish(true);

      imageResponse.headers.set('X-Correlation-ID', correlationId);

      const cacheStoreTimer = new PerformanceTimer(correlationId, 'cache_storage');
      const cacheRequest = cacheService.createCacheRequest(c.req.raw, avatarRequest);
      await cacheService.put(cacheRequest, imageResponse.clone());
      cacheStoreTimer.finish(true);

      const finalResponse = cacheService.addCacheHeaders(imageResponse, false, cacheKey);

      this.logRequestMetrics(correlationId, requestContext, avatarRequest, {
        status: 200,
        totalResponseMs: requestTimer.getDuration(),
        appwriteQueryMs,
        cacheHit,
        avatarId,
        cacheKey
      });

      return finalResponse;

    } catch (error) {
      const classifiedError = ErrorClassifier.classify(error);
      const errorResponse = classifiedError.toResponse(correlationId);

      this.logRequestMetrics(correlationId, requestContext, avatarRequest, {
        status: classifiedError.statusCode,
        totalResponseMs: requestTimer.getDuration(),
        appwriteQueryMs,
        cacheHit,
        avatarId,
        cacheKey,
        error: classifiedError.message,
        errorType: classifiedError.type
      });

      return c.json(errorResponse, classifiedError.statusCode);
    }
  }

  private logRequestMetrics(
    correlationId: string,
    requestContext: ReturnType<typeof this.getRequestContext>,
    avatarRequest: AvatarRequest | undefined,
    metrics: {
      status: number;
      totalResponseMs: number;
      appwriteQueryMs?: number;
      cacheHit?: boolean;
      avatarId?: string;
      cacheKey?: string;
      rateLimitRemaining?: number;
      error?: string;
      errorType?: ErrorType;
    }
  ): void {
    const requestMetrics: RequestMetrics = {
      correlationId,
      timestamp: Date.now(),
      ip: requestContext.ip,
      userAgent: requestContext.userAgent,
      requestPath: requestContext.requestPath,
      requestMethod: requestContext.requestMethod,
      description: avatarRequest?.description,
      scale: avatarRequest?.scale,
      format: avatarRequest?.format,
      cacheHit: metrics.cacheHit,
      appwriteQueryMs: metrics.appwriteQueryMs,
      totalResponseMs: metrics.totalResponseMs,
      status: metrics.status,
      error: metrics.error,
      errorType: metrics.errorType,
      avatarId: metrics.avatarId,
      rateLimitRemaining: metrics.rateLimitRemaining,
      cacheKey: metrics.cacheKey
    };

    RequestLogger.logRequest(requestMetrics);
  }
}

export function createAvatarHandler(env: WorkerEnvironment) {
  const handler = new AvatarHandler(env);
  return (c: AvatarHandlerContext) => handler.handle(c);
}