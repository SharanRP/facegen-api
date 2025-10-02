import { AvatarRequest } from '../types';

export function generateCacheKey(request: AvatarRequest): string {
  const { description, scale, format } = request;
  
  const keywords = extractKeywords(description);
  
  return `avatar:${keywords.join('-')}:${scale}:${format}`;
}

export function extractKeywords(description: string): string[] {
  return description
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, '') // Remove special characters
    .split(/\s+/)
    .filter(word => word.length > 2) // Filter out short words
    .slice(0, 10) // Limit to 10 keywords for performance
    .sort(); // Sort for consistency
}

export function createCacheControlHeader(ttl: number): string {
  if (ttl <= 0) {
    return 'no-cache, no-store, must-revalidate';
  }
  return `public, max-age=${ttl}`;
}

export function parseCacheControlMaxAge(cacheControl: string): number {
  const match = cacheControl.match(/max-age=(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

export function isCacheable(status: number): boolean {
  return status === 200 || status === 404;
}

export function calculateCacheAge(cachedAt: string): number {
  const cachedTime = new Date(cachedAt).getTime();
  const now = Date.now();
  return Math.floor((now - cachedTime) / 1000);
}

export function isCacheValid(cachedAt: string, ttl: number): boolean {
  const age = calculateCacheAge(cachedAt);
  return age < ttl;
}

export function normalizeRequestUrl(url: string, avatarRequest: AvatarRequest): string {
  const urlObj = new URL(url);
  
  urlObj.search = '';
  urlObj.searchParams.set('description', avatarRequest.description.trim());
  urlObj.searchParams.set('scale', avatarRequest.scale.toString());
  urlObj.searchParams.set('format', avatarRequest.format);
  
  return urlObj.toString();
}