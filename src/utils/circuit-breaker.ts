import { AvatarAPIError, ErrorClassifier } from './errors';
import { ErrorType } from '../types';


export enum CircuitBreakerState {
  CLOSED = 'CLOSED',     // Normal operation
  OPEN = 'OPEN',         // Circuit is open, failing fast
  HALF_OPEN = 'HALF_OPEN' // Testing if service is back
}


export interface CircuitBreakerConfig {
  failureThreshold: number;    // Number of failures before opening circuit
  recoveryTimeout: number;     // Time to wait before trying half-open (ms)
  successThreshold: number;    // Number of successes needed to close circuit from half-open
  timeout: number;            // Operation timeout (ms)
}


export interface CircuitBreakerMetrics {
  state: CircuitBreakerState;
  failures: number;
  successes: number;
  lastFailureTime: number;
  lastSuccessTime: number;
  totalRequests: number;
  totalFailures: number;
  totalSuccesses: number;
}


export class CircuitBreaker {
  private state: CircuitBreakerState = CircuitBreakerState.CLOSED;
  private failures: number = 0;
  private successes: number = 0;
  private lastFailureTime: number = 0;
  private lastSuccessTime: number = 0;
  private totalRequests: number = 0;
  private totalFailures: number = 0;
  private totalSuccesses: number = 0;

  constructor(
    private config: CircuitBreakerConfig,
    private name: string = 'default'
  ) {}

  
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    this.totalRequests++;

    if (this.state === CircuitBreakerState.OPEN) {
      if (Date.now() - this.lastFailureTime >= this.config.recoveryTimeout) {
        this.state = CircuitBreakerState.HALF_OPEN;
        this.successes = 0;
        console.log(`Circuit breaker ${this.name}: Transitioning to HALF_OPEN`);
      } else {
        throw ErrorClassifier.connectionError(
          `Circuit breaker is OPEN for ${this.name}. Service temporarily unavailable.`
        );
      }
    }

    try {
      const result = await this.executeWithTimeout(operation);
      this.onSuccess();
      return result;

    } catch (error) {
      this.onFailure();
      throw ErrorClassifier.classify(error);
    }
  }

  
  private async executeWithTimeout<T>(operation: () => Promise<T>): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Operation timeout after ${this.config.timeout}ms`));
      }, this.config.timeout);
    });

    return Promise.race([operation(), timeoutPromise]);
  }

  
  private onSuccess(): void {
    this.successes++;
    this.totalSuccesses++;
    this.lastSuccessTime = Date.now();

    if (this.state === CircuitBreakerState.HALF_OPEN) {
      if (this.successes >= this.config.successThreshold) {
        this.state = CircuitBreakerState.CLOSED;
        this.failures = 0;
        console.log(`Circuit breaker ${this.name}: Transitioning to CLOSED after ${this.successes} successes`);
      }
    } else if (this.state === CircuitBreakerState.CLOSED) {
      this.failures = 0;
    }
  }

  
  private onFailure(): void {
    this.failures++;
    this.totalFailures++;
    this.lastFailureTime = Date.now();

    if (this.state === CircuitBreakerState.CLOSED) {
      if (this.failures >= this.config.failureThreshold) {
        this.state = CircuitBreakerState.OPEN;
        console.error(`Circuit breaker ${this.name}: Transitioning to OPEN after ${this.failures} failures`);
      }
    } else if (this.state === CircuitBreakerState.HALF_OPEN) {
      this.state = CircuitBreakerState.OPEN;
      console.error(`Circuit breaker ${this.name}: Transitioning back to OPEN from HALF_OPEN`);
    }
  }

  
  getMetrics(): CircuitBreakerMetrics {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      totalRequests: this.totalRequests,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses
    };
  }

  
  getState(): CircuitBreakerState {
    return this.state;
  }

  
  isAvailable(): boolean {
    return this.state !== CircuitBreakerState.OPEN;
  }

  
  reset(): void {
    this.state = CircuitBreakerState.CLOSED;
    this.failures = 0;
    this.successes = 0;
    this.lastFailureTime = 0;
    this.lastSuccessTime = 0;
    this.totalRequests = 0;
    this.totalFailures = 0;
    this.totalSuccesses = 0;
    console.log(`Circuit breaker ${this.name}: Reset to CLOSED state`);
  }

  
  forceState(state: CircuitBreakerState): void {
    this.state = state;
    console.log(`Circuit breaker ${this.name}: Forced to ${state} state`);
  }
}


export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,        // Open after 5 failures
  recoveryTimeout: 30000,     // Wait 30 seconds before trying half-open
  successThreshold: 3,        // Need 3 successes to close from half-open
  timeout: 5000              // 5 second operation timeout
};


export class CircuitBreakerFactory {
  private static instances = new Map<string, CircuitBreaker>();

  
  static getInstance(
    name: string, 
    config: CircuitBreakerConfig = DEFAULT_CIRCUIT_BREAKER_CONFIG
  ): CircuitBreaker {
    if (!this.instances.has(name)) {
      this.instances.set(name, new CircuitBreaker(config, name));
    }
    return this.instances.get(name)!;
  }

  
  static getAllInstances(): Map<string, CircuitBreaker> {
    return new Map(this.instances);
  }

  
  static resetAll(): void {
    this.instances.forEach(breaker => breaker.reset());
  }

  
  static getAllMetrics(): Record<string, CircuitBreakerMetrics> {
    const metrics: Record<string, CircuitBreakerMetrics> = {};
    this.instances.forEach((breaker, name) => {
      metrics[name] = breaker.getMetrics();
    });
    return metrics;
  }

  /**
   * Clear all circuit breaker instances (for testing)
   */
  static clearAll(): void {
    this.instances.clear();
  }
}
