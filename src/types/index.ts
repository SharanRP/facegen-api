/// <reference path="./global.d.ts" />

export interface WorkerEnvironment {
  APPWRITE_ENDPOINT: string;
  APPWRITE_PROJECT_ID: string;
  APPWRITE_API_KEY: string;
  APPWRITE_DATABASE_ID: string;
  APPWRITE_COLLECTION_ID: string;
  APPWRITE_BUCKET_ID: string;
  RATE_LIMIT: KVNamespace;
}

export interface AvatarRequest {
  description: string;
  scale: 128 | 256 | 512;
  format: 'webp' | 'png';
}

export interface AvatarDocument {
  $id: string;
  description: string;
  tags: string;
  fileId: string;
  bucketId: string;
  width: number;
  height: number;
  embedding?: string;
}

export interface RateLimitConfig {
  perMinute: number;
  perHour: number;
  keyPrefix: string;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  sanitized: AvatarRequest;
}

export interface ErrorResponse {
  error: string;
  details?: string;
  correlationId: string;
  timestamp: number;
}

export enum ErrorType {
  VALIDATION_ERROR = 'validation_error',
  RATE_LIMIT_ERROR = 'rate_limit_error',
  NOT_FOUND_ERROR = 'not_found_error',
  APPWRITE_CONNECTION_ERROR = 'appwrite_connection_error',
  APPWRITE_QUERY_ERROR = 'appwrite_query_error',
  STORAGE_ACCESS_ERROR = 'storage_access_error',
  INTERNAL_ERROR = 'internal_error'
}