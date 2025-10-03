import { AvatarRequest, ValidationResult } from '../types';

export class ValidationMiddleware {
  private static readonly VALID_SCALES = [128, 256, 512] as const;
  private static readonly VALID_FORMATS = ['webp', 'png'] as const;
  private static readonly DEFAULT_FORMAT = 'webp';
  
  private static readonly DESCRIPTION_MIN_LENGTH = 1;
  private static readonly DESCRIPTION_MAX_LENGTH = 200;
  
  private static readonly SAFE_CHAR_REGEX = /^[a-zA-Z0-9\s\-_.,!?()]+$/;
  
  private static readonly HTML_TAG_REGEX = /<[^>]*>/g;
  
  private static readonly SCRIPT_REGEX = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi;

  static validateDescription(description: string | undefined): { valid: boolean; error?: string; sanitized?: string } {
    if (!description) {
      return { valid: false, error: 'Description parameter is required' };
    }

    if (typeof description !== 'string') {
      return { valid: false, error: 'Description must be a string' };
    }

    const sanitized = this.sanitizeInput(description);

    if (sanitized.length < this.DESCRIPTION_MIN_LENGTH) {
      return { valid: false, error: `Description must be at least ${this.DESCRIPTION_MIN_LENGTH} character long` };
    }

    if (sanitized.length > this.DESCRIPTION_MAX_LENGTH) {
      return { valid: false, error: `Description must not exceed ${this.DESCRIPTION_MAX_LENGTH} characters` };
    }

    if (!this.SAFE_CHAR_REGEX.test(sanitized)) {
      return { valid: false, error: 'Description contains invalid characters. Only alphanumeric characters, spaces, and basic punctuation are allowed' };
    }

    return { valid: true, sanitized };
  }

  static validateScale(scale: string | number | undefined): { valid: boolean; error?: string; sanitized: 128 | 256 | 512 } {
    if (!scale) {
      return { valid: true, sanitized: 256 };
    }

    const numericScale = typeof scale === 'string' ? parseInt(scale, 10) : scale;

    if (isNaN(numericScale)) {
      return { valid: false, error: 'Scale must be a valid number', sanitized: 256 };
    }

    if (!this.VALID_SCALES.includes(numericScale as any)) {
      return { 
        valid: false, 
        error: `Scale must be one of: ${this.VALID_SCALES.join(', ')}`,
        sanitized: 256
      };
    }

    return { valid: true, sanitized: numericScale as 128 | 256 | 512 };
  }

  static validateFormat(format: string | undefined): { valid: boolean; error?: string; sanitized: 'webp' | 'png' } {
    if (!format) {
      return { valid: true, sanitized: this.DEFAULT_FORMAT };
    }

    if (typeof format !== 'string') {
      return { valid: false, error: 'Format must be a string', sanitized: this.DEFAULT_FORMAT };
    }

    const normalizedFormat = format.toLowerCase().trim();

    if (!this.VALID_FORMATS.includes(normalizedFormat as any)) {
      return { 
        valid: false, 
        error: `Format must be one of: ${this.VALID_FORMATS.join(', ')}`,
        sanitized: this.DEFAULT_FORMAT
      };
    }

    return { valid: true, sanitized: normalizedFormat as 'webp' | 'png' };
  }

  private static sanitizeInput(input: string): string {
    if (!input || typeof input !== 'string') {
      return '';
    }

    let sanitized = input.replace(this.SCRIPT_REGEX, '');
    
    sanitized = sanitized.replace(this.HTML_TAG_REGEX, '');
    
    sanitized = sanitized.trim();
    
    sanitized = sanitized.replace(/\s+/g, ' ');

    return sanitized;
  }

  static validateAvatarRequest(params: {
    description?: string;
  }): ValidationResult {
    const errors: string[] = [];
    
    const descriptionResult = this.validateDescription(params.description);
    if (!descriptionResult.valid) {
      errors.push(descriptionResult.error!);
    }

    if (errors.length > 0) {
      return {
        valid: false,
        errors,
        sanitized: {
          description: descriptionResult.sanitized || '',
          scale: 256, 
          format: 'png'
        }
      };
    }

    return {
      valid: true,
      errors: [],
      sanitized: {
        description: descriptionResult.sanitized!,
        scale: 256,
        format: 'png'
      }
    };
  }
}

export function validateAvatarRequest(params: {
  description?: string;
}): ValidationResult {
  return ValidationMiddleware.validateAvatarRequest(params);
}