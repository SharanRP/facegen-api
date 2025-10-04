
declare global {
  interface KVNamespace {
    get(key: string): Promise<string | null>;
    put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
    delete(key: string): Promise<void>;
    list(options?: { prefix?: string; limit?: number }): Promise<{ keys: { name: string }[] }>;
  }

  interface VectorizeMatch {
    id: string;
    score: number;
    metadata?: Record<string, any>;
  }

  interface VectorizeQueryOptions {
    topK?: number;
    returnMetadata?: boolean;
    filter?: Record<string, any>;
  }

  interface VectorizeQueryResult {
    matches: VectorizeMatch[];
    count: number;
  }

  interface Vectorize {
    query(vector: number[], options?: VectorizeQueryOptions): Promise<VectorizeQueryResult>;
    insert(vectors: Array<{
      id: string;
      values: number[];
      metadata?: Record<string, any>;
    }>): Promise<void>;
    upsert(vectors: Array<{
      id: string;
      values: number[];
      metadata?: Record<string, any>;
    }>): Promise<void>;
    deleteByIds(ids: string[]): Promise<void>;
  }

  interface Ai {
    run(model: string, options: { text: string }): Promise<{ data: number[][] }>;
  }
}

export {};