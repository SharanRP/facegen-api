// Import types to ensure they're available
import type { WorkerEnvironment } from './types/index';

// Main Worker entry point - placeholder for now
export default {
  async fetch(request: Request, env: WorkerEnvironment): Promise<Response> {
    return new Response('Avatar API Service - Coming Soon', { status: 200 });
  }
};