import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { WorkerEnvironment } from './types/index';
import { createAvatarHandler, AvatarHandlerContext } from './handlers/avatar';

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
  return c.json({
    status: 'healthy',
    timestamp: Date.now(),
    service: 'avatar-api'
  });
});

// Avatar endpoint
app.get('/avatar', (c) => {
  if (!c.env) {
    return c.json({
      error: 'internal_error',
      message: 'Environment not available',
      timestamp: Date.now()
    }, 500);
  }
  
  const avatarHandler = createAvatarHandler(c.env);
  return avatarHandler(c as AvatarHandlerContext);
});

// Handle 404 for other routes
app.notFound((c) => {
  return c.json({
    error: 'not_found',
    message: 'Endpoint not found',
    timestamp: Date.now()
  }, 404);
});

// Global error handler
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({
    error: 'internal_error',
    message: 'An unexpected error occurred',
    timestamp: Date.now()
  }, 500);
});

export default app;