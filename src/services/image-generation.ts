import { WorkerEnvironment } from '../types';
import { Logger } from '../utils/logger';

export interface ImageGenerationRequest {
  description: string;
}

export interface ImageGenerationService {
  generateImageAsync(description: string): void;
}

export class ImageGenerationServiceImpl implements ImageGenerationService {
  private env: WorkerEnvironment;
  private imageServiceUrl: string;

  constructor(env: WorkerEnvironment) {
    this.env = env;
    this.imageServiceUrl = env.IMAGE_SERVICE_URL || '';
  }

  generateImageAsync(description: string): void {
    this.generateImageInternal(description).catch(error => {
      console.error('Background image generation failed:', error);
      Logger.error('background-image-gen-error', 'Failed to generate image asynchronously', {
        description,
        error: error instanceof Error ? error.message : String(error)
      });
    });
  }

  private async generateImageInternal(description: string): Promise<void> {
    try {
      const startTime = Date.now();
      Logger.info('background-image-gen', 'Starting background image generation', {
        description
      });

      const response = await fetch(this.imageServiceUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ description })
      });

      const duration = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unable to read error response');
        Logger.error('background-image-gen-error', 'Image generation API returned error', {
          description,
          status: response.status,
          statusText: response.statusText,
          errorText,
          durationMs: duration
        });
        throw new Error(`Image generation API failed: ${response.status} ${response.statusText}`);
      }

      const result = await response.json().catch(() => null);

      Logger.info('background-image-gen-success', 'Background image generation completed', {
        description,
        durationMs: duration,
        result
      });

    } catch (error) {
      throw error;
    }
  }
}

export function createImageGenerationService(env: WorkerEnvironment): ImageGenerationService {
  return new ImageGenerationServiceImpl(env);
}
