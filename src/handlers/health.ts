import { Context } from 'hono';
import { WorkerEnvironment } from '../types';
import { CircuitBreakerFactory } from '../utils/circuit-breaker';
import { CorrelationIdGenerator, ErrorLogger } from '../utils/errors';

export interface HealthCheckResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: number;
  correlationId: string;
  services: {
    database: {
      status: 'healthy' | 'degraded' | 'unhealthy';
      circuitBreaker: {
        state: string;
        failures: number;
        successes: number;
        totalRequests: number;
      };
    };
    storage: {
      status: 'healthy' | 'degraded' | 'unhealthy';
      circuitBreaker: {
        state: string;
        failures: number;
        successes: number;
        totalRequests: number;
      };
    };
  };
  version?: string;
}

export interface HealthHandlerContext extends Context {
  env: WorkerEnvironment;
}

export class HealthHandler {
  constructor(private env: WorkerEnvironment) {}

  private getServiceStatus(circuitBreakerState: string, totalRequests: number): 'healthy' | 'degraded' | 'unhealthy' {
    if (circuitBreakerState === 'OPEN') {
      return 'unhealthy';
    }
    
    if (circuitBreakerState === 'HALF_OPEN') {
      return 'degraded';
    }
    
    if (totalRequests === 0) {
      return 'healthy';
    }
    
    return 'healthy';
  }

  private getOverallStatus(databaseStatus: string, storageStatus: string): 'healthy' | 'degraded' | 'unhealthy' {
    if (databaseStatus === 'unhealthy' || storageStatus === 'unhealthy') {
      return 'unhealthy';
    }
    
    if (databaseStatus === 'degraded' || storageStatus === 'degraded') {
      return 'degraded';
    }
    
    return 'healthy';
  }

  async handle(c: HealthHandlerContext): Promise<Response> {
    const correlationId = CorrelationIdGenerator.generate();
    const startTime = Date.now();

    try {
      const allMetrics = CircuitBreakerFactory.getAllMetrics();
      
      const databaseMetrics = allMetrics['appwrite-database'] || {
        state: 'CLOSED',
        failures: 0,
        successes: 0,
        totalRequests: 0,
        totalFailures: 0,
        totalSuccesses: 0,
        lastFailureTime: 0,
        lastSuccessTime: 0
      };

      const storageMetrics = allMetrics['appwrite-storage'] || {
        state: 'CLOSED',
        failures: 0,
        successes: 0,
        totalRequests: 0,
        totalFailures: 0,
        totalSuccesses: 0,
        lastFailureTime: 0,
        lastSuccessTime: 0
      };

      const databaseStatus = this.getServiceStatus(databaseMetrics.state, databaseMetrics.totalRequests);
      const storageStatus = this.getServiceStatus(storageMetrics.state, storageMetrics.totalRequests);
      const overallStatus = this.getOverallStatus(databaseStatus, storageStatus);

      const healthResponse: HealthCheckResponse = {
        status: overallStatus,
        timestamp: Date.now(),
        correlationId,
        services: {
          database: {
            status: databaseStatus,
            circuitBreaker: {
              state: databaseMetrics.state,
              failures: databaseMetrics.failures,
              successes: databaseMetrics.successes,
              totalRequests: databaseMetrics.totalRequests
            }
          },
          storage: {
            status: storageStatus,
            circuitBreaker: {
              state: storageMetrics.state,
              failures: storageMetrics.failures,
              successes: storageMetrics.successes,
              totalRequests: storageMetrics.totalRequests
            }
          }
        },
        version: '1.0.0'
      };

      ErrorLogger.logSuccess(correlationId, {
        requestPath: '/health',
        requestMethod: 'GET',
        responseTimeMs: Date.now() - startTime
      });

      const httpStatus = overallStatus === 'healthy' ? 200 : 
                        overallStatus === 'degraded' ? 200 : 503;

      c.header('X-Correlation-ID', correlationId);
      c.header('Cache-Control', 'no-cache, no-store, must-revalidate');
      
      return c.json(healthResponse, httpStatus);

    } catch (error) {
      const healthResponse: HealthCheckResponse = {
        status: 'unhealthy',
        timestamp: Date.now(),
        correlationId,
        services: {
          database: {
            status: 'unhealthy',
            circuitBreaker: {
              state: 'UNKNOWN',
              failures: 0,
              successes: 0,
              totalRequests: 0
            }
          },
          storage: {
            status: 'unhealthy',
            circuitBreaker: {
              state: 'UNKNOWN',
              failures: 0,
              successes: 0,
              totalRequests: 0
            }
          }
        }
      };

      console.error(JSON.stringify({
        timestamp: Date.now(),
        correlationId,
        level: 'error',
        message: 'Health check failed',
        error: error instanceof Error ? error.message : String(error),
        responseTimeMs: Date.now() - startTime
      }));

      c.header('X-Correlation-ID', correlationId);
      return c.json(healthResponse, 503);
    }
  }
}

export function createHealthHandler(env: WorkerEnvironment) {
  const handler = new HealthHandler(env);
  return (c: HealthHandlerContext) => handler.handle(c);
}