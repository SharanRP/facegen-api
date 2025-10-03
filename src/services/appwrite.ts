import { Client, Databases, Storage, Query } from 'node-appwrite';
import { AvatarDocument, WorkerEnvironment, ErrorType } from '../types';
import { CircuitBreaker, CircuitBreakerFactory, DEFAULT_CIRCUIT_BREAKER_CONFIG } from '../utils/circuit-breaker';
import { AvatarAPIError } from '../utils/errors';
import { PerformanceTimer, MonitoringAggregator } from '../utils/logger';

export interface AppwriteService {
  searchAvatars(keywords: string[], scale: number): Promise<AvatarDocument[]>;
  getFileUrl(bucketId: string, fileId: string): Promise<string>;
}

export class AppwriteError extends AvatarAPIError {
  constructor(
    message: string,
    type: ErrorType,
    statusCode: number = 500,
    originalError?: Error
  ) {
    super(message, type, statusCode, undefined, originalError);
    this.name = 'AppwriteError';
  }
}

export class AppwriteServiceImpl implements AppwriteService {
  private client: Client;
  private databases: Databases;
  private storage: Storage;
  private databaseId: string;
  private collectionId: string;
  private databaseCircuitBreaker: CircuitBreaker;
  private storageCircuitBreaker: CircuitBreaker;

  constructor(env: WorkerEnvironment) {
    this.client = new Client()
      .setEndpoint(env.APPWRITE_ENDPOINT)
      .setProject(env.APPWRITE_PROJECT_ID)
      .setKey(env.APPWRITE_API_KEY);

    this.databases = new Databases(this.client);
    this.storage = new Storage(this.client);
    this.databaseId = env.APPWRITE_DATABASE_ID;
    this.collectionId = env.APPWRITE_COLLECTION_ID;

    this.databaseCircuitBreaker = CircuitBreakerFactory.getInstance(
      'appwrite-database',
      DEFAULT_CIRCUIT_BREAKER_CONFIG
    );

    this.storageCircuitBreaker = CircuitBreakerFactory.getInstance(
      'appwrite-storage',
      DEFAULT_CIRCUIT_BREAKER_CONFIG
    );
  }


  async searchAvatars(keywords: string[], scale: number): Promise<AvatarDocument[]> {
    return await this.databaseCircuitBreaker.execute(async () => {
      const timer = new PerformanceTimer('appwrite-search', 'database_search');

      try {
        const searchQuery = keywords.join(' ');

        let queries = [
          Query.search('Tags', searchQuery),
          Query.greaterThanEqual('width', Math.floor(scale * 0.8)),
          Query.lessThanEqual('width', Math.ceil(scale * 1.2)),
          Query.limit(20)
        ];

        let response = await this.databases.listDocuments(
          this.databaseId,
          this.collectionId,
          queries
        );

        if (response.documents.length < 5) {
          queries = [
            Query.search('Tags', searchQuery),
            Query.limit(20)
          ];

          response = await this.databases.listDocuments(
            this.databaseId,
            this.collectionId,
            queries
          );
        }

        if (response.documents.length < 5 && keywords.length > 1) {
          const individualResults = new Map();

          for (const keyword of keywords) {
            const keywordQueries = [
              Query.search('Tags', keyword),
              Query.limit(10)
            ];

            const keywordResponse = await this.databases.listDocuments(
              this.databaseId,
              this.collectionId,
              keywordQueries
            );

            keywordResponse.documents.forEach((doc: any) => {
              if (!individualResults.has(doc.$id)) {
                individualResults.set(doc.$id, doc);
              }
            });
          }

          if (individualResults.size > response.documents.length) {
            response.documents = Array.from(individualResults.values());
          }
        }

        const results = response.documents.map((doc: any) => ({
          $id: doc.$id,
          description: doc.Description as string,
          tags: doc.Tags as string,
          fileId: doc.fileId as string,
          bucketId: doc.bucketId as string,
          width: doc.width as number,
          height: doc.height as number,
          embedding: doc.embedding as string | undefined
        }));

        const duration = timer.finish(true, undefined, {
          keywords: keywords.join(','),
          scale,
          resultCount: results.length
        });

        MonitoringAggregator.recordResponseTime('appwrite_search', duration);

        return results;

      } catch (error) {
        timer.finish(false, error instanceof Error ? error.message : String(error));
        MonitoringAggregator.recordError('appwrite_search_error');
        throw error;
      }
    });
  }

  async getFileUrl(bucketId: string, fileId: string): Promise<string> {
    return await this.storageCircuitBreaker.execute(async () => {
      const timer = new PerformanceTimer('appwrite-storage', 'file_url_generation');

      try {
        const urlString = `${this.client.config.endpoint}/storage/buckets/${bucketId}/files/${fileId}/view?project=${this.client.config.project}`;

        const duration = timer.finish(true, undefined, {
          bucketId,
          fileId
        });

        MonitoringAggregator.recordResponseTime('appwrite_file_url', duration);

        return urlString;

      } catch (error) {
        timer.finish(false, error instanceof Error ? error.message : String(error));
        MonitoringAggregator.recordError('appwrite_file_url_error');

        if (error instanceof Error) {
          const message = error.message.toLowerCase();

          if (message.includes('not found') || message.includes('404')) {
            throw new AppwriteError(
              'Avatar file not found in storage',
              ErrorType.NOT_FOUND_ERROR,
              404,
              error
            );
          }

          if (message.includes('permission') || message.includes('403')) {
            throw new AppwriteError(
              'Access denied to avatar file',
              ErrorType.STORAGE_ACCESS_ERROR,
              403,
              error
            );
          }
        }

        throw error;
      }
    });
  }
}

export function createAppwriteService(env: WorkerEnvironment): AppwriteService {
  return new AppwriteServiceImpl(env);
}