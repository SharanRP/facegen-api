import { Client, Databases, Storage, Query } from 'node-appwrite';
import { AvatarDocument, WorkerEnvironment, ErrorType } from '../types';


export interface AppwriteService {
  searchAvatars(keywords: string[], scale: number): Promise<AvatarDocument[]>;
  getFileUrl(bucketId: string, fileId: string): Promise<string>;
}

export class AppwriteError extends Error {
  constructor(
    message: string,
    public type: ErrorType,
    public statusCode: number = 500,
    public originalError?: Error
  ) {
    super(message);
    this.name = 'AppwriteError';
  }
}

export class AppwriteServiceImpl implements AppwriteService {
  private client: Client;
  private databases: Databases;
  private storage: Storage;
  private databaseId: string;
  private collectionId: string;

  private readonly connectionTimeout = 5000;

  constructor(env: WorkerEnvironment) {
    this.client = new Client()
      .setEndpoint(env.APPWRITE_ENDPOINT)
      .setProject(env.APPWRITE_PROJECT_ID)
      .setKey(env.APPWRITE_API_KEY);

    this.databases = new Databases(this.client);
    this.storage = new Storage(this.client);
    this.databaseId = env.APPWRITE_DATABASE_ID;
    this.collectionId = env.APPWRITE_COLLECTION_ID;

  }

  private async withTimeout<T>(operation: Promise<T>, timeoutMs: number = this.connectionTimeout): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Operation timeout')), timeoutMs);
    });

    return Promise.race([operation, timeoutPromise]);
  }

  async searchAvatars(keywords: string[], scale: number): Promise<AvatarDocument[]> {
    try {
      const searchQuery = keywords.join(' ');
      const queries = [
        Query.search('tags', searchQuery),
        Query.equal('width', scale),
        Query.equal('height', scale),
        Query.limit(10)
      ];

      const response = await this.withTimeout(
        this.databases.listDocuments(
          this.databaseId,
          this.collectionId,
          queries
        )
      );

      return response.documents.map((doc: any) => ({
        $id: doc.$id,
        description: doc.description as string,
        tags: doc.tags as string,
        fileId: doc.fileId as string,
        bucketId: doc.bucketId as string,
        width: doc.width as number,
        height: doc.height as number,
        embedding: doc.embedding as string | undefined
      }));

    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('timeout') || error.message.includes('network')) {
          throw new AppwriteError(
            'Failed to connect to Appwrite database',
            ErrorType.APPWRITE_CONNECTION_ERROR,
            502,
            error
          );
        }
        
        if (error.message.includes('query') || error.message.includes('search')) {
          throw new AppwriteError(
            'Database query failed',
            ErrorType.APPWRITE_QUERY_ERROR,
            500,
            error
          );
        }
      }

      throw new AppwriteError(
        'Appwrite service error',
        ErrorType.APPWRITE_CONNECTION_ERROR,
        502,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  async getFileUrl(bucketId: string, fileId: string): Promise<string> {
    try {
      const fileUrl = await this.withTimeout(
        Promise.resolve(this.storage.getFileView(bucketId, fileId))
      );
      
      return fileUrl.toString();

    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('not found') || error.message.includes('404')) {
          throw new AppwriteError(
            'Avatar file not found in storage',
            ErrorType.NOT_FOUND_ERROR,
            404,
            error
          );
        }
        
        if (error.message.includes('permission') || error.message.includes('403')) {
          throw new AppwriteError(
            'Access denied to avatar file',
            ErrorType.STORAGE_ACCESS_ERROR,
            403,
            error
          );
        }
      }

      throw new AppwriteError(
        'Failed to generate file URL',
        ErrorType.STORAGE_ACCESS_ERROR,
        500,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }
}

export function createAppwriteService(env: WorkerEnvironment): AppwriteService {
  return new AppwriteServiceImpl(env);
}