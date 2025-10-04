import { WorkerEnvironment } from '../types';

export interface CloudflareEmbeddingResult {
    embedding: number[];
    model: string;
    dimensions: number;
}

export class CloudflareEmbeddingService {
    private env: WorkerEnvironment;
    private model: string;

    constructor(env: WorkerEnvironment) {
        this.env = env;
        this.model = '@cf/baai/bge-large-en-v1.5';
    }

    async generateEmbedding(text: string): Promise<CloudflareEmbeddingResult> {
        try {
            const response = await this.env.AI.run(this.model, {
                text: text.trim()
            });
            const embedding = response.data[0];

            return {
                embedding,
                model: this.model,
                dimensions: embedding.length
            };

        } catch (error) {
            console.error('Cloudflare AI embedding error:', error);
            throw new Error(`Failed to generate embedding: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    async generateBatchEmbeddings(texts: string[]): Promise<CloudflareEmbeddingResult[]> {
        const promises = texts.map(text => this.generateEmbedding(text));
        return await Promise.all(promises);
    }

    async testConnection(): Promise<boolean> {
        try {
            await this.generateEmbedding('test');
            return true;
        } catch (error) {
            console.error('Cloudflare AI test failed:', error);
            return false;
        }
    }
}

export function createCloudflareEmbeddingService(env: WorkerEnvironment): CloudflareEmbeddingService {
    return new CloudflareEmbeddingService(env);
}