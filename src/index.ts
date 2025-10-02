import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { WorkerEnvironment } from './types/index';
import { createAvatarHandler, AvatarHandlerContext } from './handlers/avatar';
import { createHealthHandler, HealthHandlerContext } from './handlers/health';
import { ErrorClassifier, CorrelationIdGenerator, ErrorLogger } from './utils/errors';
import { MonitoringAggregator, Logger } from './utils/logger';

type Env = {
  Bindings: WorkerEnvironment;
};

const app = new Hono<Env>();

// CORS middleware
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'OPTIONS'],
  allowHeaders: ['Content-Type'],
  maxAge: 86400
}));

// Health check endpoint
app.get('/health', (c) => {
  if (!c.env) {
    const correlationId = CorrelationIdGenerator.generate();
    const error = ErrorClassifier.classify(new Error('Environment not available'));
    const errorResponse = error.toResponse(correlationId);
    
    c.header('X-Correlation-ID', correlationId);
    return c.json(errorResponse, error.statusCode);
  }
  
  const healthHandler = createHealthHandler(c.env);
  return healthHandler(c as HealthHandlerContext);
});

// Avatar endpoint
app.get('/avatar', (c) => {
  if (!c.env) {
    const correlationId = CorrelationIdGenerator.generate();
    const error = ErrorClassifier.classify(new Error('Environment not available'));
    const errorResponse = error.toResponse(correlationId);
    
    c.header('X-Correlation-ID', correlationId);
    return c.json(errorResponse, error.statusCode);
  }
  
  const avatarHandler = createAvatarHandler(c.env);
  return avatarHandler(c as AvatarHandlerContext);
});

app.get('/metrics', (c) => {
  const correlationId = CorrelationIdGenerator.generate();
  const startTime = Date.now();
  
  try {
    const metrics = MonitoringAggregator.getMetrics();
    
    Logger.info(correlationId, 'Metrics endpoint accessed', {
      responseTimeMs: Date.now() - startTime,
      metricsCount: Object.keys(metrics).length
    });
    
    c.header('X-Correlation-ID', correlationId);
    c.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    
    return c.json({
      timestamp: Date.now(),
      correlationId,
      metrics
    });
  } catch (error) {
    const classifiedError = ErrorClassifier.classify(error);
    const errorResponse = classifiedError.toResponse(correlationId);
    
    ErrorLogger.logError(classifiedError, correlationId, {
      requestPath: '/metrics',
      requestMethod: 'GET',
      responseTimeMs: Date.now() - startTime
    });
    
    c.header('X-Correlation-ID', correlationId);
    return c.json(errorResponse, classifiedError.statusCode);
  }
});

// Handle 404 for other routes
app.notFound((c) => {
  const correlationId = CorrelationIdGenerator.generate();
  const error = ErrorClassifier.notFoundError('Endpoint not found');
  const errorResponse = error.toResponse(correlationId);
  
  ErrorLogger.logError(error, correlationId, {
    requestPath: c.req.path,
    requestMethod: c.req.method,
    ip: c.req.header('CF-Connecting-IP') || 'unknown',
    userAgent: c.req.header('User-Agent')
  });
  
  c.header('X-Correlation-ID', correlationId);
  return c.json(errorResponse, 404);
});

// Global error handler
app.onError((err, c) => {
  const correlationId = CorrelationIdGenerator.generate();
  const error = ErrorClassifier.classify(err);
  const errorResponse = error.toResponse(correlationId);
  
  ErrorLogger.logError(error, correlationId, {
    requestPath: c.req.path,
    requestMethod: c.req.method,
    ip: c.req.header('CF-Connecting-IP') || 'unknown',
    userAgent: c.req.header('User-Agent')
  });
  
  c.header('X-Correlation-ID', correlationId);
  return c.json(errorResponse, error.statusCode);
});

export default app;