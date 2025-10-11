import { WorkerEnvironment } from '../types';
import { createCloudflareEmbeddingService } from './cloudflare-embeddings';
import { createImageGenerationService } from './image-generation';
import { Logger } from '../utils/logger';

export interface VectorSearchResult {
  id: string;
  score: number;
  metadata: {
    description: string;
    tags: string;
    fileId: string;
    bucketId: string;
    width: number;
    height: number;
    text: string;
  };
}

export interface VectorSearchOptions {
  limit?: number;
  threshold?: number;
  includeMetadata?: boolean;
}

export class UltimateVectorSearchService {
  private env: WorkerEnvironment;
  private cloudflareEmbedding: ReturnType<typeof createCloudflareEmbeddingService>;
  private imageGenerationService: ReturnType<typeof createImageGenerationService>;

  constructor(env: WorkerEnvironment) {
    this.env = env;
    this.cloudflareEmbedding = createCloudflareEmbeddingService(env);
    this.imageGenerationService = createImageGenerationService(env);
  }

  async generateQueryEmbedding(query: string): Promise<number[]> {
    try {
      const result = await this.cloudflareEmbedding.generateEmbedding(query);
      return result.embedding;
    } catch (error) {
      console.error('Cloudflare AI embedding failed:', error);
      throw new Error(`Failed to generate embedding: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async searchSimilarVectors(
    queryEmbedding: number[], 
    options: VectorSearchOptions = {}
  ): Promise<VectorSearchResult[]> {
    try {
      const {
        limit = 10,
        threshold = 0.7,
        includeMetadata = true
      } = options;

      const results = await this.env.VECTORIZE.query(queryEmbedding, {
        topK: limit,
        returnMetadata: includeMetadata,
        filter: {} // Add filters if needed
      });

      const searchResults: VectorSearchResult[] = results.matches
        .filter(match => match.score >= threshold)
        .map(match => ({
          id: match.id,
          score: match.score,
          metadata: match.metadata as VectorSearchResult['metadata']
        }));

      return searchResults;

    } catch (error) {
      console.error('Error searching vectors:', error);
      throw new Error(`Vector search failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async semanticSearch(
    query: string, 
    options: VectorSearchOptions = {}
  ): Promise<VectorSearchResult[]> {
    try {
      const queryEmbedding = await this.generateQueryEmbedding(query);

      const raw = await this.env.VECTORIZE.query(queryEmbedding, {
        topK: options.limit ?? 10,
        returnMetadata: options.includeMetadata ?? true,
        filter: {}
      });

      const matches = raw.matches || [];

      const bestRawScore = matches.length > 0 ? Math.max(...matches.map((m: any) => m.score)) : 0;

      const threshold = options.threshold ?? 0.7;
      const results: VectorSearchResult[] = matches
        .filter((match: any) => match.score >= threshold)
        .slice(0, options.limit ?? 10)
        .map((match: any) => ({
          id: match.id,
          score: match.score,
          metadata: match.metadata as VectorSearchResult['metadata']
        }));

      try {
        const POOR_SCORE_TRIGGER = 0.5;
        const shouldTriggerBackground =
          matches.length === 0 ||
          results.length === 0 ||
          bestRawScore < POOR_SCORE_TRIGGER;

        if (shouldTriggerBackground) {
          Logger.info('vector-search-background-gen', 'Triggering background image generation due to poor or missing results', {
            query,
            bestRawScore,
            rawCount: matches.length,
            filteredCount: results.length,
            threshold
          });

          this.imageGenerationService.generateImageAsync(query);
        }
      } catch (bgError) {
        console.error('Background image generation trigger failed:', bgError);
      }

      return results;
    } catch (error) {
      console.error('Semantic search error:', error);
      throw error;
    }
  }

  async enhancedSemanticSearch(query: string, options: VectorSearchOptions = {}): Promise<VectorSearchResult[]> {
    try {
      let results = await this.semanticSearch(query, options);
      if (results.length < 3 && options.threshold && options.threshold > 0.5) {
        results = await this.semanticSearch(query, {
          ...options,
          threshold: 0.5
        });
      }
      if (results.length < 3) {
        const expandedQuery = this.expandQuery(query);
        if (expandedQuery !== query) {
          const expandedResults = await this.semanticSearch(expandedQuery, {
            ...options,
            threshold: 0.6
          });
          const existingIds = new Set(results.map(r => r.id));
          const newResults = expandedResults.filter(r => !existingIds.has(r.id));
          results = [...results, ...newResults];
        }
      }

      return results;

    } catch (error) {
      console.error('Enhanced semantic search error:', error);
      throw error;
    }
  }

  private expandQuery(query: string): string {
    const expansions = new Map([
      ['professional', 'professional business corporate executive'],
      ['doctor', 'doctor physician medical healthcare'],
      ['creative', 'creative artistic designer innovative'],
      ['friendly', 'friendly approachable warm welcoming'],
      ['young', 'young youthful energetic fresh'],
      ['senior', 'senior mature experienced veteran'],
      ['casual', 'casual informal relaxed comfortable'],
      ['formal', 'formal professional business suit']
    ]);

    const words = query.toLowerCase().split(/\s+/);
    const expandedWords = words.map(word => {
      const expansion = expansions.get(word);
      return expansion || word;
    });

    return expandedWords.join(' ');
  }

  async getSearchHealth(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    vectorizeConnected: boolean;
    cloudflareAiConnected: boolean;
    lastError?: string;
  }> {
    let vectorizeConnected = false;
    let cloudflareAiConnected = false;
    let lastError: string | undefined;

    try {
      await this.cloudflareEmbedding.generateEmbedding('test');
      cloudflareAiConnected = true;
    } catch (error) {
      lastError = `Cloudflare AI error: ${error instanceof Error ? error.message : String(error)}`;
    }

    try {
      const testEmbedding = new Array(1024).fill(0.1);
      await this.env.VECTORIZE.query(testEmbedding, { topK: 1 });
      vectorizeConnected = true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      lastError = lastError 
        ? `${lastError}; Vectorize error: ${errorMessage}`
        : `Vectorize error: ${errorMessage}`;
    }

    let status: 'healthy' | 'degraded' | 'unhealthy';
    if (vectorizeConnected && cloudflareAiConnected) {
      status = 'healthy';
    } else if (vectorizeConnected || cloudflareAiConnected) {
      status = 'degraded';
    } else {
      status = 'unhealthy';
    }

    return {
      status,
      vectorizeConnected,
      cloudflareAiConnected,
      lastError
    };
  }
}

export function createVectorSearchService(env: WorkerEnvironment): UltimateVectorSearchService {
  return new UltimateVectorSearchService(env);
}