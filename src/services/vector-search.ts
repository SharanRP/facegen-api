import { WorkerEnvironment } from '../types';

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
  private ollamaBaseUrl: string;
  private ollamaModel: string;

  constructor(env: WorkerEnvironment) {
    this.env = env;
    this.ollamaBaseUrl = env.OLLAMA_BASE_URL || 'http://localhost:11434';
    this.ollamaModel = env.OLLAMA_MODEL || 'mxbai-embed-large:latest';
  }

  async generateQueryEmbedding(query: string): Promise<number[]> {
    try {
      const response = await fetch(`${this.ollamaBaseUrl}/api/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.ollamaModel,
          prompt: query.trim()
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ollama API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json() as { embedding: number[] };
      return data.embedding;

    } catch (error) {
      console.error('Error generating query embedding:', error);
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
      const results = await this.searchSimilarVectors(queryEmbedding, options);
      console.log(`Semantic search: "${query}" -> ${results.length} results`);

      return results;

    } catch (error) {
      console.error('Semantic search error:', error);
      throw error;
    }
  }

  async enhancedSemanticSearch(
    query: string,
    options: VectorSearchOptions = {}
  ): Promise<VectorSearchResult[]> {
    try {
      let results = await this.semanticSearch(query, options);
      if (results.length < 3 && options.threshold && options.threshold > 0.5) {
        console.log('Expanding search with lower threshold...');
        results = await this.semanticSearch(query, {
          ...options,
          threshold: 0.5
        });
      }
      if (results.length < 3) {
        console.log('Trying query expansion...');
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
    ollamaConnected: boolean;
    lastError?: string;
  }> {
    let vectorizeConnected = false;
    let ollamaConnected = false;
    let lastError: string | undefined;

    try {
      await this.generateQueryEmbedding('test');
      ollamaConnected = true;
    } catch (error) {
      lastError = `Ollama API error: ${error instanceof Error ? error.message : String(error)}`;
    }

    try {
      const testEmbedding = new Array(1024).fill(0.1); // 1024 dimensions for mxbai-embed-large
      await this.env.VECTORIZE.query(testEmbedding, { topK: 1 });
      vectorizeConnected = true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      lastError = lastError 
        ? `${lastError}; Vectorize error: ${errorMessage}`
        : `Vectorize error: ${errorMessage}`;
    }

    let status: 'healthy' | 'degraded' | 'unhealthy';
    if (vectorizeConnected && ollamaConnected) {
      status = 'healthy';
    } else if (vectorizeConnected || ollamaConnected) {
      status = 'degraded';
    } else {
      status = 'unhealthy';
    }

    return {
      status,
      vectorizeConnected,
      ollamaConnected,
      lastError
    };
  }
}

export function createVectorSearchService(env: WorkerEnvironment): UltimateVectorSearchService {
  return new UltimateVectorSearchService(env);
}