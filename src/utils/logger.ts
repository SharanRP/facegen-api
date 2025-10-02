import { ErrorType } from '../types';

export interface RequestMetrics {
  correlationId: string;
  timestamp: number;
  ip: string;
  userAgent?: string;
  requestPath: string;
  requestMethod: string;
  description?: string;
  scale?: number;
  format?: string;
  cacheHit?: boolean;
  appwriteQueryMs?: number;
  totalResponseMs: number;
  status: number;
  error?: string;
  errorType?: ErrorType;
  avatarId?: string;
  rateLimitRemaining?: number;
  cacheKey?: string;
}

export interface PerformanceMetrics {
  correlationId: string;
  timestamp: number;
  operation: string;
  durationMs: number;
  success: boolean;
  error?: string;
  metadata?: Record<string, any>;
}

export enum LogLevel {
  ERROR = 'error',
  WARN = 'warn',
  INFO = 'info',
  DEBUG = 'debug'
}

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  correlationId: string;
  message: string;
  data?: Record<string, any>;
}

export class Logger {
  private static formatLogEntry(entry: LogEntry): string {
    return JSON.stringify({
      ...entry,
      timestamp: new Date(entry.timestamp).toISOString()
    });
  }

  static error(correlationId: string, message: string, data?: Record<string, any>): void {
    const entry: LogEntry = {
      timestamp: Date.now(),
      level: LogLevel.ERROR,
      correlationId,
      message,
      data
    };
    console.error(this.formatLogEntry(entry));
  }

  static warn(correlationId: string, message: string, data?: Record<string, any>): void {
    const entry: LogEntry = {
      timestamp: Date.now(),
      level: LogLevel.WARN,
      correlationId,
      message,
      data
    };
    console.warn(this.formatLogEntry(entry));
  }

  static info(correlationId: string, message: string, data?: Record<string, any>): void {
    const entry: LogEntry = {
      timestamp: Date.now(),
      level: LogLevel.INFO,
      correlationId,
      message,
      data
    };
    console.log(this.formatLogEntry(entry));
  }

  static debug(correlationId: string, message: string, data?: Record<string, any>): void {
    const entry: LogEntry = {
      timestamp: Date.now(),
      level: LogLevel.DEBUG,
      correlationId,
      message,
      data
    };
    console.debug(this.formatLogEntry(entry));
  }
}

export class RequestLogger {
  static logRequest(metrics: RequestMetrics): void {
    const logLevel = metrics.status >= 500 ? LogLevel.ERROR : 
                    metrics.status >= 400 ? LogLevel.WARN : LogLevel.INFO;
    
    const message = `${metrics.requestMethod} ${metrics.requestPath} - ${metrics.status} (${metrics.totalResponseMs}ms)`;
    
    const logData = {
      request: {
        method: metrics.requestMethod,
        path: metrics.requestPath,
        ip: metrics.ip,
        userAgent: metrics.userAgent,
        parameters: {
          description: metrics.description,
          scale: metrics.scale,
          format: metrics.format
        }
      },
      response: {
        status: metrics.status,
        totalResponseMs: metrics.totalResponseMs,
        avatarId: metrics.avatarId
      },
      performance: {
        cacheHit: metrics.cacheHit,
        appwriteQueryMs: metrics.appwriteQueryMs,
        cacheKey: metrics.cacheKey
      },
      rateLimit: {
        remaining: metrics.rateLimitRemaining
      },
      error: metrics.error ? {
        message: metrics.error,
        type: metrics.errorType
      } : undefined
    };

    switch (logLevel) {
      case LogLevel.ERROR:
        Logger.error(metrics.correlationId, message, logData);
        break;
      case LogLevel.WARN:
        Logger.warn(metrics.correlationId, message, logData);
        break;
      default:
        Logger.info(metrics.correlationId, message, logData);
    }
  }
}

export class PerformanceLogger {
  static logOperation(metrics: PerformanceMetrics): void {
    const message = `${metrics.operation} completed in ${metrics.durationMs}ms (${metrics.success ? 'success' : 'failed'})`;
    
    const logData = {
      operation: metrics.operation,
      durationMs: metrics.durationMs,
      success: metrics.success,
      error: metrics.error,
      metadata: metrics.metadata
    };

    if (metrics.success) {
      Logger.info(metrics.correlationId, message, logData);
    } else {
      Logger.error(metrics.correlationId, message, logData);
    }
  }
}

export class PerformanceTimer {
  private startTime: number;
  private correlationId: string;
  private operation: string;

  constructor(correlationId: string, operation: string) {
    this.correlationId = correlationId;
    this.operation = operation;
    this.startTime = Date.now();
  }

  finish(success: boolean = true, error?: string, metadata?: Record<string, any>): number {
    const durationMs = Date.now() - this.startTime;
    
    PerformanceLogger.logOperation({
      correlationId: this.correlationId,
      timestamp: Date.now(),
      operation: this.operation,
      durationMs,
      success,
      error,
      metadata
    });

    return durationMs;
  }

  getDuration(): number {
    return Date.now() - this.startTime;
  }
}

// Monitoring aggregation utilities
export class MonitoringAggregator {
  private static metrics: Map<string, number[]> = new Map();
  private static errorCounts: Map<string, number> = new Map();
  private static requestCounts: Map<string, number> = new Map();

  static recordResponseTime(operation: string, timeMs: number): void {
    const key = `response_time_${operation}`;
    if (!this.metrics.has(key)) {
      this.metrics.set(key, []);
    }
    this.metrics.get(key)!.push(timeMs);
    
    // Keep only last 1000 measurements to prevent memory issues
    const measurements = this.metrics.get(key)!;
    if (measurements.length > 1000) {
      measurements.splice(0, measurements.length - 1000);
    }
  }

  static recordError(errorType: string): void {
    const current = this.errorCounts.get(errorType) || 0;
    this.errorCounts.set(errorType, current + 1);
  }

  static recordRequest(endpoint: string): void {
    const current = this.requestCounts.get(endpoint) || 0;
    this.requestCounts.set(endpoint, current + 1);
  }

  static getMetrics(): Record<string, any> {
    const result: Record<string, any> = {};
    
    // Calculate percentiles for response times
    for (const [key, values] of this.metrics.entries()) {
      if (values.length > 0) {
        const sorted = [...values].sort((a, b) => a - b);
        result[key] = {
          count: values.length,
          min: sorted[0],
          max: sorted[sorted.length - 1],
          avg: values.reduce((a, b) => a + b, 0) / values.length,
          p50: sorted[Math.floor(sorted.length * 0.5)],
          p95: sorted[Math.floor(sorted.length * 0.95)],
          p99: sorted[Math.floor(sorted.length * 0.99)]
        };
      }
    }
    
    result.errors = Object.fromEntries(this.errorCounts);
    result.requests = Object.fromEntries(this.requestCounts);
    
    return result;
  }

  static reset(): void {
    this.metrics.clear();
    this.errorCounts.clear();
    this.requestCounts.clear();
  }
}