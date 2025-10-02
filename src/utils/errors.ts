import { ErrorType, ErrorResponse } from '../types';

export class AvatarAPIError extends Error {
    constructor(
        message: string,
        public type: ErrorType,
        public statusCode: number = 500,
        public details?: string,
        public originalError?: Error
    ) {
        super(message);
        this.name = 'AvatarAPIError';
    }

    toResponse(correlationId: string): ErrorResponse {
        return {
            error: this.type,
            details: this.details || this.message,
            correlationId,
            timestamp: Date.now()
        };
    }
}

export class ErrorClassifier {
    static classify(error: unknown, correlationId?: string): AvatarAPIError {
        if (error instanceof AvatarAPIError) {
            return error;
        }
        if (error instanceof Error) {
            return this.classifyStandardError(error);
        }
        if (typeof error === 'string') {
            return new AvatarAPIError(
                error,
                ErrorType.INTERNAL_ERROR,
                500
            );
        }
        return new AvatarAPIError(
            'An unexpected error occurred',
            ErrorType.INTERNAL_ERROR,
            500,
            String(error)
        );
    }

    private static classifyStandardError(error: Error): AvatarAPIError {
        const message = error.message.toLowerCase();
        if (message.includes('timeout') ||
            message.includes('network') ||
            message.includes('connection') ||
            message.includes('econnrefused') ||
            message.includes('enotfound')) {
            return new AvatarAPIError(
                'Service temporarily unavailable',
                ErrorType.APPWRITE_CONNECTION_ERROR,
                502,
                error.message,
                error
            );
        }

        if (message.includes('unauthorized') ||
            message.includes('forbidden') ||
            message.includes('permission') ||
            message.includes('401') ||
            message.includes('403')) {
            return new AvatarAPIError(
                'Access denied',
                ErrorType.STORAGE_ACCESS_ERROR,
                403,
                error.message,
                error
            );
        }

        if (message.includes('not found') ||
            message.includes('404')) {
            return new AvatarAPIError(
                'Resource not found',
                ErrorType.NOT_FOUND_ERROR,
                404,
                error.message,
                error
            );
        }

        if (message.includes('query') ||
            message.includes('database') ||
            message.includes('collection')) {
            return new AvatarAPIError(
                'Database query failed',
                ErrorType.APPWRITE_QUERY_ERROR,
                500,
                error.message,
                error
            );
        }

        if (message.includes('validation') ||
            message.includes('invalid') ||
            message.includes('required')) {
            return new AvatarAPIError(
                'Invalid request parameters',
                ErrorType.VALIDATION_ERROR,
                400,
                error.message,
                error
            );
        }

        return new AvatarAPIError(
            'Internal server error',
            ErrorType.INTERNAL_ERROR,
            500,
            error.message,
            error
        );
    }

    static validationError(message: string, details?: string): AvatarAPIError {
        return new AvatarAPIError(
            message,
            ErrorType.VALIDATION_ERROR,
            400,
            details
        );
    }

    static rateLimitError(message: string = 'Rate limit exceeded'): AvatarAPIError {
        return new AvatarAPIError(
            message,
            ErrorType.RATE_LIMIT_ERROR,
            429
        );
    }

    static notFoundError(message: string = 'Resource not found'): AvatarAPIError {
        return new AvatarAPIError(
            message,
            ErrorType.NOT_FOUND_ERROR,
            404
        );
    }

    static connectionError(message: string = 'Service temporarily unavailable'): AvatarAPIError {
        return new AvatarAPIError(
            message,
            ErrorType.APPWRITE_CONNECTION_ERROR,
            502
        );
    }
}

export class CorrelationIdGenerator {
    static generate(): string {
        return crypto.randomUUID();
    }
    static fromRequest(request: Request): string {
        const existingId = request.headers.get('X-Correlation-ID') ||
            request.headers.get('X-Request-ID');

        return existingId || this.generate();
    }
}

import { Logger, MonitoringAggregator } from './logger';

export interface ErrorLogEntry {
    timestamp: number;
    correlationId: string;
    level: 'error' | 'warn' | 'info';
    errorType: ErrorType;
    message: string;
    details?: string;
    statusCode: number;
    ip?: string;
    userAgent?: string;
    requestPath?: string;
    requestMethod?: string;
    stack?: string;
    originalError?: string;
    responseTimeMs?: number;
}

export class ErrorLogger {
    static logError(
        error: AvatarAPIError,
        correlationId: string,
        context?: {
            ip?: string;
            userAgent?: string;
            requestPath?: string;
            requestMethod?: string;
            responseTimeMs?: number;
        }
    ): void {
        const logData = {
            errorType: error.type,
            message: error.message,
            details: error.details,
            statusCode: error.statusCode,
            stack: error.stack,
            originalError: error.originalError?.message,
            request: context ? {
                ip: context.ip,
                userAgent: context.userAgent,
                path: context.requestPath,
                method: context.requestMethod
            } : undefined,
            performance: context?.responseTimeMs ? {
                responseTimeMs: context.responseTimeMs
            } : undefined
        };

        MonitoringAggregator.recordError(error.type);
        
        if (context?.responseTimeMs) {
            MonitoringAggregator.recordResponseTime('error', context.responseTimeMs);
        }

        if (error.statusCode >= 500) {
            Logger.error(correlationId, `${error.type}: ${error.message}`, logData);
        } else {
            Logger.warn(correlationId, `${error.type}: ${error.message}`, logData);
        }
    }

    static logSuccess(
        correlationId: string,
        context: {
            ip?: string;
            userAgent?: string;
            requestPath?: string;
            requestMethod?: string;
            responseTimeMs: number;
            cacheHit?: boolean;
            avatarId?: string;
        }
    ): void {
        const logData = {
            statusCode: 200,
            request: {
                ip: context.ip,
                userAgent: context.userAgent,
                path: context.requestPath,
                method: context.requestMethod
            },
            performance: {
                responseTimeMs: context.responseTimeMs,
                cacheHit: context.cacheHit
            },
            response: {
                avatarId: context.avatarId
            }
        };

        MonitoringAggregator.recordResponseTime('success', context.responseTimeMs);
        if (context.requestPath) {
            MonitoringAggregator.recordRequest(context.requestPath);
        }

        Logger.info(correlationId, 'Request completed successfully', logData);
    }
}